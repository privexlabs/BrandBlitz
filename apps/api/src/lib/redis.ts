import { Redis } from "ioredis";
import { logger } from "./logger";
import { config } from "./config";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on("error", (err) => {
  logger.error("Redis connection error", { err: err.message });
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
}
