import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../lib/redis";

const redisStore = process.env.NODE_ENV === "test" ? undefined : new RedisStore({
  sendCommand: (...args: string[]) => {
    const command = typeof redis.call === "function" ? redis.call : (redis as any).sendCommand;
    if (!command) {
      throw new TypeError("Redis client does not support call/sendCommand");
    }
    return command.apply(redis as any, args) as any;
  },
});

// General API rate limit: 100 req/15 min per IP
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore,
});

// Auth endpoints: 10 req/15 min per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore,
  message: { error: "Too many login attempts, please try again later" },
});

// Challenge start: 5 req/hour per IP
export const challengeStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore,
  message: { error: "Too many challenge attempts" },
});

// Upload presign: 20 req/hour per IP
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: redisStore,
});

// Webhook endpoints: 1000 req/hour (higher limit as it is internal-to-internal)
export const webhookLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => redis.call(...args) as any }),
});

