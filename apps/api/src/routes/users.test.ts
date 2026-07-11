import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

var mockFindUserById = vi.fn();
var mockFindUserByPhoneHash = vi.fn();
var mockGetUserPublicProfileByUsername = vi.fn();
var mockUpdateUserWallet = vi.fn();
var mockMarkPhoneVerified = vi.fn();
var mockSendVerificationCode = vi.fn();
var mockCheckVerificationCode = vi.fn();
var mockRedisIncr = vi.fn();
var mockRedisExpire = vi.fn();
var mockRedisGet = vi.fn();
var mockRedisSet = vi.fn();
var mockRedisDel = vi.fn();
var mockGetStreak = vi.fn();
var mockRepairStreak = vi.fn();
var mockQuery = vi.fn();
var mockVerifyOtpWithBruteForceProtection = vi.fn();

vi.mock("../db/queries/users", () => ({
  findUserById: mockFindUserById,
  findUserByPhoneHash: mockFindUserByPhoneHash,
  getUserPublicProfileByUsername: mockGetUserPublicProfileByUsername,
  updateUserWallet: mockUpdateUserWallet,
  markPhoneVerified: mockMarkPhoneVerified,
}));

vi.mock("../services/phone", () => ({
  sendVerificationCode: mockSendVerificationCode,
  checkVerificationCode: mockCheckVerificationCode,
  verifyOtpWithBruteForceProtection: (...args: any[]) =>
    mockVerifyOtpWithBruteForceProtection(...args),
  normalizePhoneNumber: (value: string) => value,
  hashPhoneNumber: (value: string) => crypto.createHash("sha256").update(value).digest("hex"),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  },
}));

vi.mock("../db", () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

vi.mock("../db/index", () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

vi.mock("../services/streaks", () => ({
  getStreak: mockGetStreak,
  repairStreak: mockRepairStreak,
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
  challengeStartLimiter: (_req: any, _res: any, next: any) => next(),
  reportLimiter: (_req: any, _res: any, next: any) => next(),
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
  webhookLimiter: (_req: any, _res: any, next: any) => next(),
  phoneRateLimit: async (req: any, res: any, next: any) => {
    const key = `phone:send:${req.body?.phone}`;
    const attempts = await mockRedisIncr(key);
    if (attempts === 1) await mockRedisExpire(key, 300);
    if (attempts > 3) {
      res.status(429).json({ error: "Too many verification attempts, please try again later" });
      return;
    }
    next();
  },
}));

vi.mock("@brandblitz/stellar", () => ({
  WARMUP_MIN_SECONDS: 20,
  MIN_POOL_STROOPS: 1_000_000_000n,
  validateMuxedAccount: vi.fn(),
  createMuxedAccount: vi.fn(),
  feeBumpTransaction: vi.fn(),
  getHorizonServer: vi.fn(() => ({})),
  getAccountUsdcBalance: vi.fn(),
  EscrowClient: vi.fn(),
}));

import { errorHandler } from "../middleware/error";

let app: express.Express;
const userId = "user-123";
const phone = "+15550000000";
const phoneHash = crypto.createHash("sha256").update(phone).digest("hex");
const authToken = () =>
  jwt.sign(
    {
      sub: userId,
      email: "me@example.com",
      role: "user",
      iss: "brandblitz-api",
      aud: "brandblitz-client",
    },
    process.env.JWT_SECRET as string,
    {
      expiresIn: "1h",
    }
  );

const userRecord = {
  id: userId,
  email: "me@example.com",
  google_id: "google-1",
  phone_hash: "old-hash",
  phone_verified: false,
  age_verified: true,
  kyc_complete: false,
  stellar_address: "GABCDEFGHJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHJKL",
  embedded_wallet_address: null,
  avatar_url: "https://example.com/avatar.png",
  state_code: "CA",
  streak: 5,
  last_play_day: "2026-04-24",
  streak_repairs_this_month: 1,
  streak_repair_available: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  display_name: "Test User",
  username: "testuser",
};

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
  app = express();
  app.use(express.json());
  const usersRoutes = await import("./users");
  app.use("/users", usersRoutes.default);
  app.use(errorHandler);
});

beforeEach(() => {
  mockFindUserById.mockReset();
  mockFindUserByPhoneHash.mockReset();
  mockGetUserPublicProfileByUsername.mockReset();
  mockUpdateUserWallet.mockReset();
  mockMarkPhoneVerified.mockReset();
  mockSendVerificationCode.mockReset();
  mockCheckVerificationCode.mockReset();
  mockRedisIncr.mockReset();
  mockRedisExpire.mockReset();
  mockRedisGet.mockReset();
  mockRedisSet.mockReset();
  mockRedisDel.mockReset();
  mockGetStreak.mockReset();
  mockRepairStreak.mockReset();
  mockQuery.mockReset();
  mockVerifyOtpWithBruteForceProtection.mockReset();
});

afterAll(() => {
  vi.resetAllMocks();
});

