import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  query: vi.fn(),
  getUserBadges: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    del: mocks.redisDel,
  },
}));

vi.mock("../db/index", () => ({ query: mocks.query }));

vi.mock("../db/queries/badges", () => ({
  getUserBadges: mocks.getUserBadges,
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (req.headers.authorization === "Bearer admin-token") {
      req.user = { sub: "admin-user", role: "admin" };
      next();
      return;
    }

    if (req.headers.authorization === "Bearer user-token") {
      req.user = { sub: "user-1", role: "user" };
      next();
      return;
    }

    res.status(401).json({ error: "No token provided" });
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    if (req.headers.authorization === "Bearer user-token") {
      req.user = { sub: "user-1", role: "user" };
    }
    next();
  },
}));

vi.mock("../middleware/require-admin", () => ({
  requireAdmin: (req: any, _res: any, next: any) => {
    if (!req.user || req.user.role !== "admin") {
      const err: any = new Error("Forbidden");
      err.status = 403;
      throw err;
    }
    next();
  },
}));

import express from "express";
import request from "supertest";
import router from "./badges";

const app = express();
app.use(express.json());
app.use("/badges", router);

// Admin app with admin user
const adminApp = express();
adminApp.use(express.json());
adminApp.use("/badges", router);

// Non-admin app
const noAuthApp = express();
noAuthApp.use(express.json());
noAuthApp.use("/badges", router);

const fakeBadges = [
  {
    id: "first_win",
    slug: "first_win",
    name: "First Win",
    description: "Win first challenge",
    iconUrl: "/badges/first-win.svg",
    category: "challenge",
    unlockCriteria: "Complete your first non-practice challenge.",
  },
  {
    id: "league_gold",
    slug: "league_gold",
    name: "Gold Contender",
    description: "You earned promotion to the Gold League.",
    iconUrl: "/badges/league-gold.svg",
    category: "league",
    unlockCriteria: "Finish in the top 3 of your Silver league group.",
  },
];

describe("badges cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisSet.mockResolvedValue("OK");
    mocks.getUserBadges.mockResolvedValue([]);
  });

  it("returns unauthenticated badge definitions without earned state from cache", async () => {
    mocks.redisGet.mockResolvedValueOnce(JSON.stringify(fakeBadges));

    const res = await request(app).get("/badges");
    expect(res.status).toBe(200);
    expect(mocks.getUserBadges).not.toHaveBeenCalled();
    expect(res.headers["x-cache"]).toBe("HIT");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.body.badges).toHaveLength(2);
    expect(res.body.badges[0]).toMatchObject({
      id: "first_win",
      name: "First Win",
      category: "challenge",
      unlockCriteria: "Complete your first non-practice challenge.",
    });
    expect(res.body.badges[0]).not.toHaveProperty("earned");
    expect(res.body.badges[0]).not.toHaveProperty("earnedAt");
  });

  it("builds definitions on cache MISS and caches for 5 minutes", async () => {
    mocks.redisGet.mockResolvedValueOnce(null);

    const res = await request(app).get("/badges");
    expect(res.status).toBe(200);
    expect(res.body.badges.length).toBeGreaterThan(0);
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "badges:definitions",
      expect.any(String),
      "EX",
      300
    );
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("annotates earned state when optional auth succeeds", async () => {
    mocks.redisGet.mockResolvedValueOnce(JSON.stringify(fakeBadges));
    mocks.getUserBadges.mockResolvedValueOnce([
      {
        id: "ub-1",
        user_id: "user-1",
        badge_slug: "league_gold",
        awarded_at: "2026-06-28T10:00:00.000Z",
        created_at: "2026-06-28T10:00:00.000Z",
        updated_at: "2026-06-28T10:00:00.000Z",
      },
    ]);

    const res = await request(app).get("/badges").set("Authorization", "Bearer user-token");

    expect(res.status).toBe(200);
    expect(mocks.getUserBadges).toHaveBeenCalledWith("user-1");
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.body.badges).toEqual([
      expect.objectContaining({ slug: "first_win", earned: false, earnedAt: null }),
      expect.objectContaining({
        slug: "league_gold",
        earned: true,
        earnedAt: "2026-06-28T10:00:00.000Z",
      }),
    ]);
  });

  it("filters badges by category", async () => {
    mocks.redisGet.mockResolvedValueOnce(JSON.stringify(fakeBadges));

    const res = await request(app).get("/badges?category=league");

    expect(res.status).toBe(200);
    expect(res.body.badges).toHaveLength(1);
    expect(res.body.badges[0]).toMatchObject({ slug: "league_gold", category: "league" });
  });

  it("returns 200 with an empty array when no definitions are cached", async () => {
    mocks.redisGet.mockResolvedValueOnce("[]");

    const res = await request(app).get("/badges");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ badges: [] });
  });

  it("flush endpoint returns 204 and calls redis.del", async () => {
    mocks.redisDel.mockResolvedValueOnce(1);

    const res = await request(adminApp)
      .post("/badges/flush")
      .set("Authorization", "Bearer admin-token");
    expect(res.status).toBe(204);
    expect(mocks.redisDel).toHaveBeenCalledWith("badges:definitions");
  });

  it("flush endpoint returns 403 for non-admin", async () => {
    const res = await request(noAuthApp)
      .post("/badges/flush")
      .set("Authorization", "Bearer user-token");
    expect(res.status).toBe(403);
  });
});
