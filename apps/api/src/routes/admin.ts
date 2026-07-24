import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { requireAdmin } from "../middleware/require-admin";
import { getArchivedChallengeById } from "../db/queries/challenges";
import { findUserById, listUsersWithFraudScores } from "../db/queries/users";
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
import { CursorQuerySchema } from "../db/pagination";

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

// ── Fraud-score enriched user listing ────────────────────────────────────────

const ListUsersSchema = CursorQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  minFraudScore: z.coerce.number().int().min(0).optional(),
  orderBy: z.enum(["createdAt", "fraudScore"]).default("createdAt"),
}).refine((data) => !("page" in data), {
  message: "Use ?cursor for pagination. Legacy ?page parameter is no longer supported.",
});

router.get("/users", requireAdmin, async (req, res) => {
  const { cursor, limit: pageSize, minFraudScore, orderBy } = ListUsersSchema.parse(req.query);

  const { users, total, nextCursor } = await listUsersWithFraudScores({
    cursor,
    pageSize,
    minFraudScore,
    orderBy,
  });

  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      createdAt: u.created_at,
      suspendedAt: u.suspended_at,
      fraudScore: u.fraud_score,
      totalPayouts: u.total_payouts,
    })),
    pagination: {
      pageSize,
      total,
      nextCursor,
    },
  });
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

export default router;
