import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { createFraudFlag } from "../db/queries/fraud-flags";
import { getSession } from "../db/queries/sessions";
import { logger } from "../lib/logger";
import { createError } from "./error";

export const MIN_HUMAN_REACTION_MS = 150;
export const MAX_HUMAN_REACTION_MS = 30_000;

function getDeviceId(req: Request): string | undefined {
  const rawHeader = req.headers["x-device-id"] ?? req.headers["x-visitor-id"];
  return Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
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
}

/**
 * Anti-cheat Layer 3 — server-side timing validation.
 * Validates that answer submission timing falls within human range.
 * Called on session answer routes.
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

  if (reactionTimeMs < MIN_HUMAN_REACTION_MS) {
    await recordFraudFlag(req, "reaction_time_below_minimum", {
      reactionTimeMs,
      minimumAllowedMs: MIN_HUMAN_REACTION_MS,
    }).catch(() => {});
    throw createError("Reaction time below minimum threshold", 403, "REACTION_TOO_FAST");
  }

  if (reactionTimeMs > MAX_HUMAN_REACTION_MS) {
    await recordFraudFlag(req, "reaction_time_above_maximum", {
      reactionTimeMs,
      maximumAllowedMs: MAX_HUMAN_REACTION_MS,
    }).catch(() => {});
  }

  next();
}

/**
 * Anti-cheat Layer 5 — Redis rate limiting.
 * Enforces: 1 competitive session per account per challenge.
 */
export async function enforceOneSessionPerChallenge(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user!.sub;
  const { challengeId } = req.params;

  try {
    const key = `session:lock:${userId}:${challengeId}`;
    const existing = await redis.get(key);

    if (existing) {
      throw createError("Already played this challenge", 409, "ALREADY_PLAYED");
    }

    // TTL of 2 hours to auto-expire if session never completes
    await redis.set(key, "1", "EX", 7200);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 409) {
      throw error;
    }

    logger.warn("Redis unavailable during one-session enforcement; failing open", {
      challengeId,
      userId,
      error: (error as Error).message,
    });
  }

  next();
}

/**
 * Anti-cheat Layer 2 — device fingerprint check.
 * Validates a stable device fingerprint header and flags shared-device abuse.
 */
export async function validateDeviceFingerprint(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const deviceId = getDeviceId(req);
  const userId = req.user?.sub;

  if (!deviceId) {
    throw createError("Missing X-Device-Id header", 400, "MISSING_DEVICE_ID");
  }

  if (!userId) {
    next();
    return;
  }

  try {
    // Check if this device is associated with too many accounts (>2 in 24h)
    const deviceKey = `device:${deviceId}:accounts`;
    await redis.sadd(deviceKey, userId);
    await redis.expire(deviceKey, 86400); // 24h
    const count = await redis.scard(deviceKey);

    if (count >= 3) {
      await recordFraudFlag(req, "multi_account_device", {
        deviceId,
        accountCount: count,
        windowSeconds: 86400,
      }).catch(() => {});
    }
  } catch (error) {
    logger.warn("Redis unavailable during device fingerprint validation; failing open", {
      userId,
      deviceId,
      error: (error as Error).message,
    });
  }

  next();
}
