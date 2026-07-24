import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import adminRouter from "./admin";
import { errorHandler } from "../middleware/error";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  findUserById: vi.fn(),
  listUsersWithFraudScores: vi.fn(),
  jwtVerify: vi.fn(),
  redisGet: vi.fn(),
  getArchivedChallengeById: vi.fn(),
  setConfig: vi.fn(),
  ensureLeagueRepeatableJobs: vi.fn(),
  query: vi.fn(),
}));

vi.mock("../db/queries/users", () => ({
  findUserById: mocks.findUserById,
  listUsersWithFraudScores: mocks.listUsersWithFraudScores,
}));

vi.mock("../db/queries/challenges", () => ({
  getArchivedChallengeById: mocks.getArchivedChallengeById,
}));

vi.mock("../db/queries/config", () => ({
  setConfig: mocks.setConfig,
}));

vi.mock("../db/queries/payouts", () => ({
  updatePayoutFeeBumpStatus: vi.fn(),
}));

vi.mock("../queues/league.queue", () => ({
  ensureLeagueRepeatableJobs: mocks.ensureLeagueRepeatableJobs,
}));

vi.mock("../queues/dlq", () => ({
  DLQ_QUEUES: {},
  DLQ_SOURCE_QUEUES: {},
}));

vi.mock("@brandblitz/stellar", () => ({
  feeBumpTransaction: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/config", () => ({
  config: { JWT_SECRET: "test-secret" },
}));

vi.mock("../lib/redis", () => ({
  redis: { get: mocks.redisGet },
}));

vi.mock("../db/index", () => ({
  query: mocks.query,
}));

vi.mock("../middleware/rate-limit", () => ({
  webhookRotationLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: mocks.jwtVerify },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  app.use(errorHandler);
  return app;
}

const ADMIN_TOKEN = "Bearer admin-token";
const PLAYER_TOKEN = "Bearer player-token";

const ADMIN_USER = { id: "admin-uuid", role: "admin" };
const PLAYER_USER = { id: "player-uuid", role: "player" };

const SAMPLE_USERS = [
  {
    id: "user-1",
    username: "alice",
    email: "alice@example.com",
    created_at: "2026-01-15T00:00:00.000Z",
    suspended_at: null,
    fraud_score: 5,
    total_payouts: "120.5000000",
  },
  {
    id: "user-2",
    username: "bob",
    email: "bob@example.com",
    created_at: "2026-01-10T00:00:00.000Z",
    suspended_at: "2026-06-01T00:00:00.000Z",
    fraud_score: 12,
    total_payouts: "0.0000000",
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("GET /admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGet.mockResolvedValue(null);
    mocks.listUsersWithFraudScores.mockResolvedValue({
      users: SAMPLE_USERS,
      total: 2,
      nextCursor: null,
    });
  });

  it("returns 401 when no token is provided", async () => {
    const res = await request(createApp()).get("/admin/users");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin user", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: PLAYER_USER.id, email: "player@example.com", role: "player" });
    mocks.findUserById.mockResolvedValue(PLAYER_USER);

    const res = await request(createApp())
      .get("/admin/users")
      .set("Authorization", PLAYER_TOKEN);

    expect(res.status).toBe(403);
  });

  it("returns 200 with paginated users for admin", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    const res = await request(createApp())
      .get("/admin/users")
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users).toHaveLength(2);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.nextCursor).toBeNull();
  });

  it("returns expected user fields including fraudScore", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    const res = await request(createApp())
      .get("/admin/users")
      .set("Authorization", ADMIN_TOKEN);

    const user = res.body.users[0];
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("username");
    expect(user).toHaveProperty("email");
    expect(user).toHaveProperty("createdAt");
    expect(user).toHaveProperty("suspendedAt");
    expect(user).toHaveProperty("fraudScore");
    expect(user).toHaveProperty("totalPayouts");
    expect(user.fraudScore).toBe(5);
  });

  it("passes minFraudScore filter to query", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    await request(createApp())
      .get("/admin/users?minFraudScore=3")
      .set("Authorization", ADMIN_TOKEN);

    expect(mocks.listUsersWithFraudScores).toHaveBeenCalledWith(
      expect.objectContaining({ minFraudScore: 3 }),
    );
  });

  it("passes orderBy parameter to query", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    await request(createApp())
      .get("/admin/users?orderBy=fraudScore")
      .set("Authorization", ADMIN_TOKEN);

    expect(mocks.listUsersWithFraudScores).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: "fraudScore" }),
    );
  });

  it("passes cursor and limit to query", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    await request(createApp())
      .get("/admin/users?limit=10&cursor=abc123")
      .set("Authorization", ADMIN_TOKEN);

    expect(mocks.listUsersWithFraudScores).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 10, cursor: "abc123" }),
    );
  });

  it("uses default page size of 25", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    await request(createApp())
      .get("/admin/users")
      .set("Authorization", ADMIN_TOKEN);

    expect(mocks.listUsersWithFraudScores).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 25 }),
    );
  });

  it("rejects page sizes above 100", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    const res = await request(createApp())
      .get("/admin/users?limit=101")
      .set("Authorization", ADMIN_TOKEN);

    expect(res.status).toBe(400);
  });

  it("includes nextCursor in pagination response when present", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);
    mocks.listUsersWithFraudScores.mockResolvedValue({
      users: SAMPLE_USERS,
      total: 50,
      nextCursor: "eyJjcmVhdGVkX2F0Ijoi...",
    });

    const res = await request(createApp())
      .get("/admin/users")
      .set("Authorization", ADMIN_TOKEN);

    expect(res.body.pagination.nextCursor).toBe("eyJjcmVhdGVkX2F0Ijoi...");
  });

  it("defaults orderBy to createdAt", async () => {
    mocks.jwtVerify.mockReturnValue({ sub: ADMIN_USER.id, email: "admin@example.com", role: "admin" });
    mocks.findUserById.mockResolvedValue(ADMIN_USER);

    await request(createApp())
      .get("/admin/users")
      .set("Authorization", ADMIN_TOKEN);

    expect(mocks.listUsersWithFraudScores).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: "createdAt" }),
    );
  });
});
