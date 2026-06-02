import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { createFraudFlag } from "../db/queries/fraud-flags";
import { getConfig } from "../db/queries/config";
import { getSession, claimSession } from "../db/queries/sessions";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { computeFingerprint } from "../lib/fingerprint";
import { createError } from "./error";

export const BOT_REACTION_THRESHOLD_MS = 80;
// Fallback defaults — override at runtime via PATCH /admin/config/anti_cheat.thresholds
export const MIN_HUMAN_REACTION_MS = 150;
export const MAX_HUMAN_REACTION_MS = 30_000;
export const MAX_CLOCK_SKEW_MS = 5000; // ±5 seconds tolerance for client timestamps

const THRESHOLDS_CACHE_KEY = "config:cache:anti_cheat.thresholds";
const THRESHOLDS_CONFIG_KEY = "anti_cheat.thresholds";
const CACHE_TTL_SECONDS = 5;

interface AntiCheatThresholds {
  min_human_reaction_ms: number;
  max_human_reaction_ms: number;
}

async function getThresholds(): Promise<AntiCheatThresholds> {
  try {
    const cached = await redis.get(THRESHOLDS_CACHE_KEY);
    if (cached) return JSON.parse(cached) as AntiCheatThresholds;

    const config = await getConfig(THRESHOLDS_CONFIG_KEY);
    const thresholds: AntiCheatThresholds = {
      min_human_reaction_ms:
        (config?.min_human_reaction_ms as number) ?? MIN_HUMAN_REACTION_MS,
      max_human_reaction_ms:
        (config?.max_human_reaction_ms as number) ?? MAX_HUMAN_REACTION_MS,
    };

    await redis.set(THRESHOLDS_CACHE_KEY, JSON.stringify(thresholds), "EX", CACHE_TTL_SECONDS);
    return thresholds;
  } catch {
    return {
      min_human_reaction_ms: MIN_HUMAN_REACTION_MS,
      max_human_reaction_ms: MAX_HUMAN_REACTION_MS,
    };
  }
}

async function resolveSessionId(req: Request): Promise<string | undefined> {
  const existingSessionId = (req as any).sessionId as string | undefined;
  if (existingSessionId) return existingSessionId;

  const challengeId = req.params.challengeId;
  const userId = req.user?.sub;
  if (!challengeId || !userId) return undefined;

  const session = await getSession(userId, challengeId);
  return session?.id;
}

async function recordFraudFlag(
  req: Request,
  flagType: string,
  details?: Record<string, unknown>
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) return;

  const sessionId = await resolveSessionId(req);
  if (!sessionId) return;

  await createFraudFlag({ sessionId, userId, flagType, details });

  const severity = (details?.severity as string) || "warning";
  metrics.inc("antiCheat.flags_total", { severity, type: flagType });
}

/**
 * Anti-cheat Layer 4 — client clock skew detection.
 * Validates client-supplied timestamps are within ±5 seconds of server time.
 * Flags requests with excessive clock skew as potential manipulation attempts.
 */
export async function detectClockSkew(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { clientTimestamp } = req.body as { clientTimestamp?: number };

  if (clientTimestamp === undefined) {
    next();
    return;
  }

  if (!Number.isFinite(clientTimestamp) || clientTimestamp <= 0) {
    await recordFraudFlag(req, "invalid_client_timestamp", {
      clientTimestamp,
      severity: "warning",
    }).catch(() => {});
    throw createError("Invalid client timestamp", 400, "INVALID_TIMESTAMP");
  }

  const serverTime = Date.now();
  const clockSkewMs = Math.abs(serverTime - clientTimestamp);

  if (clockSkewMs > MAX_CLOCK_SKEW_MS) {
    await recordFraudFlag(req, "clock_skew", {
      clientTimestamp,
      serverTime,
      clockSkewMs,
      severity: "warning",
    }).catch(() => {});
    throw createError("Client clock skew too large", 400, "CLOCK_SKEW");
  }

  next();
}

