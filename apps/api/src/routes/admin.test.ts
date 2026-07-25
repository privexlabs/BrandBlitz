import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error";
import adminRouter from "./admin";

const mocks = vi.hoisted(() => ({
  user: { sub: "admin-1", role: "admin" } as { sub: string; role: string } | null,
  query: vi.fn(),
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (mocks.user) req.user = mocks.user as express.Request["user"];
    next();
  },
}));

vi.mock("../db/index", () => ({ query: mocks.query }));
vi.mock("../db/queries/challenges", () => ({ getArchivedChallengeById: vi.fn() }));
vi.mock("../db/queries/config", () => ({ setConfig: vi.fn() }));
vi.mock("../queues/league.queue", () => ({ ensureLeagueRepeatableJobs: vi.fn() }));
vi.mock("../lib/config", () => ({ config: { NODE_ENV: "test" } }));

function createApp() {
  const app = express();
  app.use("/admin", adminRouter);
  app.use(errorHandler);
  return app;
}

const rows = [
  {
    id: "user-2",
    username: "risky",
    email: "risky@example.com",
    created_at: "2026-07-02T00:00:00.000Z",
    suspended_at: null,
    fraud_score: 5,
    total_payouts: 3,
  },
  {
    id: "user-1",
    username: null,
    email: "new@example.com",
    created_at: "2026-07-01T00:00:00.000Z",
    suspended_at: "2026-07-03T00:00:00.000Z",
    fraud_score: 2,
    total_payouts: 1,
  },
];

describe("GET /admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { sub: "admin-1", role: "admin" };
    mocks.query.mockResolvedValue({ rows });
  });

  it("returns cursor-paginated users with the default page size", async () => {
    mocks.query.mockResolvedValue({
      rows: Array.from({ length: 26 }, (_, index) => ({
        ...rows[index % rows.length],
        id: `user-${index}`,
        created_at: new Date(Date.UTC(2026, 6, 31 - index)).toISOString(),
      })),
    });

    const response = await request(createApp()).get("/admin/users");

    expect(response.status).toBe(200);
    expect(response.body.users).toHaveLength(25);
    expect(response.body.nextCursor).toEqual(expect.any(String));
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("LIMIT $2"), [0, 26]);
  });

  it("filters by minimum fraud score", async () => {
    const response = await request(createApp()).get("/admin/users?minFraudScore=4&limit=10");

    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("fraud_score >= $1"), [4, 11]);
    expect(response.body.users[0].fraudScore).toBe(5);
  });

  it("supports fraud-score ordering and cursor continuation", async () => {
    const cursor = Buffer.from(
      JSON.stringify({ fraudScore: 5, createdAt: rows[0].created_at, id: rows[0].id })
    ).toString("base64url");

    const response = await request(createApp()).get(
      `/admin/users?orderBy=fraudScore&cursor=${cursor}&limit=25`
    );

    expect(response.status).toBe(200);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("ORDER BY fraud_score DESC, created_at DESC, id DESC");
    expect(params).toEqual([0, 5, rows[0].created_at, rows[0].id, 26]);
  });

  it("returns 403 for a non-admin caller", async () => {
    mocks.user = { sub: "player-1", role: "player" };

    const response = await request(createApp()).get("/admin/users");

    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
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
