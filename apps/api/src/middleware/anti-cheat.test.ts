import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_HUMAN_REACTION_MS,
  MIN_HUMAN_REACTION_MS,
  enforceOneSessionPerChallenge,
  validateDeviceFingerprint,
  validateReactionTime,
} from "./anti-cheat";

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisScard: vi.fn(),
  redisSadd: vi.fn(),
  redisExpire: vi.fn(),
  createFraudFlag: vi.fn(),
  getSession: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    scard: mocks.redisScard,
    sadd: mocks.redisSadd,
    expire: mocks.redisExpire,
  },
}));

vi.mock("../db/queries/fraud-flags", () => ({
  createFraudFlag: mocks.createFraudFlag,
}));

vi.mock("../db/queries/sessions", () => ({
  getSession: mocks.getSession,
}));

vi.mock("../lib/logger", () => ({
  logger: {
    warn: mocks.loggerWarn,
  },
}));

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    headers: {},
    user: { sub: "user-1", email: "user-1@example.com", iat: 0, exp: 0 },
    ...overrides,
  } as Request;
}

function makeNext(): NextFunction {
  return vi.fn();
}

describe("anti-cheat middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through when no reaction time is provided", async () => {
    const next = makeNext();

    await validateReactionTime(
      makeRequest({
        body: {},
      }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.createFraudFlag).not.toHaveBeenCalled();
  });

  it("blocks reactions below the minimum threshold", async () => {
    mocks.getSession.mockResolvedValue({ id: "session-1" });

    await expect(
      validateReactionTime(
        makeRequest({
          body: { reactionTimeMs: MIN_HUMAN_REACTION_MS - 1 },
          params: { challengeId: "challenge-1" },
        }),
        {} as Response,
        makeNext()
      )
    ).rejects.toMatchObject({
      message: "Reaction time below minimum threshold",
      statusCode: 403,
      code: "REACTION_TOO_FAST",
    });

    expect(mocks.createFraudFlag).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      flagType: "reaction_time_below_minimum",
      details: {
        reactionTimeMs: MIN_HUMAN_REACTION_MS - 1,
        minimumAllowedMs: MIN_HUMAN_REACTION_MS,
      },
    });
  });

  it("flags reactions above the maximum threshold but still allows the request", async () => {
    const next = makeNext();
    mocks.getSession.mockResolvedValue({ id: "session-1" });

    await validateReactionTime(
      makeRequest({
        body: { reactionTimeMs: MAX_HUMAN_REACTION_MS + 1 },
        params: { challengeId: "challenge-1" },
      }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.createFraudFlag).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      flagType: "reaction_time_above_maximum",
      details: {
        reactionTimeMs: MAX_HUMAN_REACTION_MS + 1,
        maximumAllowedMs: MAX_HUMAN_REACTION_MS,
      },
    });
  });

  it("returns 409 when a duplicate session lock already exists", async () => {
    mocks.redisGet.mockResolvedValue("1");

    await expect(
      enforceOneSessionPerChallenge(
        makeRequest({ params: { challengeId: "challenge-1" } }),
        {} as Response,
        makeNext()
      )
    ).rejects.toMatchObject({
      message: "Already played this challenge",
      statusCode: 409,
      code: "ALREADY_PLAYED",
    });

    expect(mocks.redisSet).not.toHaveBeenCalled();
  });

  it("sets the Redis session lock when no duplicate exists", async () => {
    const next = makeNext();
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");

    await enforceOneSessionPerChallenge(
      makeRequest({ params: { challengeId: "challenge-1" } }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "session:lock:user-1:challenge-1",
      "1",
      "EX",
      7200
    );
  });

  it("records a fraud flag when 3 or more accounts share the same device", async () => {
    const next = makeNext();
    mocks.getSession.mockResolvedValue({ id: "session-1" });
    mocks.redisSadd.mockResolvedValue(1);
    mocks.redisExpire.mockResolvedValue(1);
    mocks.redisScard.mockResolvedValue(3);

    await validateDeviceFingerprint(
      makeRequest({
        params: { challengeId: "challenge-1" },
        headers: { "x-device-id": "device-123" },
      }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.createFraudFlag).toHaveBeenCalledWith({
      sessionId: "session-1",
      userId: "user-1",
      flagType: "multi_account_device",
      details: {
        deviceId: "device-123",
        accountCount: 3,
        windowSeconds: 86400,
      },
    });
  });

  it("supports the legacy visitor header and an attached sessionId", async () => {
    const next = makeNext();
    mocks.redisSadd.mockResolvedValue(1);
    mocks.redisExpire.mockResolvedValue(1);
    mocks.redisScard.mockResolvedValue(3);

    const req = makeRequest({
      params: { challengeId: "challenge-1" },
      headers: { "x-visitor-id": ["device-legacy", "ignored"] as unknown as string },
    });
    (req as Request & { sessionId: string }).sessionId = "session-from-request";

    await validateDeviceFingerprint(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.createFraudFlag).toHaveBeenCalledWith({
      sessionId: "session-from-request",
      userId: "user-1",
      flagType: "multi_account_device",
      details: {
        deviceId: "device-legacy",
        accountCount: 3,
        windowSeconds: 86400,
      },
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("returns 400 when the device header is missing", async () => {
    await expect(
      validateDeviceFingerprint(makeRequest(), {} as Response, makeNext())
    ).rejects.toMatchObject({
      message: "Missing X-Device-Id header",
      statusCode: 400,
      code: "MISSING_DEVICE_ID",
    });
  });

  it("passes through when there is no authenticated user but the device header exists", async () => {
    const next = makeNext();

    await validateDeviceFingerprint(
      makeRequest({
        headers: { "x-device-id": "device-123" },
        user: undefined,
      }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.redisSadd).not.toHaveBeenCalled();
  });

  it("skips fraud flag creation when reaction timing is suspicious but user context is missing", async () => {
    const next = makeNext();

    await validateReactionTime(
      makeRequest({
        body: { reactionTimeMs: MAX_HUMAN_REACTION_MS + 1 },
        user: undefined,
      }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.createFraudFlag).not.toHaveBeenCalled();
  });

  it("fails open when Redis is unavailable during one-session enforcement", async () => {
    const next = makeNext();
    mocks.redisGet.mockRejectedValue(new Error("redis down"));

    await enforceOneSessionPerChallenge(
      makeRequest({ params: { challengeId: "challenge-1" } }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "Redis unavailable during one-session enforcement; failing open",
      expect.objectContaining({
        challengeId: "challenge-1",
        userId: "user-1",
        error: "redis down",
      })
    );
  });

  it("fails open when Redis is unavailable during device fingerprint validation", async () => {
    const next = makeNext();
    mocks.redisSadd.mockRejectedValue(new Error("redis down"));

    await validateDeviceFingerprint(
      makeRequest({
        headers: { "x-device-id": "device-123" },
      }),
      {} as Response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "Redis unavailable during device fingerprint validation; failing open",
      expect.objectContaining({
        userId: "user-1",
        deviceId: "device-123",
        error: "redis down",
      })
    );
  });
});
