import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  findUserById: vi.fn(),
}));

vi.mock("../db", () => ({
  query: mocks.query,
}));

vi.mock("../db/queries/users", () => ({
  findUserById: mocks.findUserById,
  findUserByPhoneHash: vi.fn(),
  markPhoneVerified: vi.fn(),
  updateUserWallet: vi.fn(),
  updateUserProfile: vi.fn(),
  getUserPublicProfileByUsername: vi.fn(),
}));

vi.mock("../services/referrals", () => ({
  getReferralStats: vi.fn(),
  ensureUserReferralCode: vi.fn(),
}));

vi.mock("../services/streaks", () => ({
  getStreak: vi.fn(),
  repairStreak: vi.fn(),
  getUserActivity: vi.fn(),
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

const activeUser = {
  id: "user-1",
  status: "active",
  suspended_at: null,
};

const payoutRows = [
  {
    id: "payout-2",
    challenge_id: "challenge-2",
    amount_usdc: "2.5000000",
    status: "sent",
    created_at: "2026-06-28T10:00:00.000Z",
    settled_at: "2026-06-28T10:05:00.000Z",
    tx_hash: "tx-2",
  },
  {
    id: "payout-1",
    challenge_id: "challenge-1",
    amount_usdc: "1.0000000",
    status: "pending",
    created_at: "2026-06-27T10:00:00.000Z",
    settled_at: null,
    tx_hash: null,
  },
  {
    id: "payout-extra",
    challenge_id: "challenge-extra",
    amount_usdc: "9.0000000",
    status: "failed",
    created_at: "2026-06-26T10:00:00.000Z",
    settled_at: null,
    tx_hash: null,
  },
];

function mockTotals() {
  return {
    rows: [{ lifetime_earned_usdc: "3.5000000000000000", pending_usdc: "1.0000000000000000" }],
  };
}

describe("GET /users/me/earnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUserById.mockResolvedValue(activeUser);
  });

  it("returns scoped payout records with normalized ledger statuses and totals", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: payoutRows.slice(0, 2) })
      .mockResolvedValueOnce(mockTotals());

    const res = await request(app).get("/users/me/earnings").expect(200);

    expect(mocks.findUserById).toHaveBeenCalledWith("user-1");
    expect(mocks.query.mock.calls[0][0]).toContain("WHERE user_id = $1");
    expect(mocks.query.mock.calls[0][1]).toEqual(["user-1", 26]);
    expect(res.body).toEqual({
      items: [
        {
          payout_id: "payout-2",
          amount_usdc: "2.5000000",
          status: "settled",
          created_at: "2026-06-28T10:00:00.000Z",
          settled_at: "2026-06-28T10:05:00.000Z",
          stellar_tx_hash: "tx-2",
          challenge_id: "challenge-2",
        },
        {
          payout_id: "payout-1",
          amount_usdc: "1.0000000",
          status: "pending",
          created_at: "2026-06-27T10:00:00.000Z",
          settled_at: null,
          stellar_tx_hash: null,
          challenge_id: "challenge-1",
        },
      ],
      nextCursor: null,
      totals: {
        lifetime_earned_usdc: "3.5000000000000000",
        pending_usdc: "1.0000000000000000",
      },
    });
  });

  it("applies status filtering for settled payouts", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [payoutRows[0]] })
      .mockResolvedValueOnce(mockTotals());

    await request(app).get("/users/me/earnings?status=settled").expect(200);

    expect(mocks.query.mock.calls[0][0]).toContain("status IN ('sent', 'confirmed')");
    expect(mocks.query.mock.calls[0][1]).toEqual(["user-1", 26]);
  });

  it("returns a cursor when more rows exist than the requested limit", async () => {
    mocks.query.mockResolvedValueOnce({ rows: payoutRows }).mockResolvedValueOnce(mockTotals());

    const res = await request(app).get("/users/me/earnings?limit=2").expect(200);

    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).toBeTypeOf("string");
    const decoded = JSON.parse(Buffer.from(res.body.nextCursor, "base64url").toString("utf8"));
    expect(decoded).toEqual({
      created_at: "2026-06-26T10:00:00.000Z",
      id: "payout-extra",
    });
  });

  it("uses cursor predicates on subsequent pages", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ created_at: "2026-06-27T10:00:00.000Z", id: "payout-1" })
    ).toString("base64url");
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce(mockTotals());

    await request(app).get(`/users/me/earnings?cursor=${cursor}`).expect(200);

    expect(mocks.query.mock.calls[0][0]).toContain("created_at < $2");
    expect(mocks.query.mock.calls[0][1]).toEqual([
      "user-1",
      "2026-06-27T10:00:00.000Z",
      "payout-1",
      26,
    ]);
  });
});
