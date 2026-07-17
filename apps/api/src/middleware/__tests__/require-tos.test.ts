import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireCurrentTosAccepted } from "../require-tos";

const mocks = vi.hoisted(() => ({
  getCurrentLegalDocument: vi.fn(),
  findUserLegalAcceptance: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../db/queries/legal", () => ({
  getCurrentLegalDocument: mocks.getCurrentLegalDocument,
  findUserLegalAcceptance: mocks.findUserLegalAcceptance,
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
  },
}));

function buildApp(user: { sub: string } | null = { sub: "user-1" }) {
  const nextHandler = vi.fn((_req: express.Request, res: express.Response) => {
    res.json({ ok: true });
  });

  const app = express();
  app.use((req, _res, next) => {
    if (user) {
      req.user = {
        sub: user.sub,
        email: "user@example.com",
        role: "player",
      };
    }
    next();
  });
  app.post("/protected", requireCurrentTosAccepted, nextHandler);
  app.use(
    (
      err: { statusCode?: number; message?: string; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      res.status(err.statusCode ?? 500).json({ error: err.message, code: err.code });
    }
  );

  return { app, nextHandler };
}

describe("requireCurrentTosAccepted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentLegalDocument.mockResolvedValue({
      id: "tos-1",
      type: "tos",
      version: "2026.06",
      body_markdown: "# Terms",
      effective_at: "2026-06-01T00:00:00.000Z",
      created_at: "2026-06-01T00:00:00.000Z",
    });
    mocks.findUserLegalAcceptance.mockResolvedValue({
      id: "acceptance-1",
      user_id: "user-1",
      type: "tos",
      version: "2026.06",
      accepted_at: "2026-06-01T00:00:00.000Z",
      ip: "127.0.0.1",
    });
  });

  it("calls next when the user accepted the current TOS version", async () => {
    const { app, nextHandler } = buildApp();

    const res = await request(app).post("/protected");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(nextHandler).toHaveBeenCalledTimes(1);
    expect(mocks.findUserLegalAcceptance).toHaveBeenCalledWith("user-1", "tos", "2026.06");
  });

  it("returns 403 with the required TOS version header for an older acceptance", async () => {
    mocks.findUserLegalAcceptance.mockResolvedValue(null);
    const { app, nextHandler } = buildApp();

    const res = await request(app).post("/protected");

    expect(res.status).toBe(403);
    expect(res.headers["x-required-tos-version"]).toBe("2026.06");
    expect(res.body).toEqual({
      error: "Current Terms of Service must be accepted",
      code: "TOS_NOT_ACCEPTED",
    });
    expect(nextHandler).not.toHaveBeenCalled();
  });

  it("returns 403 with JSON when the user never accepted TOS", async () => {
    mocks.findUserLegalAcceptance.mockResolvedValue(null);
    const { app, nextHandler } = buildApp({ sub: "new-user" });

    const res = await request(app).post("/protected");

    expect(res.status).toBe(403);
    expect(res.type).toBe("application/json");
    expect(res.body.error).toBe("Current Terms of Service must be accepted");
    expect(nextHandler).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the current TOS lookup fails", async () => {
    mocks.getCurrentLegalDocument.mockRejectedValue(new Error("database unavailable"));
    const { app, nextHandler } = buildApp();

    const res = await request(app).post("/protected");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: "Terms of Service verification unavailable",
      code: "TOS_CHECK_UNAVAILABLE",
    });
    expect(nextHandler).not.toHaveBeenCalled();
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "Failed to load current Terms of Service",
      expect.objectContaining({ err: expect.any(Error) })
    );
  });
});
