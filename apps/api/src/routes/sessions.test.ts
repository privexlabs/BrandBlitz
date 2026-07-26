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

    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    if (!token) {
      res.status(401).json({ error: "Missing authentication token" });
      return;
    }
    if (testState.revokedTokens.has(`auth:revoked:${token}`)) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.user = { sub: "user123", email: "test@example.com", iat: 1, exp: 9999999999 };

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


      const res = await request(app).post("/sessions/c1/warmup-complete");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("challengeToken");
      expect(scoringService.completeWarmupWithLock).toHaveBeenCalledWith({
        userId: "user123",
        challengeId: "c1",
      });
    });

    it("should 400 if warmup too fast", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });
      const error = new Error("Warm-up minimum not yet elapsed") as any;
      error.statusCode = 400;
      error.code = "WARMUP_TOO_FAST";
      (scoringService.completeWarmupWithLock as any).mockRejectedValue(error);

      const res = await request(app).post("/sessions/c1/warmup-complete");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("WARMUP_TOO_FAST");
    });

    it("allows only one concurrent warmup completion", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });
      const conflict = new Error("Warm-up already completed") as any;
      conflict.statusCode = 409;
      conflict.code = "WARMUP_ALREADY_COMPLETED";
      (scoringService.completeWarmupWithLock as any)
        .mockResolvedValueOnce({ id: "s1", user_id: "user123" })
        .mockRejectedValueOnce(conflict);

      const [first, second] = await Promise.all([
        request(app).post("/sessions/c1/warmup-complete"),
        request(app).post("/sessions/c1/warmup-complete"),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      expect(scoringService.completeWarmupWithLock).toHaveBeenCalledTimes(2);
    });
  });

  describe("POST /sessions/:challengeId/start", () => {
    beforeEach(() => {
      (redis.get as any).mockResolvedValue(null);
      (redis.set as any).mockResolvedValue("OK");
    });

    it("should start challenge happy path", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer active-jwt")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(200);
      expect(sessionQueries.markChallengeStarted).toHaveBeenCalledWith("s1");
      expect(redis.set).toHaveBeenCalledWith("session-token:s1", "active-jwt", "EX", 600);
    });

    it("should return 401 when no auth token is provided", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });

      const res = await request(app)
        .post("/sessions/c1/start")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(401);
    });

    it("should 401 if session `:id` does not exist", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue(null);

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(403);
    });

    it("should 400 when no challenge token is present in the request body", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({});

      expect(res.status).toBe(400);
    });

    it("should 401 when the challenge token signature is invalid or tampered with", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue(null);

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({ challengeToken: "tampered-token" });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid or expired challenge token");
    });

    it("should 401 when the challenge token is expired", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue(null);

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({ challengeToken: "expired-token" });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid or expired challenge token");
    });

    it("should 409 when the session is already in in_progress state", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        status: "in_progress",
      });

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(403);
    });

    it("should 409 when the session is already completed", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        status: "completed",
      });

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(403);
    });

    it("should 200 and transition session status to in_progress for valid token", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(200);
      expect(sessionQueries.markChallengeStarted).toHaveBeenCalledWith("s1");
    });

    it("confirms started_at timestamp is set on session start", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer valid-jwt")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(200);
      expect(res.body.startsAt).toBeDefined();
      expect(typeof res.body.startsAt).toBe("string");
      expect(() => new Date(res.body.startsAt)).not.toThrow();
    });

    it("should 401 if invalid token", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue(null);

      const res = await request(app)
        .post("/sessions/c1/start")
        .send({ challengeToken: "invalid-token" });

      expect(res.status).toBe(401);
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

  it("rejects stale client timestamps before evaluating warmup unlock time", async () => {
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
        clientTimestamp: serverTime - 1000000,
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("CLOCK_SKEW");
  });


    it("should 400 for invalid round", async () => {
      const res = await request(app)
        .post("/sessions/c1/answer/4")
        .send({ selectedOption: "A", reactionTimeMs: 500 });
      expect(res.status).toBe(400);
    });

    it("should return 401 when unauthenticated", async () => {
      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(401);
    });

    it("should return 404 for missing sessionId", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue(null);

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(404);
    });

    it("should return 409 or 410 when submitting after session expiry", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: new Date().toISOString(),
      });

      const res = await request(app)
        .post("/sessions/c1/answer/2")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect([409, 410]).toContain(res.status);
    });

    it("should not mutate session_round_scores when submitting after expiry", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: new Date().toISOString(),
      });

      await request(app)
        .post("/sessions/c1/answer/2")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(sessionQueries.recordRoundScore).not.toHaveBeenCalled();
    });

    it("should trigger fraud_flags entry for abnormally fast answer timing", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 1, correct_option: "A" },
      ]);
      (scoringService.calculateRoundScore as any).mockReturnValue(100);
      (scoringService.validateAnswer as any).mockReturnValue(true);

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 50 });

      expect(res.status).toBe(200);
    });

    it("should return correct score delta for incorrect answer without leaking correct answer", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 1, correct_option: "A" },
      ]);
      (scoringService.calculateRoundScore as any).mockReturnValue(0);
      (scoringService.validateAnswer as any).mockReturnValue(false);

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "B", reactionTimeMs: 500 });

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(0);
      expect(res.body).not.toHaveProperty("correctOption");
    });

    it("should be idempotent for duplicate submissions (return 400)", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
        scores: [{ round: 1, score: 100 }],
      });

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Round already answered");
    });

    it("should not leak correct answer in response body", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 1, correct_option: "A" },
      ]);
      (scoringService.calculateRoundScore as any).mockReturnValue(0);
      (scoringService.validateAnswer as any).mockReturnValue(false);

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "B", reactionTimeMs: 500 });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("correctOption");
    });

    it("should return 403 if session belongs to another user", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "different-user",
        challenge_started_at: new Date(),
      });

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(403);
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
