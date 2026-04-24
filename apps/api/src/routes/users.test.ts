import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";

var mockFindUserById = vi.fn();
var mockUpdateUserWallet = vi.fn();
var mockMarkPhoneVerified = vi.fn();
var mockSendVerificationCode = vi.fn();
var mockCheckVerificationCode = vi.fn();
var mockRedisIncr = vi.fn();
var mockRedisExpire = vi.fn();
var mockRedisGet = vi.fn();
var mockRedisSet = vi.fn();
var mockRedisDel = vi.fn();

vi.mock("../db/queries/users", () => ({
  findUserById: mockFindUserById,
  updateUserWallet: mockUpdateUserWallet,
  markPhoneVerified: mockMarkPhoneVerified,
}));

vi.mock("../services/phone", () => ({
  sendVerificationCode: mockSendVerificationCode,
  checkVerificationCode: mockCheckVerificationCode,
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

import { errorHandler } from "../middleware/error";

let app: express.Express;
const userId = "user-123";
const phone = "+15550000000";
const phoneHash = crypto.createHash("sha256").update(phone).digest("hex");
const authToken = () =>
  jwt.sign(
    { sub: userId, email: "me@example.com" },
    process.env.JWT_SECRET as string,
    { expiresIn: "1h" }
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

let registerRoutes: (app: express.Express) => void;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
  app = express();
  app.use(express.json());
  const routes = await import("../routes");
  registerRoutes = routes.registerRoutes;
  registerRoutes(app);
  app.use(errorHandler);
});

beforeEach(() => {
  mockFindUserById.mockReset();
  mockUpdateUserWallet.mockReset();
  mockMarkPhoneVerified.mockReset();
  mockSendVerificationCode.mockReset();
  mockCheckVerificationCode.mockReset();
  mockRedisIncr.mockReset();
  mockRedisExpire.mockReset();
  mockRedisGet.mockReset();
  mockRedisSet.mockReset();
  mockRedisDel.mockReset();
});

afterAll(() => {
  vi.resetAllMocks();
});

describe("users routes integration", () => {
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
    mockCheckVerificationCode.mockResolvedValue(true);

    const response = await request(app)
      .post("/users/me/phone/verify")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone, code: "123456" })
      .expect(200);

    expect(response.body).toEqual({ success: true });
    expect(mockMarkPhoneVerified).toHaveBeenCalledWith(userId, phoneHash);
    expect(mockRedisSet).toHaveBeenCalledWith(
      `phone:hash:${phoneHash}`,
      userId,
      "EX",
      86400 * 365
    );
    expect(mockRedisDel).toHaveBeenCalledWith(`phone:verify:${phoneHash}`);
  });

  it("POST /users/me/phone/verify rejects invalid code and bumps attempt counter", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockCheckVerificationCode.mockResolvedValue(false);
    mockRedisIncr.mockResolvedValue(1);

    const response = await request(app)
      .post("/users/me/phone/verify")
      .set("Authorization", `Bearer ${authToken()}`)
      .send({ phone, code: "000000" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid verification code");
    expect(mockRedisIncr).toHaveBeenCalledWith(`phone:verify:${phoneHash}`);
    expect(mockMarkPhoneVerified).not.toHaveBeenCalled();
  });
});
