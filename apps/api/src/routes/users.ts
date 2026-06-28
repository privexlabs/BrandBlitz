import { Router } from "express";
import { z } from "zod";
import crypto from "crypto";
import {
  findUserById,
  findUserByPhoneHash,
  markPhoneVerified,
  updateUserWallet,
  updateUserProfile,
  getUserPublicProfileByUsername,
} from "../db/queries/users";
import { getReferralStats, ensureUserReferralCode } from "../services/referrals";
import { stroopsToUsdc } from "../lib/usdc";
import { getStreak, repairStreak, getUserActivity } from "../services/streaks";
import { query } from "../db";
import {
  sendVerificationCode,
  hashPhoneNumber,
  normalizePhoneNumber,
  verifyOtpWithBruteForceProtection,
} from "../services/phone";
import { authenticate } from "../middleware/authenticate";
import { requireActiveUser } from "../middleware/require-active-user";
import { createError } from "../middleware/error";
import { redis } from "../lib/redis";
import { apiLimiter, phoneRateLimit } from "../middleware/rate-limit";
import { getBadgesForUser } from "../services/badges";
import { config } from "../lib/config";

const router: Router = Router();

const EarningsQuerySchema = z.object({
  status: z.enum(["pending", "settled", "failed", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

function encodeEarningsCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, id: row.id })).toString(
    "base64url"
  );
}

function decodeEarningsCursor(
  cursor: string | undefined
): { created_at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      created_at?: unknown;
      id?: unknown;
    };
    if (typeof parsed.created_at !== "string" || typeof parsed.id !== "string") return null;
    return { created_at: parsed.created_at, id: parsed.id };
  } catch {
    return null;
  }
}

function toLedgerStatus(status: string): "pending" | "settled" | "failed" {
  if (status === "confirmed" || status === "sent") return "settled";
  if (status === "failed") return "failed";
  return "pending";
}

/**
 * GET /users/me
 * Full profile of the authenticated user.
 */
router.get("/me", authenticate, async (req, res) => {
  const user = await findUserById(req.user!.sub);
  if (!user) throw createError("User not found", 404);

  const safeUser = {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    username: user.username,
    avatar_url: user.avatar_url,
    stellar_address: user.stellar_address,
    embedded_wallet_address: user.embedded_wallet_address,
    phone_verified: user.phone_verified,
    age_verified: user.age_verified,
    kyc_complete: user.kyc_complete,
    state_code: user.state_code,
    streak: user.streak,
    last_play_day: user.last_play_day,
    streak_repairs_this_month: user.streak_repairs_this_month,
    streak_repair_available: user.streak_repair_available,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };

  res.json({ user: safeUser });
});

router.get("/me/streak", authenticate, async (req, res) => {
  const streak = await getStreak(req.user!.sub).catch(() => null);
  if (!streak) throw createError("User not found", 404);

  res.json(streak);
});

router.get("/:id/streak", authenticate, async (req, res) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  if (id !== req.user!.sub) throw createError("Forbidden", 403, "FORBIDDEN");

  const streak = await getStreak(id).catch(() => null);
  if (!streak) throw createError("User not found", 404);

  res.json({
    streak: streak.streak,
    last_play_day: streak.lastPlayDay,
    repair_available: streak.repairAvailable,
  });
});

router.get("/me/referrals/stats", authenticate, async (req, res) => {
  const stats = await getReferralStats(req.user!.sub);

  res.json({
    referralCode: stats.referralCode,
    invitesSent: stats.invitesSent,
    conversions: stats.conversions,
    totalEarned: stroopsToUsdc(stats.totalEarnedStroops),
    totalEarnedUsdc: stroopsToUsdc(stats.totalEarnedStroops),
  });
});

