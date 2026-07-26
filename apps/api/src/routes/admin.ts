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
import { query, pool } from "../db/index";
import { webhookRotationLimiter } from "../middleware/rate-limit";
import { sessionTimeoutQueue } from "../queues/session-timeout.queue";

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

/**
 * GET /admin/users/:id
 * Full user view with sessions, fraud flags, and payout history.
 * Protected by admin middleware.
 * Response includes profile, recent sessions (last 20), fraud flags, and payout history.
 */
router.get("/users/:id", async (req, res) => {
  const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);

  const userResult = await query<{
    id: string;
    email: string;
    display_name: string;
    username: string;
    avatar_url: string | null;
    status: string;
    suspended_at: string | null;
    suspension_reason: string | null;
    created_at: string;
    total_earned_usdc: string;
    challenges_played: number;
  }>(
    `SELECT id, email, display_name, username, avatar_url, status, suspended_at, suspension_reason, created_at, total_earned_usdc, challenges_played
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw createError("User not found", 404);
  }

  const user = userResult.rows[0];

  const sessionsResult = await query<{
    id: string;
    challenge_id: string;
    score: number;
    completed_at: string;
    duration_ms: number;
  }>(
    `SELECT id, challenge_id, total_score as score, completed_at,
            EXTRACT(EPOCH FROM (completed_at - started_at))::int * 1000 as duration_ms
     FROM game_sessions
     WHERE user_id = $1 AND status = 'completed'
     ORDER BY completed_at DESC
     LIMIT 20`,
    [userId]
  );

  const fraudFlagsResult = await query<{
    id: string;
    flag_type: string;
    severity: string | null;
    created_at: string;
    resolved_at: string | null;
  }>(
    `SELECT id, flag_type,
            CASE WHEN flag_type = 'content_report' THEN 'high' ELSE 'medium' END as severity,
            created_at, resolved_at
     FROM fraud_flags
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  const payoutsResult = await query<{
    id: string;
    amount_usdc: string;
    status: string;
    created_at: string;
    updated_at: string;
    challenge_id: string;
  }>(
    `SELECT id, (amount_stroops::numeric / 10000000)::numeric(20,7)::text as amount_usdc,
            status, created_at, updated_at, challenge_id
     FROM payouts
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  res.json({
    profile: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      username: user.username,
      avatar_url: user.avatar_url,
      status: user.status,
      suspended_at: user.suspended_at,
      suspension_reason: user.suspension_reason,
      created_at: user.created_at,
      total_earned_usdc: user.total_earned_usdc,
      challenges_played: user.challenges_played,
    },
    recentSessions: sessionsResult.rows.map((s) => ({
      sessionId: s.id,
      challengeId: s.challenge_id,
      score: s.score,
      completedAt: s.completed_at,
      durationMs: s.duration_ms,
    })),
    fraudFlags: fraudFlagsResult.rows.map((f) => ({
      id: f.id,
      flagType: f.flag_type,
      severity: f.severity,
      detectedAt: f.created_at,
      resolvedAt: f.resolved_at,
    })),
    payoutHistory: payoutsResult.rows.map((p) => ({
      id: p.id,
      amount_usdc: p.amount_usdc,
      status: p.status,
      created_at: p.created_at,
      updated_at: p.updated_at,
      challenge_id: p.challenge_id,
    })),
  });
});

/**
 * POST /admin/users/:id/suspend
 * Suspend a user account with reason.
 * Sets suspendedAt and suspendReason, enqueues session terminations, logs to audit_log.
 * Protected by admin middleware.
 */
router.post("/users/:id/suspend", async (req, res) => {
  const { id: userId } = z.object({ id: z.string().uuid() }).parse(req.params);

  const bodySchema = z.object({
    reason: z.string().min(1).max(500),
    durationDays: z.number().int().positive().optional(),
  });

  const body = bodySchema.parse(req.body);

  const userResult = await query<{
    id: string;
    status: string;
    suspended_at: string | null;
  }>(
    `SELECT id, status, suspended_at FROM users WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    throw createError("User not found", 404);
  }

  const user = userResult.rows[0];

  if (user.status === "suspended" && user.suspended_at) {
    throw createError("User is already suspended", 409);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE users SET status = 'suspended', suspended_at = NOW(), suspension_reason = $1, suspended_by = $2
       WHERE id = $3`,
      [body.reason, req.user!.sub, userId]
    );

    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, metadata)
       VALUES ('suspend', 'user', $1, $2::jsonb)`,
      [userId, JSON.stringify({
        reason: body.reason,
        duration_days: body.durationDays || null,
        performed_by: req.user!.sub
      })]
    );

    const sessionsResult = await client.query(
      `SELECT id FROM game_sessions WHERE user_id = $1 AND status != 'completed'`,
      [userId]
    );

    for (const session of sessionsResult.rows) {
      await sessionTimeoutQueue.add(
        "terminate-session",
        { sessionId: session.id },
        { attempts: 2, removeOnComplete: true }
      );
    }

    await client.query("COMMIT");
    res.status(200).json({ success: true, suspended_user_id: userId });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

export default router;
