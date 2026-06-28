import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryRedis {
  private readonly values = new Map<string, { hits: number; expiresAt: number }>();
  private readonly incrementSha = "increment-sha";
  private readonly getSha = "get-sha";
  public readonly calls: string[][] = [];

  async call(...args: string[]): Promise<unknown> {
    const command = args[0]?.toUpperCase();
    this.calls.push(args);

    if (command === "SCRIPT" && args[1]?.toUpperCase() === "LOAD") {
      return args[2]?.includes("INCR") ? this.incrementSha : this.getSha;
    }

    if (command === "EVALSHA") {
      const [, sha, , key] = args;
      if (sha === this.incrementSha) {
        return this.increment(key, args[4] === "1", Number.parseInt(args[5] ?? "0", 10));
      }
      if (sha === this.getSha) {
        return this.get(key);
      }
      throw new Error("NOSCRIPT");
    }

    if (command === "DECR") {
      const entry = this.current(args[1]);
      if (entry) entry.hits -= 1;
      return entry?.hits ?? 0;
    }

    if (command === "DEL") {
      return this.values.delete(args[1]) ? 1 : 0;
    }

    throw new Error(`Unsupported Redis command: ${args.join(" ")}`);
  }

  keys(): string[] {
    this.pruneExpired();
    return [...this.values.keys()];
  }

  pttl(key: string): number {
    this.pruneExpired();
    const entry = this.values.get(key);
    return entry ? entry.expiresAt - Date.now() : -2;
  }

  private increment(key: string, resetOnChange: boolean, windowMs: number): [number, number] {
    this.pruneExpired();
    const existing = this.values.get(key);

    if (!existing) {
      this.values.set(key, { hits: 1, expiresAt: Date.now() + windowMs });
      return [1, windowMs];
    }

    existing.hits += 1;
    if (resetOnChange) existing.expiresAt = Date.now() + windowMs;
    return [existing.hits, existing.expiresAt - Date.now()];
  }

  private get(key: string): [number | false, number] {
    this.pruneExpired();
    const entry = this.values.get(key);
    return entry ? [entry.hits, entry.expiresAt - Date.now()] : [false, -2];
  }

  private current(key: string): { hits: number; expiresAt: number } | undefined {
    this.pruneExpired();
    return this.values.get(key);
  }

  private pruneExpired(): void {
    for (const [key, entry] of this.values) {
      if (entry.expiresAt <= Date.now()) this.values.delete(key);
    }
  }
}

async function loadRateLimitModule(redis: { call: (...args: string[]) => Promise<unknown> }) {
  vi.resetModules();

  vi.doMock("../../lib/config", () => ({
    config: {
      NODE_ENV: "production",
    },
  }));

  vi.doMock("../../lib/redis", () => ({
    redis,
  }));

  vi.doMock("../../lib/logger", () => ({
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    },
  }));

  return import("../rate-limit");
}

function appWith(limiter: express.RequestHandler, userSub?: string): express.Express {
  const app = express();
  app.set("trust proxy", true);

  if (userSub) {
    app.use((req, _res, next) => {
      req.user = {
        sub: userSub,
        email: "user@example.com",
        role: "player",
        iss: "brandblitz-api",
        aud: "brandblitz-client",
        iat: 1,
        exp: 9_999_999_999,
      };
      next();
    });
  }

  app.use(limiter);
  app.get("/", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("rate limit Redis-backed windows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("sets a Redis TTL on the first hit and allows the bucket after the window expires", async () => {
    const redis = new MemoryRedis();
    const { challengeStartLimiter } = await loadRateLimitModule(redis);
    const app = appWith(challengeStartLimiter, "user-ttl");

    await request(app).get("/").set("X-Forwarded-For", "203.0.113.10").expect(200);

    expect(redis.keys()).toEqual(["rl:user:user-ttl"]);
    expect(redis.pttl("rl:user:user-ttl")).toBe(60 * 60 * 1000);

    for (let i = 0; i < 4; i += 1) {
      await request(app).get("/").set("X-Forwarded-For", "203.0.113.10").expect(200);
    }
    await request(app).get("/").set("X-Forwarded-For", "203.0.113.10").expect(429);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);

    await request(app).get("/").set("X-Forwarded-For", "203.0.113.10").expect(200);
  });

  it("keys anonymous requests by X-Forwarded-For when trust proxy is enabled", async () => {
    const redis = new MemoryRedis();
    const { authLimiter } = await loadRateLimitModule(redis);
    const app = appWith(authLimiter);

    for (let i = 0; i < 10; i += 1) {
      await request(app).get("/").set("X-Forwarded-For", "198.51.100.44").expect(200);
    }

    await request(app).get("/").set("X-Forwarded-For", "198.51.100.44").expect(429);
    await request(app).get("/").set("X-Forwarded-For", "198.51.100.45").expect(200);

    expect(redis.keys()).toContain("rl:ip:198.51.100.44");
    expect(redis.keys()).toContain("rl:ip:198.51.100.45");
  });

  it("falls back to the socket remote address when no X-Forwarded-For header is present", async () => {
    const redis = new MemoryRedis();
    const { authLimiter } = await loadRateLimitModule(redis);
    const app = appWith(authLimiter);

    await request(app).get("/").expect(200);

    expect(redis.keys()).toHaveLength(1);
    expect(redis.keys()[0]).toMatch(/^rl:ip:/);
    expect(redis.keys()[0]).not.toBe("rl:ip:undefined");
  });

  it("fails open when the Redis store throws", async () => {
    const redis = {
      call: vi.fn(async (...args: string[]) => {
        if (args[0]?.toUpperCase() === "SCRIPT" && args[1]?.toUpperCase() === "LOAD") {
          return args[2]?.includes("INCR") ? "increment-sha" : "get-sha";
        }
        throw new Error("redis unavailable");
      }),
    };
    const { authLimiter } = await loadRateLimitModule(redis);
    const app = appWith(authLimiter);

    await request(app).get("/").set("X-Forwarded-For", "192.0.2.50").expect(200);

    expect(redis.call).toHaveBeenCalled();
  });
});