router.get("/me/referrals", authenticate, async (req, res) => {
  const userId = req.user!.sub;
  const referralCode = await ensureUserReferralCode(userId);

  const referredResult = await query<{
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    created_at: string;
    paid: boolean;
  }>(
    `SELECT
       u.id,
       u.username,
       u.display_name,
       u.avatar_url,
       u.created_at,
       COALESCE(rp.status = 'sent', FALSE) AS paid
     FROM referrals r
     JOIN users u ON r.referred_id = u.id
     LEFT JOIN referral_payouts rp ON r.id = rp.referral_id AND rp.status = 'sent'
     WHERE r.referrer_id = $1 AND u.deleted_at IS NULL
     ORDER BY u.created_at DESC`,
    [userId]
  );

  const totalsResult = await query<{
    pending_stroops: string;
    confirmed_stroops: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN referrer_id = $1 AND status = 'pending' THEN referrer_amount_stroops ELSE 0 END), 0)::text AS pending_stroops,
       COALESCE(SUM(CASE WHEN referrer_id = $1 AND status = 'sent' THEN referrer_amount_stroops ELSE 0 END), 0)::text AS confirmed_stroops
     FROM referral_payouts
     WHERE referrer_id = $1`,
    [userId]
  );

  const totals = totalsResult.rows[0] || { pending_stroops: "0", confirmed_stroops: "0" };

  res.json({
    referralCode,
    referredUsers: referredResult.rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      joinedAt: row.created_at,
      bonusPaid: row.paid,
    })),
    bonusStatus: {
      pendingUsdc: stroopsToUsdc(BigInt(totals.pending_stroops)),
      confirmedUsdc: stroopsToUsdc(BigInt(totals.confirmed_stroops)),
    },
  });
});

router.get("/me/earnings", authenticate, requireActiveUser, async (req, res) => {
  const parsed = EarningsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw createError("Invalid query parameters", 400, "INVALID_QUERY");

  const { status, limit } = parsed.data;
  const cursor = decodeEarningsCursor(parsed.data.cursor);
  if (parsed.data.cursor && !cursor) throw createError("Invalid cursor", 400, "INVALID_CURSOR");

  const params: unknown[] = [req.user!.sub];
  const where: string[] = ["user_id = $1"];

  if (status !== "all") {
    if (status === "settled") {
      where.push(`status IN ('sent', 'confirmed')`);
    } else {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
  }

  if (cursor) {
    params.push(cursor.created_at, cursor.id);
    where.push(
      `(created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`
    );
  }

  params.push(limit + 1);

  const rows = await query<{
    id: string;
    challenge_id: string;
    amount_usdc: string;
    status: string;
    created_at: string;
    settled_at: string | null;
    tx_hash: string | null;
  }>(
    `SELECT
       id,
       challenge_id,
       (amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc,
       status,
       created_at,
       CASE WHEN status IN ('sent', 'confirmed') THEN updated_at ELSE NULL END AS settled_at,
       tx_hash
     FROM payouts
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );

  const totals = await query<{
    lifetime_earned_usdc: string;
    pending_usdc: string;
  }>(
    `SELECT
       COALESCE(SUM(amount_stroops) FILTER (WHERE status IN ('sent', 'confirmed')), 0)::numeric / 10000000 AS lifetime_earned_usdc,
       COALESCE(SUM(amount_stroops) FILTER (WHERE status = 'pending'), 0)::numeric / 10000000 AS pending_usdc
     FROM payouts
     WHERE user_id = $1`,
    [req.user!.sub]
  );

  const pageRows = rows.rows.slice(0, limit);
  const nextRow = rows.rows.length > limit ? rows.rows[limit] : null;

  res.json({
    items: pageRows.map((row) => ({
      payout_id: row.id,
      amount_usdc: row.amount_usdc,
      status: toLedgerStatus(row.status),
      created_at: row.created_at,
      settled_at: row.settled_at,
      stellar_tx_hash: row.tx_hash ?? null,
      challenge_id: row.challenge_id,
    })),
    nextCursor: nextRow ? encodeEarningsCursor(nextRow) : null,
    totals: {
      lifetime_earned_usdc: totals.rows[0]?.lifetime_earned_usdc ?? "0",
      pending_usdc: totals.rows[0]?.pending_usdc ?? "0",
    },
  });
});

router.post("/streaks/repair", authenticate, async (req, res) => {
  const repaired = await repairStreak(req.user!.sub);
  if (!repaired) {
    throw createError("Monthly streak repair already used", 409, "STREAK_REPAIR_LIMIT");
  }

  res.json(repaired);
});

/**
 * GET /users/profile/:username
 * Public profile — display name, stats. No auth required.
 * Returns a redirect field if the username has been renamed.
 */
router.get("/profile/:username", apiLimiter, async (req, res) => {
  const { username } = z.object({ username: z.string() }).parse(req.params);

  // Check for username redirect first
  const redirectTarget = await redis.get(`username:redirect:${username}`);
  if (redirectTarget) {
    res.json({ redirect: redirectTarget });
    return;
  }

  const user = await getUserPublicProfileByUsername(username);
  if (!user) throw createError("User not found", 404);

  const isOwner = req.user?.sub === user.id;

  res.json({
    user: {
      userId: isOwner ? user.id : undefined,
      displayName: user.display_name,
      username: user.username,
      league: user.league,
      totalEarned: user.total_earned_usdc,
      totalChallenges: user.challenges_played,
      avatarUrl: user.avatar_url,
      streak: user.streak,
      createdAt: user.created_at,
      isOwner,
    },
  });
});

/**
 * GET /users/:id/badges
 * Returns all 8 badge definitions merged with the user's earned status.
 * Earned badges include awarded_at; locked badges are included with earned=false.
 */
router.get("/:id/badges", authenticate, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  if (id !== req.user!.sub) throw createError("Forbidden", 403, "FORBIDDEN");

  const badges = await getBadgesForUser(id);
  res.json({ badges });
});

/**
 * GET /users/:username/activity
 * Returns 365 days of activity (date and session_count) for the trailing year.
 * Public endpoint - no authentication required.
 */
