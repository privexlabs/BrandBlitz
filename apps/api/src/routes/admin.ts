import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { requireAdmin } from "../middleware/require-admin";
import { getArchivedChallengeById } from "../db/queries/challenges";
import { setConfig } from "../db/queries/config";
import { ensureLeagueRepeatableJobs } from "../queues/league.queue";
import { query } from "../db/index";
import { decodeCursorSafe, encodeCursor } from "../db/pagination";
import { createError } from "../middleware/error";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

const ListUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
  minFraudScore: z.coerce.number().int().min(0).default(0),
  orderBy: z.enum(["createdAt", "fraudScore"]).default("createdAt"),
});

type AdminUserRow = {
  id: string;
  username: string | null;
  email: string;
  created_at: string;
  suspended_at: string | null;
  fraud_score: number;
  total_payouts: number;
};

router.get("/users", async (req, res) => {
  const { limit, cursor, minFraudScore, orderBy } = ListUsersQuerySchema.parse(req.query);
  const expectedCursorKeys =
    orderBy === "fraudScore" ? ["fraudScore", "createdAt", "id"] : ["createdAt", "id"];
  const cursorValues = decodeCursorSafe(cursor, expectedCursorKeys);

  const params: unknown[] = [minFraudScore];
  let cursorClause = "";

  if (cursorValues) {
    if (orderBy === "fraudScore") {
      params.push(cursorValues.fraudScore, cursorValues.createdAt, cursorValues.id);
      cursorClause = `
        AND (
          fraud_score < $2
          OR (fraud_score = $2 AND created_at < $3)
          OR (fraud_score = $2 AND created_at = $3 AND id < $4)
        )`;
    } else {
      params.push(cursorValues.createdAt, cursorValues.id);
      cursorClause = `
        AND (
          created_at < $2
          OR (created_at = $2 AND id < $3)
        )`;
    }
  }

  params.push(limit + 1);
  const limitParam = params.length;
  const orderClause =
    orderBy === "fraudScore"
      ? "fraud_score DESC, created_at DESC, id DESC"
      : "created_at DESC, id DESC";

  const result = await query<AdminUserRow>(
    `WITH fraud_totals AS (
       SELECT user_id, COUNT(*)::int AS fraud_score
       FROM fraud_flags
       GROUP BY user_id
     ),
     payout_totals AS (
       SELECT user_id, COUNT(*)::int AS total_payouts
       FROM payouts
       GROUP BY user_id
     ),
     user_metrics AS (
       SELECT u.id,
              u.username,
              u.email,
              u.created_at,
              u.suspended_at,
              COALESCE(ft.fraud_score, 0)::int AS fraud_score,
              COALESCE(pt.total_payouts, 0)::int AS total_payouts
       FROM users u
       LEFT JOIN fraud_totals ft ON ft.user_id = u.id
       LEFT JOIN payout_totals pt ON pt.user_id = u.id
       WHERE u.deleted_at IS NULL
     )
     SELECT *
     FROM user_metrics
     WHERE fraud_score >= $1
     ${cursorClause}
     ORDER BY ${orderClause}
     LIMIT $${limitParam}`,
    params
  );

  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          ...(orderBy === "fraudScore" ? { fraudScore: last.fraud_score } : {}),
          createdAt: last.created_at,
          id: last.id,
        })
      : null;

  res.json({
    users: rows.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      createdAt: user.created_at,
      suspendedAt: user.suspended_at,
      fraudScore: user.fraud_score,
      totalPayouts: user.total_payouts,
    })),
    nextCursor,
  });
});

router.get("/archive/challenges/:id", async (req, res) => {
  const challenge = await getArchivedChallengeById(req.params.id);
  if (!challenge) throw createError("Archived challenge not found", 404);
  res.json({ challenge });
});

const LeagueScheduleSchema = z.object({
  finalizeCron: z
    .string()
    .regex(/^[\d\s\*\/\-\,]+$/)
    .optional(),
  startCron: z
    .string()
    .regex(/^[\d\s\*\/\-\,]+$/)
    .optional(),
});

router.patch("/config/league-schedule", async (req, res) => {
  const body = LeagueScheduleSchema.parse(req.body);

  if (body.finalizeCron) {
    await setConfig("league_cron_finalize", { cron: body.finalizeCron }, req.user!.sub);
  }

  if (body.startCron) {
    await setConfig("league_cron_start", { cron: body.startCron }, req.user!.sub);
  }

  await ensureLeagueRepeatableJobs();

  res.json({
    status: "updated",
    finalizeCron: body.finalizeCron,
    startCron: body.startCron,
  });
});

export default router;
