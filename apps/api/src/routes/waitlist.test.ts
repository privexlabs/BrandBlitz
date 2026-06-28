import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { errorHandler } from "../middleware/error";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn().mockResolvedValue({ rows: [] }),
  blockWaitlist: false,
  waitlistLimiter: vi.fn((_: any, res: any, next: any) => {
    if (mocks.blockWaitlist) {
      res.status(429).json({ error: "Too many signup attempts, please try again later" });
      return;
    }
    next();
  }),
}));

vi.mock("../db/index", () => ({
  query: mocks.dbQuery,
  pool: { connect: vi.fn() },
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  waitlistLimiter: mocks.waitlistLimiter,
}));

import waitlistRouter from "./waitlist";

const app = express();
app.use(express.json());
app.use("/waitlist", waitlistRouter);
app.use(errorHandler);

describe("POST /waitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.blockWaitlist = false;
  });

  it("returns 201 on successful signup", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "waitlist-1" }] });

    const res = await request(app).post("/waitlist").send({ email: " TEST@example.com " });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ message: "You're on the list!" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("RETURNING id"), [
      "test@example.com",
      null,
    ]);
  });

  it("returns 200 even for a duplicate email", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post("/waitlist").send({ email: "duplicate@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "You're on the list!" });
  });

  it("accepts optional referral_code", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "waitlist-1" }] });

    const res = await request(app)
      .post("/waitlist")
      .send({ email: "ref@example.com", referral_code: "FRIENDS10" });

    expect(res.status).toBe(201);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (email) DO NOTHING"),
      ["ref@example.com", "FRIENDS10"]
    );
  });

  it("returns 422 for an invalid email", async () => {
    const res = await request(app).post("/waitlist").send({ email: "not-an-email" });

    expect(res.status).toBe(422);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("returns 422 for an email longer than 254 characters", async () => {
    const res = await request(app)
      .post("/waitlist")
      .send({ email: `${"a".repeat(245)}@example.com` });

    expect(res.status).toBe(422);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("applies the waitlist rate limiter", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [{ id: "waitlist-1" }] });

    await request(app)
      .post("/waitlist")
      .set("X-Forwarded-For", "10.0.0.1")
      .send({ email: "rate@example.com" });

    expect(mocks.waitlistLimiter).toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
    mocks.blockWaitlist = true;

    const res = await request(app)
      .post("/waitlist")
      .set("X-Forwarded-For", "10.0.0.1")
      .send({ email: "rate@example.com" });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "Too many signup attempts, please try again later" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