describe("users routes integration", () => {
  it("GET /users/me/streak returns formatted streak data", async () => {
    mockGetStreak.mockResolvedValue({
      streak: 7,
      lastPlayDay: "2026-05-30",
      repairAvailable: true,
      nextMilestone: 14,
      progress: 0.5,
      milestoneJustHit: true,
    });

    const response = await request(app)
      .get("/users/me/streak")
      .set("Authorization", `Bearer ${authToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      streak: 7,
      lastPlayDay: "2026-05-30",
      repairAvailable: true,
      nextMilestone: 14,
      progress: 0.5,
      milestoneJustHit: true,
    });
    expect(mockGetStreak).toHaveBeenCalledWith(userId);
  });

  it("POST /users/streaks/repair repairs an eligible streak", async () => {
    mockRepairStreak.mockResolvedValue({
      streak: 5,
      lastPlayDay: "2026-05-30",
      repairAvailable: false,
      nextMilestone: 7,
      progress: 5 / 7,
      milestoneJustHit: false,
    });

    const response = await request(app)
      .post("/users/streaks/repair")
      .set("Authorization", `Bearer ${authToken()}`)
      .expect(200);

    expect(response.body.streak).toBe(5);
    expect(response.body.repairAvailable).toBe(false);
  });

  it("GET /users/me returns only safe user fields", async () => {
    mockFindUserById.mockResolvedValue(userRecord);

    const response = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${authToken()}`)
      .expect(200);

    expect(response.body.user).toEqual({
      id: userRecord.id,
      email: userRecord.email,
      display_name: userRecord.display_name,
      username: userRecord.username,
      avatar_url: userRecord.avatar_url,
      stellar_address: userRecord.stellar_address,
      embedded_wallet_address: userRecord.embedded_wallet_address,
      phone_verified: userRecord.phone_verified,
      age_verified: userRecord.age_verified,
      kyc_complete: userRecord.kyc_complete,
      state_code: userRecord.state_code,
      streak: userRecord.streak,
      last_play_day: userRecord.last_play_day,
      streak_repairs_this_month: userRecord.streak_repairs_this_month,
      streak_repair_available: userRecord.streak_repair_available,
      created_at: userRecord.created_at,
      updated_at: userRecord.updated_at,
    });
    expect(response.body.user.google_id).toBeUndefined();
    expect(response.body.user.phone_hash).toBeUndefined();
  });

  it("PATCH /users/me/wallet rejects invalid Stellar addresses", async () => {
    const response = await request(app)
      .patch("/users/me/wallet")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ stellarAddress: "INVALID" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation Error");
  });

  it("PATCH /users/me/wallet accepts valid Stellar addresses", async () => {
    const address = "G".padEnd(56, "A");

    const response = await request(app)
      .patch("/users/me/wallet")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ stellarAddress: address })
      .expect(200);

    expect(response.body).toEqual({ success: true });
    expect(mockUpdateUserWallet).toHaveBeenCalledWith(userId, address);
  });

  it("GET /users/search rejects missing and too-short search queries", async () => {
    await request(app)
      .get("/users/search")
      .set("Authorization", `Bearer ${authToken()}`)
      .expect(400);

    await request(app)
      .get("/users/search?q=a")
      .set("Authorization", `Bearer ${authToken()}`)
      .expect(400);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /users/search requires authentication", async () => {
    await request(app).get("/users/search?q=al").expect(401);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("GET /users/search returns an empty array when no usernames match", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    const response = await request(app)
      .get("/users/search?q=zz")
      .set("Authorization", `Bearer ${authToken()}`)
      .expect(200);

    expect(response.body).toEqual([]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("username ILIKE $1"), [
      "zz%",
      20,
      0,
    ]);
  });

  it("GET /users/search paginates username prefix matches and excludes sensitive fields", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          id: "user-alice",
          username: "alice",
          avatar_url: "https://example.com/alice.png",
          total_earnings: "12.5000000",
          email: "alice@example.com",
          phone_hash: "secret",
          role: "admin",
        },
      ],
    });

    const response = await request(app)
      .get("/users/search?q=Al&page=2")
      .set("Authorization", `Bearer ${authToken()}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: "user-alice",
        username: "alice",
        avatar_url: "https://example.com/alice.png",
        total_earnings: "12.5000000",
      },
    ]);
    expect(response.body[0].email).toBeUndefined();
    expect(response.body[0].phone_hash).toBeUndefined();
    expect(response.body[0].role).toBeUndefined();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("ORDER BY username ASC"), [
      "Al%",
      20,
      20,
    ]);
  });

  it("POST /users/me/phone/send rate limits after 3 sends", async () => {
    mockRedisIncr
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);

    await request(app)
      .post("/users/me/phone/send")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone })
      .expect(200);

    await request(app)
      .post("/users/me/phone/send")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone })
      .expect(200);

    await request(app)
      .post("/users/me/phone/send")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone })
      .expect(200);

    await request(app)
      .post("/users/me/phone/send")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone })
      .expect(429);

    expect(mockSendVerificationCode).toHaveBeenCalledTimes(3);
    expect(mockRedisExpire).toHaveBeenCalledWith(`phone:send:${phone}`, 300);
  });

  it("POST /users/me/phone/verify approves correct code and marks phone verified", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockVerifyOtpWithBruteForceProtection.mockResolvedValue(undefined);

    const response = await request(app)
      .post("/users/me/phone/verify")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone, code: "123456" })
      .expect(200);

    expect(response.body).toEqual({ success: true });
    expect(mockVerifyOtpWithBruteForceProtection).toHaveBeenCalledWith(phone, "123456");
    expect(mockMarkPhoneVerified).toHaveBeenCalledWith(userId, phoneHash);
    expect(mockRedisSet).toHaveBeenCalledWith(`phone:hash:${phoneHash}`, userId, "EX", 86400 * 365);
  });

  it("POST /users/me/phone/verify rejects invalid code and bumps attempt counter", async () => {
    mockRedisGet.mockResolvedValue(null);
    const invalidCode = new Error("Invalid verification code") as Error & { statusCode: number };
    invalidCode.statusCode = 400;
    mockVerifyOtpWithBruteForceProtection.mockRejectedValue(invalidCode);

    const response = await request(app)
      .post("/users/me/phone/verify")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone, code: "000000" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid verification code");
    expect(mockVerifyOtpWithBruteForceProtection).toHaveBeenCalledWith(phone, "000000");
    expect(mockMarkPhoneVerified).not.toHaveBeenCalled();
  });
});
