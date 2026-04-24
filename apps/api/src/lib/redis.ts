import { Redis } from "ioredis";
import type { SequenceStore } from "@brandblitz/stellar";
import { logger } from "./logger";
import { config } from "./config";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
});

export const stellarSequenceStore: SequenceStore = {
  get: async (key) => redis.get(key),
  set: async (key, value) => {
    await redis.set(key, value);
  },
  del: async (key) => {
    await redis.del(key);
  },
  incr: async (key) => redis.incr(key),
  setIfAbsent: async (key, value) => (await redis.set(key, value, "NX")) === "OK",
};

export function emitCounterMetric(
  metric: string,
  value = 1,
  metadata: Record<string, unknown> = {}
): void {
  logger.info("Metric emitted", { metric, value, ...metadata });
}

redis.on("error", (err) => {
  logger.error("Redis connection error", { err: err.message });
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

export async function connectRedis(): Promise<void> {
  await redis.connect();
}
