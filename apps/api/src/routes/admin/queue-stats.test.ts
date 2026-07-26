import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import queueStatsRouter from "./queue-stats";

const mocks = vi.hoisted(() => ({ getJobCounts: vi.fn(), getJobLogs: vi.fn() }));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function QueueMock() {
    return { getJobCounts: mocks.getJobCounts, getJobLogs: mocks.getJobLogs };
  }),
  Worker: vi.fn(function WorkerMock() {}),
}));

vi.mock("../../middleware/authenticate", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { role: "admin" } as express.Request["user"];
    next();
  },
}));

function createApp() {
  const app = express();
  app.use("/admin/queue-stats", queueStatsRouter);
  return app;
}

describe("GET /admin/queue-stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJobCounts.mockResolvedValue({
      waiting: 1,
      active: 2,
      completed: 3,
      failed: 4,
      delayed: 5,
    });
    mocks.getJobLogs.mockResolvedValue({ logs: [], count: 250 });
  });

  it("returns all queue counts and lag without caching", async () => {
    const response = await request(createApp()).get("/admin/queue-stats");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(Object.keys(response.body.queues)).toEqual([
      "payout",
      "league",
      "gdpr-erasure",
      "referral-bonus",
      "session-timeout",
      "archive",
    ]);
    expect(response.body.queues.payout).toEqual({
      waiting: 1,
      active: 2,
      completed: 3,
      failed: 4,
      delayed: 5,
      lag: 250,
    });
    expect(mocks.getJobCounts).toHaveBeenCalledTimes(6);
    expect(mocks.getJobLogs).toHaveBeenCalledTimes(6);
  });

  it("marks only an unreachable queue as unavailable", async () => {
    mocks.getJobCounts.mockRejectedValueOnce(new Error("Redis unavailable"));
    const response = await request(createApp()).get("/admin/queue-stats");
    expect(response.status).toBe(200);
    expect(response.body.queues.payout).toEqual({ error: "unavailable" });
    expect(response.body.queues.league.waiting).toBe(1);
  });
});