router.get("/:username/activity", apiLimiter, async (req, res) => {
  const { username } = z.object({ username: z.string() }).parse(req.params);

  const user = await getUserPublicProfileByUsername(username);
  if (!user) throw createError("User not found", 404);

  const activity = await getUserActivity(user.id);
  res.json(activity);
});

/**
 * PATCH /users/me/wallet
 */
router.patch("/me/wallet", authenticate, async (req, res) => {
  const { stellarAddress } = z
    .object({ stellarAddress: z.string().min(56).max(70) })
    .strict()
    .parse(req.body);

  await updateUserWallet(req.user!.sub, stellarAddress);
  res.json({ success: true });
});

/**
 * PATCH /users/me/profile
 * Update display name and/or username. Triggers cache revalidation
 * so Next.js pages reflect the new values immediately.
 */
router.patch("/me/profile", authenticate, async (req, res) => {
  const body = z
    .object({
      displayName: z.string().trim().min(1).max(100).optional(),
      username: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .regex(/^[a-z0-9-]+$/, "Username may only contain lowercase letters, numbers, and hyphens")
        .optional(),
    })
    .parse(req.body);

  if (!body.displayName && !body.username) {
    throw createError("Nothing to update", 400);
  }

  const { oldUsername, newUsername } = await updateUserProfile(req.user!.sub, body);

  // Store redirect for old username (so visiting /profile/<old> redirects to new URL)
  if (oldUsername && oldUsername !== newUsername) {
    await redis.set(`username:redirect:${oldUsername}`, newUsername, "EX", 86400 * 365);
  }

  // Trigger Next.js cache revalidation so profile pages reflect the new data
  const revalidatePaths = [`/profile/${oldUsername}`, `/profile/${newUsername}`];

  try {
    await fetch(`${config.WEB_URL}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: config.WEBHOOK_SECRET,
        paths: revalidatePaths,
        tags: [`profile-${oldUsername}`, `profile-${newUsername}`],
      }),
    });
  } catch {
    // Non-critical — stale cache will eventually expire
    console.warn("Failed to trigger cache revalidation for profile update");
  }

  res.json({ success: true, oldUsername, newUsername });
});

/**
 * POST /users/me/phone/send
 * Send SMS verification code via Twilio.
 */
router.post("/me/phone/send", authenticate, phoneRateLimit, async (req, res) => {
  const { phone } = z.object({ phone: z.string().min(1) }).parse(req.body);
  const normalizedPhone = normalizePhoneNumber(phone);

  await sendVerificationCode(normalizedPhone);
  res.json({ success: true });
});

/**
 * POST /users/me/phone/verify
 * Confirm SMS verification code. Marks phone as verified.
 */
router.post("/me/phone/verify", authenticate, async (req, res) => {
  const { phone, code } = z
    .object({ phone: z.string(), code: z.string().length(6) })
    .parse(req.body);

  const normalizedPhone = normalizePhoneNumber(phone);
  const phoneHash = hashPhoneNumber(normalizedPhone);

  const existingUser = await findUserByPhoneHash(phoneHash);
  if (existingUser && existingUser.id !== req.user!.sub) {
    throw createError("Phone number already associated with another account", 409);
  }

  // verifyOtpWithBruteForceProtection throws 429 (with retryAfter) on lockout,
  // 400 on wrong code, and nothing on success.
  try {
    await verifyOtpWithBruteForceProtection(normalizedPhone, code);
  } catch (err: any) {
    if (err.statusCode === 429 && err.retryAfter != null) {
      res.set("Retry-After", String(err.retryAfter));
    }
    throw err;
  }

  const existingKey = `phone:hash:${phoneHash}`;
  await markPhoneVerified(req.user!.sub, phoneHash);
  await redis.set(existingKey, req.user!.sub, "EX", 86400 * 365);

  res.json({ success: true });
});

/**
 * GET /users/me/notifications
 * Returns the 50 most recent unread notifications for the authenticated user.
 */
router.get("/me/notifications", authenticate, async (req, res) => {
  const result = await query<{
    id: string;
    type: string;
    payload: Record<string, unknown>;
    read_at: string | null;
    created_at: string;
  }>(
    `SELECT id, type, payload, read_at, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.user!.sub]
  );

  res.json({ notifications: result.rows });
});

/**
 * PATCH /users/me/notifications/:id/read
 * Marks a single notification as read.
 */
router.patch("/me/notifications/:id/read", authenticate, async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const result = await query<{ id: string }>(
    `UPDATE notifications
     SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL
     RETURNING id`,
    [id, req.user!.sub]
  );

  if (result.rows.length === 0) {
    throw createError("Notification not found", 404);
  }

  res.json({ success: true });
});

/**
 * PATCH /users/me/notifications/read-all
 * Marks all unread notifications as read.
 */
router.patch("/me/notifications/read-all", authenticate, async (req, res) => {
  await query(`UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`, [
    req.user!.sub,
  ]);

  res.json({ success: true });
});

export default router;
