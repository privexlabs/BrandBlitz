import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUserPublicProfileByUsername: vi.fn(),
  getUserActivity: vi.fn(),
}));

vi.mock("../db", () => ({
  query: mocks.query,
}));

vi.mock("../db/queries/users", () => ({
  findUserById: vi.fn(),
  findUserByPhoneHash: vi.fn(),
  markPhoneVerified: vi.fn(),
  updateUserWallet: vi.fn(),
  updateUserProfile: vi.fn(),
  getUserPublicProfileByUsername: mocks.getUserPublicProfileByUsername,
}));

vi.mock("../services/referrals", () => ({
  getReferralStats: vi.fn(),
  ensureUserReferralCode: vi.fn(),
}));

vi.mock("../services/streaks", () => ({
  getStreak: vi.fn(),
  repairStreak: vi.fn(),
  getUserActivity: mocks.getUserActivity,
}));

vi.mock("../services/phone", () => ({
  sendVerificationCode: vi.fn(),
  hashPhoneNumber: (value: string) => `hash:${value}`,
  normalizePhoneNumber: (value: string) => value,
  verifyOtpWithBruteForceProtection: vi.fn(),
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { sub: "user-1", role: "user" };
    next();
  },
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  phoneRateLimit: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../services/badges", () => ({
  getBadgesForUser: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("../lib/config", () => ({
  config: {
    WEB_URL: "http://localhost:3000",
    WEBHOOK_SECRET: "test-secret",
  },
}));

import usersRouter from "./users";

const app = express();
app.use(express.json());
app.use("/users", usersRouter);
app.use(errorHandler);

const publicProfileRow = {
  id: "user-1",
  username: "alice",
  avatar_url: "https://example.com/avatar.png",
  joined_at: "2026-01-01T00:00:00.000Z",
  win_count: 3,
  total_sessions_played: 10,
  accuracy_pct: 88.5,
  league_tier: "gold",
  league_rank: 2,
  league_season: "2026-06-22",
  badges: Array.from({ length: 7 }, (_, index) => ({
    badge_slug: `badge_${index}`,
    awarded_at: `2026-06-${28 - index}T00:00:00.000Z`,
  })),
  email: "private@example.com",
  phone: "+15550000000",
  stellar_account_id: "GPRIVATE",
  kyc_status: "approved",
};

describe("GET /users/:username/public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a public profile without private account fields", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [publicProfileRow] });

    const res = await request(app).get("/users/alice/public").expect(200);

    expect(res.body).toEqual({
      username: "alice",
      avatar_url: "https://example.com/avatar.png",
      joined_at: "2026-01-01T00:00:00.000Z",
      win_count: 3,
      total_sessions_played: 10,
      accuracy_pct: 88.5,
      league: {
        tier: "gold",
        rank: 2,
        season: "2026-06-22",
      },
      badges: publicProfileRow.badges.slice(0, 6),
    });
    expect(res.body).not.toHaveProperty("email");
    expect(res.body).not.toHaveProperty("phone");
    expect(res.body).not.toHaveProperty("stellar_account_id");
    expect(res.body).not.toHaveProperty("kyc_status");
  });

  it("queries only active, non-deleted users by username", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [publicProfileRow] });

    await request(app).get("/users/alice/public").expect(200);

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("AND deleted_at IS NULL"), [
      "alice",
    ]);
    expect(mocks.query.mock.calls[0][0]).toContain("AND status = 'active'");
  });

  it("returns 404 for deactivated or missing accounts", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get("/users/deactivated/public").expect(404);

    expect(res.body).toEqual({ error: "User not found" });
  });
});
