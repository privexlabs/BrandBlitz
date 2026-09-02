import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../require-admin";

function buildApp(user?: { role?: string }) {
  const nextHandler = vi.fn((_req: express.Request, res: express.Response) => {
    res.json({ ok: true });
  });

  const app = express();
  app.use((req, _res, next) => {
    if (user) {
      req.user = {
        sub: "test-user",
        email: "test@example.com",
        role: user.role as string,
      };
    }
    next();
  });
  app.get("/admin-only", requireAdmin, nextHandler);
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

describe("requireAdmin", () => {
  it("allows admin users through", async () => {
    const { app, nextHandler } = buildApp({ role: "admin" });

    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(nextHandler).toHaveBeenCalledTimes(1);
  });

  it("allows super_admin users through", async () => {
    const { app, nextHandler } = buildApp({ role: "super_admin" });

    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(nextHandler).toHaveBeenCalledTimes(1);
  });

  it.each(["user", "brand"])("rejects %s users with a JSON 403", async (role) => {
    const { app, nextHandler } = buildApp({ role });

    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(403);
    expect(res.type).toBe("application/json");
    expect(res.body).toEqual({ error: "Forbidden", code: "FORBIDDEN" });
    expect(nextHandler).not.toHaveBeenCalled();
  });

  it("rejects authenticated users with no role", async () => {
    const { app, nextHandler } = buildApp({});

    const res = await request(app).get("/admin-only");

    expect(res.status).toBe(403);
    expect(res.type).toBe("application/json");
    expect(res.body.error).toBe("Forbidden");
    expect(nextHandler).not.toHaveBeenCalled();
  });
});
