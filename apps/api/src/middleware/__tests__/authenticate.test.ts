import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticate } from "../authenticate";

const mocks = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  redisGet: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
  default: {
    verify: mocks.jwtVerify,
  },
}));

vi.mock("../../lib/config", () => ({
  config: {
    JWT_SECRET: "unit-test-jwt-secret",
    JWT_ISSUER: "brandblitz-api",
    JWT_AUDIENCE: "brandblitz-client",
  },
}));

vi.mock("../../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
  },
}));

function mockRequest(authorization?: string): Request {
  return {
    headers: authorization ? { authorization } : {},
  } as Request;
}

function mockResponse(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;

  vi.mocked(res.status).mockReturnValue(res);
  vi.mocked(res.json).mockReturnValue(res);

  return res;
}

function expectUnauthorized(res: Response, message: string): void {
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: message });
}

describe("authenticate middleware failure modes", () => {
  const validPayload = {
    sub: "user-123",
    email: "user@example.com",
    role: "player",
    iss: "brandblitz-api",
    aud: "brandblitz-client",
    iat: 1,
    exp: 9_999_999_999,
  };

  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGet.mockResolvedValue(null);
    mocks.jwtVerify.mockReturnValue(validPayload);
    next = vi.fn();
  });

  it("accepts a valid bearer token and stores the JWT subject on req.user", async () => {
    const req = mockRequest("Bearer valid-token");
    const res = mockResponse();

    await authenticate(req, res, next);

    expect(jwt.verify).toHaveBeenCalledWith("valid-token", "unit-test-jwt-secret");
    expect(req.user).toEqual(validPayload);
    expect(req.user?.sub).toBe("user-123");
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects an expired JWT without populating req.user", async () => {
    mocks.jwtVerify.mockImplementation(() => {
      throw new Error("jwt expired");
    });
    const req = mockRequest("Bearer expired-token");
    const res = mockResponse();

    await authenticate(req, res, next);

    expectUnauthorized(res, "Invalid or expired token");
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("rejects a token signed with the wrong secret without populating req.user", async () => {
    mocks.jwtVerify.mockImplementation(() => {
      throw new Error("invalid signature");
    });
    const req = mockRequest("Bearer wrong-secret-token");
    const res = mockResponse();

    await authenticate(req, res, next);

    expect(jwt.verify).toHaveBeenCalledWith("wrong-secret-token", "unit-test-jwt-secret");
    expectUnauthorized(res, "Invalid or expired token");
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("rejects a malformed token without populating req.user", async () => {
    mocks.jwtVerify.mockImplementation(() => {
      throw new Error("jwt malformed");
    });
    const req = mockRequest("Bearer not-a-jwt");
    const res = mockResponse();

    await authenticate(req, res, next);

    expectUnauthorized(res, "Invalid or expired token");
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("rejects a missing authorization header without populating req.user", async () => {
    const req = mockRequest();
    const res = mockResponse();

    await authenticate(req, res, next);

    expect(jwt.verify).not.toHaveBeenCalled();
    expectUnauthorized(res, "No token provided");
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it("rejects an authorization header without the Bearer prefix without populating req.user", async () => {
    const req = mockRequest("valid-token");
    const res = mockResponse();

    await authenticate(req, res, next);

    expect(jwt.verify).not.toHaveBeenCalled();
    expectUnauthorized(res, "No token provided");
    expect(next).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});
