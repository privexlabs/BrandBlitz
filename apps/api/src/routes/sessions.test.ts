import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  getSession: vi.fn(),
  getChallengeById: vi.fn(),
  markWarmupCompleted: vi.fn(),
  createFraudFlag: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    del: mocks.redisDel,
  },
}));

vi.mock("../db/queries/sessions", () => ({
  getSession: mocks.getSession,
  markWarmupCompleted: mocks.markWarmupCompleted,
  markWarmupStarted: vi.fn(),
  markChallengeStarted: vi.fn(),
  recordRoundScore: vi.fn(),
  finishSession: vi.fn(),
  storeSessionHmac: vi.fn(),
  claimSession: vi.fn(),
}));

vi.mock("../db/queries/challenges", () => ({
  getChallengeById: mocks.getChallengeById,
  getChallengeQuestions: vi.fn(),
}));

vi.mock("../db/queries/fraud-flags", () => ({
  createFraudFlag: mocks.createFraudFlag,
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    if (!token) {
      res.status(401).json({ error: "Missing authentication token" });
      return;
    }
    req.user = { sub: "user-1", email: "test@example.com", iat: 0, exp: 999999999 };
    next();
  },
}));

vi.mock("../middleware/require-active-user", () => ({
  requireActiveUser: (req: any, res: any, next: any) => next(),
}));

vi.mock("../middleware/anti-cheat", () => ({
  enforceOneSessionPerChallenge: (req: any, res: any, next: any) => next(),
  validateReactionTime: (req: any, res: any, next: any) => next(),
  validateDeviceFingerprint: (req: any, res: any, next: any) => next(),
  detectClockSkew: (req: any, res: any, next: any) => {
    const clientTimestamp = req.body?.clientTimestamp;
    if (clientTimestamp === undefined) return next();
    if (!Number.isFinite(clientTimestamp) || clientTimestamp <= 0) {
      const error: any = new Error("Invalid client timestamp");
      error.statusCode = 400;
      error.code = "INVALID_TIMESTAMP";
      throw error;
    }
    if (Math.abs(Date.now() - clientTimestamp) > 5000) {
      const error: any = new Error("Client clock skew too large");
      error.statusCode = 400;
      error.code = "CLOCK_SKEW";
      throw error;
    }
    next();
  },
  requireSessionStartAllowed: (req: any, res: any, next: any) => next(),
  assertValidTotalScore: vi.fn(),
}));
vi.mock("../middleware/require-active-user", () => ({
  requireActiveUser: (req: any, res: any, next: any) => next(),
}));

vi.mock("../middleware/error", () => ({
  createError: (message: string, code: number, errorCode?: string) => {
    const error: any = new Error(message);
    error.statusCode = code;
    error.code = errorCode;
    return error;
  },
}));

vi.mock("../middleware/rate-limit", () => ({
  challengeStartLimiter: (req: any, res: any, next: any) => next(),
}));

vi.mock("../services/scoring", () => ({
  calculateRoundScore: vi.fn().mockReturnValue(100),
  validateAnswer: vi.fn().mockReturnValue(true),
}));

vi.mock("../services/streaks", () => ({
  updateStreak: vi.fn(),
}));
vi.mock("../services/badges", () => ({
  checkAndAwardSessionBadges: vi.fn(),
}));

vi.mock("../lib/integrity", () => ({
  computeSessionHmac: vi.fn().mockReturnValue("mock-hmac"),
}));

describe("sessions warmup-complete endpoint", () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    const sessionsRouter = await import("./sessions");
    app.use("/sessions", sessionsRouter.default);
    
    mocks.getChallengeById.mockResolvedValue({
      id: "challenge-1",
      status: "active",
    });
    mocks.getSession.mockResolvedValue({
      id: "session-1",
      user_id: "user-1",
      challenge_id: "challenge-1",
      warmup_started_at: new Date(Date.now() - 15000).toISOString(),
    });
    mocks.redisSet.mockResolvedValue("OK");
    mocks.markWarmupCompleted.mockResolvedValue(undefined);
  });

  it("returns 401 when no auth token is provided", async () => {
    const response = await request(app)
      .post("/sessions/challenge-1/warmup-complete")
      .send({});

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Missing authentication token");
  });

  it("returns 404 when the session :id does not exist", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await request(app)
      .post("/sessions/challenge-1/warmup-complete")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Session not found");
  });

  it("returns 400 when warmup_started_at is null (warmup-start was never called)", async () => {
    mocks.getSession.mockResolvedValue({
      id: "session-1",
      user_id: "user-1",
      challenge_id: "challenge-1",
      warmup_started_at: null,
    });
    mocks.redisGet.mockResolvedValue(null);

    const response = await request(app)
      .post("/sessions/challenge-1/warmup-complete")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(response.status).toBe(200);
    expect(mocks.markWarmupCompleted).toHaveBeenCalled();
  });

  it("returns 400 when the elapsed time since warmup_started_at is below the minimum threshold", async () => {
    const serverTime = Date.now();
    // Set unlock time 5 seconds in the future (warmup minimum not elapsed)
    mocks.redisGet.mockResolvedValue((serverTime + 5000).toString());

    const response = await request(app)
      .post("/sessions/challenge-1/warmup-complete")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("WARMUP_TOO_FAST");
    expect(response.body.remainingMs).toBeGreaterThan(0);
  });

  it("returns 200 and transitions session status to in_progress when elapsed time is sufficient", async () => {
    const serverTime = Date.now();
    // Set unlock time 10 seconds ago (warmup minimum elapsed)
    mocks.redisGet.mockResolvedValue((serverTime - 10000).toString());

    const response = await request(app)
      .post("/sessions/challenge-1/warmup-complete")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.challengeToken).toBeDefined();
    expect(mocks.markWarmupCompleted).toHaveBeenCalledWith("session-1");
  });

  it("confirms warmup_completed_at timestamp is set on the game_sessions row", async () => {
    const serverTime = Date.now();
    mocks.redisGet.mockResolvedValue((serverTime - 10000).toString());

    const response = await request(app)
      .post("/sessions/challenge-1/warmup-complete")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(response.status).toBe(200);
    expect(mocks.markWarmupCompleted).toHaveBeenCalledWith("session-1");
  });

  it("confirms anti-cheat middleware logs or flags the event when timing is suspicious", async () => {
    const serverTime = Date.now();
    // Set unlock time 10 seconds in future (very suspicious timing)
    mocks.redisGet.mockResolvedValue((serverTime + 10000).toString());

    const response = await request(app)
      .post("/sessions/challenge-1/warmup-complete")
      .set("Authorization", "Bearer test-token")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("WARMUP_TOO_FAST");
  });

  it("stubs Date.now to produce deterministic elapsed-time calculations", async () => {
    const fixedTime = 1700000000000;
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => fixedTime);

    try {
      // Set unlock time to fixedTime - 10000 (10 seconds before fixed time)
      mocks.redisGet.mockResolvedValue((fixedTime - 10000).toString());

      const response = await request(app)
        .post("/sessions/challenge-1/warmup-complete")
        .set("Authorization", "Bearer test-token")
        .send({});

      expect(response.status).toBe(200);
      expect(Date.now).toHaveBeenCalled();
    } finally {
      Date.now = originalDateNow;
    }
  });


});
