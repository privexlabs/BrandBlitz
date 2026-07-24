import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { getArchivedChallengeById } from "../db/queries/challenges";
import { findUserById } from "../db/queries/users";
import { setConfig } from "../db/queries/config";
import { ensureLeagueRepeatableJobs } from "../queues/league.queue";
import { createError } from "../middleware/error";
import { logger } from "../lib/logger";
import {
  DLQ_QUEUES,
  DLQ_SOURCE_QUEUES,
  type DeadLetterPayload,
} from "../queues/dlq";
import { feeBumpTransaction } from "@brandblitz/stellar";
import { updatePayoutFeeBumpStatus } from "../db/queries/payouts";
import { config } from "../lib/config";
import { query } from "../db/index";
import { webhookRotationLimiter } from "../middleware/rate-limit";
import { createFraudFlag, getFraudFlags } from "../db/queries/fraud-flags";

const router = Router();

// Admin leaderboard-style queries must follow the same rule as
// routes/leaderboard.ts: validate sort params against an allowlist before
// choosing an ORDER BY expression. This file currently has no user-controlled
// leaderboard ORDER BY clauses.

router.use(authenticate);

router.use(async (req, _res, next) => {
  const user = await findUserById(req.user!.sub);
  if (!user || user.role !== "admin") throw createError("Forbidden", 403, "FORBIDDEN");
  next();
});

router.get("/archive/challenges/:id", async (req, res) => {
  const challenge = await getArchivedChallengeById(req.params.id);
  if (!challenge) throw createError("Archived challenge not found", 404);
  res.json({ challenge });
});

const LeagueScheduleSchema = z.object({
  finalizeCron: z.string().regex(/^[\d\s\*\/\-\,]+$/).optional(),
  startCron: z.string().regex(/^[\d\s\*\/\-\,]+$/).optional(),
});

router.patch("/config/league-schedule", async (req, res) => {
  const body = LeagueScheduleSchema.parse(req.body);

  if (body.finalizeCron) {
    await setConfig("league_cron_finalize", { cron: body.finalizeCron }, req.user!.sub);
  }

  if (body.startCron) {
    await setConfig("league_cron_start", { cron: body.startCron }, req.user!.sub);
  }

  // Reload repeatable jobs with new schedule
  await ensureLeagueRepeatableJobs();

  res.json({
    status: "updated",
    finalizeCron: body.finalizeCron,
    startCron: body.startCron,
  });
});

// ─── E2E Test Endpoints ────────────────────────────────────────────────────────
// These endpoints are only available in test/development environments
// and are used exclusively for Playwright E2E test setup.

if (process.env.NODE_ENV === "test" || process.env.PLAYWRIGHT_E2E === "true") {
  router.post("/test/seed-fraud-flag", async (req, res) => {
    const { sessionId, userId, flagType } = z
      .object({
        sessionId: z.string().uuid(),
        userId: z.string().uuid(),
        flagType: z.string().default("reaction_time_anomaly"),
      })
      .parse(req.body);

    await createFraudFlag({
      sessionId,
      userId,
      flagType,
      details: { severity: "test", createdBy: "e2e_test" },
    });

    res.json({ flagId: sessionId, status: "created" });
  });

  router.post("/test/promote-to-admin", async (req, res) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);

    await query("UPDATE users SET role = $1 WHERE id = $2", ["admin", userId]);

    res.json({ status: "promoted" });
  });

  router.get("/test/fraud-flags", async (req, res) => {
    const { status } = z
      .object({ status: z.string().optional() })
      .parse(req.query);

    const result = await getFraudFlags({
      status: status || undefined,
      pageSize: 100,
    });

    res.json({ flags: result.flags });
  });

  router.get("/test/gdpr-erasure-request", async (req, res) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.query);

    const result = await query(
      `SELECT id, user_id, requested_at, scheduled_for FROM gdpr_erasure_requests
       WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    res.json({
      requestFound: result.rows.length > 0,
      request: result.rows[0] || null,
    });
  });

  router.get("/test/audit-logs", async (req, res) => {
    const { action, entity } = z
      .object({
        action: z.string().optional(),
        entity: z.string().optional(),
      })
      .parse(req.query);

    let whereClause = "WHERE 1=1";
    const params: any[] = [];

    if (action) {
      whereClause += ` AND action = $${params.length + 1}`;
      params.push(action);
    }

    if (entity) {
      whereClause += ` AND entity = $${params.length + 1}`;
      params.push(entity);
    }

    const result = await query(
      `SELECT actor_id, action, entity, entity_key, before, after, created_at
       FROM audit_log
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT 50`,
      params
    );

    res.json({ logs: result.rows });
  });
}

export default router;