/**
 * Anti-cheat Layer 3 — server-side timing validation.
 * Validates that answer submission timing falls within human range.
 * Thresholds are read from app_config (5s Redis cache) with fallback to defaults.
 */
export async function validateReactionTime(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { reactionTimeMs } = req.body as { reactionTimeMs?: number };

  if (reactionTimeMs === undefined) {
    next();
    return;
  }

  if (reactionTimeMs < BOT_REACTION_THRESHOLD_MS) {
    await recordFraudFlag(req, "reaction_time_bot_threshold", {
      reactionTimeMs,
      severity: "critical",
    }).catch(() => {});
    throw createError("Reaction time impossible for humans", 403, "REACTION_IMPOSSIBLE");
  }

  const thresholds = await getThresholds();

  if (reactionTimeMs < thresholds.min_human_reaction_ms) {
    await recordFraudFlag(req, "reaction_time_below_minimum", {
      reactionTimeMs,
      severity: "warning",
    }).catch(() => {});
  }

  if (reactionTimeMs > thresholds.max_human_reaction_ms) {
    await recordFraudFlag(req, "reaction_time_above_maximum", {
      reactionTimeMs,
      severity: "info",
    }).catch(() => {});
  }

  next();
}

/**
 * Enforces: 1 competitive session per account per challenge.
 * Uses the DB UNIQUE constraint atomically — no check-then-act race.
 */
export async function enforceOneSessionPerChallenge(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user!.sub;
  const { challengeId } = req.params;

  const session = await claimSession({
    userId,
    challengeId,
    deviceId:
      (req.headers["x-device-id"] as string | undefined) ??
      (req.headers["x-visitor-id"] as string | undefined),
    isPractice: req.body.isPractice === true,
  });

  if (session) {
    (req as any).session = session;
    next();
    return;
  }

  // Session already exists — fetch and return existing one idempotently
  const existing = await getSession(userId, challengeId);
  if (!existing) {
    throw createError("Session not found", 404);
  }
  (req as any).session = existing;
  next();
}

/**
 * Anti-cheat Layer 2 — stable device fingerprint check.
 * Derives a server-side fingerprint from (visitorId | deviceId) + IP /24 + UA hash.
 * Rejects sessions when the fingerprint is shared by >2 accounts in 24 h.
 */
export async function validateDeviceFingerprint(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const rawVisitorId = req.headers["x-visitor-id"];
  const rawDeviceId = req.headers["x-device-id"];

  const visitorId = Array.isArray(rawVisitorId) ? rawVisitorId[0] : rawVisitorId;
  const deviceId = Array.isArray(rawDeviceId) ? rawDeviceId[0] : rawDeviceId;

  if (!visitorId && !deviceId) {
    throw createError("Missing X-Device-Id header", 400, "MISSING_DEVICE_ID");
  }

  const userId = req.user?.sub;
  if (!userId) {
    next();
    return;
  }

  try {
    const fingerprint = computeFingerprint({
      visitorId,
      deviceId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    const fpKey = `fp:${fingerprint}:accounts`;
    await redis.sadd(fpKey, userId);
    await redis.expire(fpKey, 86400); // 24 h window
    const count = await redis.scard(fpKey);

    if (count >= 3) {
      metrics.inc("antiCheat.fingerprint_collision_total", {
        fingerprint: fingerprint.slice(0, 8),
      });
      await recordFraudFlag(req, "multi_account_fingerprint", {
        fingerprint: fingerprint.slice(0, 8),
        accountCount: count,
        windowSeconds: 86400,
        severity: "critical",
      }).catch(() => {});
      throw createError(
        "Session rejected due to fingerprint collision",
        403,
        "FINGERPRINT_COLLISION"
      );
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error;
    }
    logger.warn("Redis unavailable during device fingerprint validation; failing open", {
      userId,
      error: (error as Error).message,
    });
  }

  next();
}
