import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../lib/integrity", () => ({
  computeSessionHmac: vi.fn().mockReturnValue("mock-hmac"),
}));

describe("sessions warmup-complete endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getChallengeById.mockResolvedValue({
      id: "challenge-1",
      status: "active",
    });
    mocks.getSession.mockResolvedValue({
      id: "session-1",
      user_id: "user-1",
      challenge_id: "challenge-1",
    });
    mocks.redisSet.mockResolvedValue("OK");
    mocks.markWarmupCompleted.mockResolvedValue(undefined);
  });

  it("accepts warmup completion with no client timestamp", async () => {
    const mockApp = await import("express");
    const app = mockApp.default();
    
    // Import router after mocks are set up
    const sessionsRouter = await import("./sessions");
    app.use("/sessions", sessionsRouter.default);

    const serverTime = Date.now();
    mocks.redisGet.mockResolvedValue((serverTime - 10000).toString()); // 10 seconds ago

    const response = await (await import("supertest")).default(app)
      .post("/sessions/challenge-1/warmup-complete")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.challengeToken).toBeDefined();
    expect(mocks.createFraudFlag).not.toHaveBeenCalled();
  });

  it("accepts warmup completion with valid client timestamp within ±5s", async () => {
    const mockApp = await import("express");
    const app = mockApp.default();
    
    const sessionsRouter = await import("./sessions");
    app.use("/sessions", sessionsRouter.default);

    const serverTime = Date.now();
    mocks.redisGet.mockResolvedValue((serverTime - 10000).toString());

    const response = await (await import("supertest")).default(app)
      .post("/sessions/challenge-1/warmup-complete")
      .send({
        clientTimestamp: serverTime + 2000, // 2 seconds in future (within tolerance)
      });

    expect(response.status).toBe(200);
    expect(mocks.createFraudFlag).not.toHaveBeenCalled();
  });

  it("rejects warmup completion with client timestamp >5s clock skew", async () => {
    const mockApp = await import("express");
    const app = mockApp.default();
    
    const sessionsRouter = await import("./sessions");
    app.use("/sessions", sessionsRouter.default);

    const serverTime = Date.now();
    mocks.redisGet.mockResolvedValue((serverTime - 10000).toString());

    const response = await (await import("supertest")).default(app)
      .post("/sessions/challenge-1/warmup-complete")
      .send({
        clientTimestamp: serverTime + 10000, // 10 seconds in future
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("CLOCK_SKEW");
  });

  it("uses server time for warmup enforcement regardless of client timestamp", async () => {
    const mockApp = await import("express");
    const app = mockApp.default();
    
    const sessionsRouter = await import("./sessions");
    app.use("/sessions", sessionsRouter.default);

    const serverTime = Date.now();
    // Warmup should still be active (unlockAt is in the future)
    mocks.redisGet.mockResolvedValue((serverTime + 5000).toString());

    const response = await (await import("supertest")).default(app)
      .post("/sessions/challenge-1/warmup-complete")
      .send({
        clientTimestamp: serverTime - 1000000, // Very old client time (should be ignored)
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("WARMUP_TOO_FAST");
    expect(response.body.remainingMs).toBeGreaterThan(0);
  });

  it("enforces warmup minimum using server-side Date.now() only", async () => {
    const mockApp = await import("express");
    const app = mockApp.default();
    
    const sessionsRouter = await import("./sessions");
    app.use("/sessions", sessionsRouter.default);

    const serverTime = Date.now();
    // Set unlock time 2 seconds in the future
    mocks.redisGet.mockResolvedValue((serverTime + 2000).toString());

    const response = await (await import("supertest")).default(app)
      .post("/sessions/challenge-1/warmup-complete")
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("WARMUP_TOO_FAST");
    expect(response.body.remainingMs).toBeGreaterThan(0);
    expect(response.body.remainingMs).toBeLessThanOrEqual(2000);
  });
});
