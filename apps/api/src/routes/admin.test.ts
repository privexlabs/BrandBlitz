import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";

const mockQuery = vi.fn();
const mockPoolConnect = vi.fn();
const mockFindUserById = vi.fn();

vi.mock("../db", () => ({
  query: mockQuery,
  pool: {
    connect: mockPoolConnect,
  },
}));

vi.mock("../db/queries/users", () => ({
  findUserById: mockFindUserById,
}));

vi.mock("../queues/session-timeout.queue", () => ({
  sessionTimeoutQueue: {
    add: vi.fn(),
  },
}));

vi.mock("../middleware/rate-limit", () => ({
  webhookRotationLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { errorHandler } from "../middleware/error";

let app: express.Express;
const adminUserId = "admin-123";
const targetUserId = "user-456";

const adminToken = () =>
  jwt.sign(
    { sub: adminUserId, email: "admin@example.com", role: "admin" },
    process.env.JWT_SECRET as string,
    {
      expiresIn: "1h",
      issuer: process.env.JWT_ISSUER ?? "brandblitz-api",
      audience: process.env.JWT_AUDIENCE ?? "brandblitz-client",
    }
  );

const userToken = () =>
  jwt.sign(
    { sub: targetUserId, email: "user@example.com", role: "player" },
    process.env.JWT_SECRET as string,
    {
      expiresIn: "1h",
      issuer: process.env.JWT_ISSUER ?? "brandblitz-api",
      audience: process.env.JWT_AUDIENCE ?? "brandblitz-client",
    }
  );

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
  app = express();
  app.use(express.json());
  const { default: adminRouter } = await import("./admin");
  app.use("/admin", adminRouter);
  app.use(errorHandler);
});

beforeEach(() => {
  mockQuery.mockReset();
  mockPoolConnect.mockReset();
  mockFindUserById.mockReset();
});

describe("GET /admin/users/:id", () => {
  it("returns user profile with sessions, fraud flags, and payouts", async () => {
    mockFindUserById.mockResolvedValue({ id: adminUserId, role: "admin" });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: targetUserId,
          email: "user@example.com",
          display_name: "Test User",
          username: "testuser",
          avatar_url: "https://example.com/avatar.png",
          status: "active",
          suspended_at: null,
          suspension_reason: null,
          created_at: "2026-01-01T00:00:00Z",
          total_earned_usdc: "1000.00",
          challenges_played: 50,
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "session-1",
          challenge_id: "challenge-1",
          score: 95,
          completed_at: "2026-05-01T10:00:00Z",
          duration_ms: 180000,
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "flag-1",
          flag_type: "content_report",
          severity: "high",
          created_at: "2026-04-01T10:00:00Z",
          resolved_at: null,
        },
      ],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "payout-1",
          amount_usdc: "100.00",
          status: "pending",
          created_at: "2026-05-01T10:00:00Z",
          updated_at: "2026-05-01T10:00:00Z",
          challenge_id: "challenge-1",
        },
      ],
    });

    const response = await request(app)
      .get(`/admin/users/${targetUserId}`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(200);

    expect(response.body.profile.id).toBe(targetUserId);
    expect(response.body.profile.email).toBe("user@example.com");
    expect(response.body.recentSessions).toHaveLength(1);
    expect(response.body.recentSessions[0].sessionId).toBe("session-1");
    expect(response.body.fraudFlags).toHaveLength(1);
    expect(response.body.fraudFlags[0].flagType).toBe("content_report");
    expect(response.body.payoutHistory).toHaveLength(1);
    expect(response.body.payoutHistory[0].amount_usdc).toBe("100.00");
  });

  it("returns 404 when user does not exist", async () => {
    mockFindUserById.mockResolvedValue({ id: adminUserId, role: "admin" });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get(`/admin/users/${targetUserId}`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .expect(404);

    expect(response.body.error).toBe("User not found");
  });

  it("returns 403 for non-admin user", async () => {
    mockFindUserById.mockResolvedValue({ id: targetUserId, role: "player" });

    const response = await request(app)
      .get(`/admin/users/${targetUserId}`)
      .set("Authorization", `Bearer ${userToken()}`)
      .expect(403);

    expect(response.body.error).toBe("Forbidden");
  });
});

describe("POST /admin/users/:id/suspend", () => {
  it("suspends user and enqueues session terminations", async () => {
    mockFindUserById.mockResolvedValue({ id: adminUserId, role: "admin" });

    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockClient.query
      .mockResolvedValueOnce({
        rows: [
          { id: targetUserId, status: "active", suspended_at: null },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: "session-1" }, { id: "session-2" }],
      })
      .mockResolvedValueOnce();

    mockPoolConnect.mockResolvedValue(mockClient);

    const response = await request(app)
      .post(`/admin/users/${targetUserId}/suspend`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ reason: "Violation of terms", durationDays: 30 })
      .expect(200);

    expect(response.body.suspended_user_id).toBe(targetUserId);
    expect(mockClient.query).toHaveBeenCalledWith("BEGIN");
    expect(mockClient.query).toHaveBeenCalledWith("COMMIT");
  });

  it("returns 404 when user does not exist", async () => {
    mockFindUserById.mockResolvedValue({ id: adminUserId, role: "admin" });

    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce();

    mockPoolConnect.mockResolvedValue(mockClient);

    const response = await request(app)
      .post(`/admin/users/${targetUserId}/suspend`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ reason: "Violation" })
      .expect(404);

    expect(response.body.error).toBe("User not found");
  });

  it("returns 409 when user is already suspended", async () => {
    mockFindUserById.mockResolvedValue({ id: adminUserId, role: "admin" });

    const mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    };

    mockClient.query.mockResolvedValueOnce({
      rows: [
        {
          id: targetUserId,
          status: "suspended",
          suspended_at: "2026-04-01T00:00:00Z",
        },
      ],
    });

    mockPoolConnect.mockResolvedValue(mockClient);

    const response = await request(app)
      .post(`/admin/users/${targetUserId}/suspend`)
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ reason: "Violation" })
      .expect(409);

    expect(response.body.error).toBe("User is already suspended");
  });

  it("returns 403 for non-admin user", async () => {
    mockFindUserById.mockResolvedValue({ id: targetUserId, role: "player" });

    const response = await request(app)
      .post(`/admin/users/${targetUserId}/suspend`)
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ reason: "Violation" })
      .expect(403);

    expect(response.body.error).toBe("Forbidden");
  });
});
