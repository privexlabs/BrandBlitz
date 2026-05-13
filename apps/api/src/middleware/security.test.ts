import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { applySecurityMiddleware, type SecurityConfig } from "./security";

const baseConfig = {
  NODE_ENV: "production",
  WEB_URL: "https://app.brandblitz.io",
  NEXT_PUBLIC_APP_URL: "https://play.brandblitz.io",
  S3_PUBLIC_URL: "https://cdn.brandblitz.io/assets",
} satisfies SecurityConfig;

function createApp(config: SecurityConfig = baseConfig) {
  const app = express();
  applySecurityMiddleware(app, config);
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  return app;
}

describe("security middleware", () => {
  it("sets strict security headers on API responses", async () => {
    const response = await request(createApp())
      .get("/health")
      .set("Origin", "https://play.brandblitz.io")
      .expect(200);

    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain(
      "connect-src 'self' https://api.stellar.expert https://cdn.brandblitz.io"
    );
    expect(response.headers["content-security-policy"]).toContain(
      "img-src 'self' https://cdn.brandblitz.io"
    );
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains; preload"
    );
    expect(response.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(response.headers["access-control-allow-origin"]).toBe("https://play.brandblitz.io");
  });

  it("does not emit CORS credentials headers for unapproved origins", async () => {
    const response = await request(createApp())
      .get("/health")
      .set("Origin", "https://evil.example")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("falls back to WEB_URL when NEXT_PUBLIC_APP_URL is not configured", async () => {
    const configWithoutAppUrl: SecurityConfig = {
      NODE_ENV: baseConfig.NODE_ENV,
      WEB_URL: baseConfig.WEB_URL,
      S3_PUBLIC_URL: baseConfig.S3_PUBLIC_URL,
    };

    const response = await request(createApp(configWithoutAppUrl))
      .get("/health")
      .set("Origin", "https://app.brandblitz.io")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("https://app.brandblitz.io");
  });

  it("only sends HSTS in production", async () => {
    const response = await request(
      createApp({
        ...baseConfig,
        NODE_ENV: "development",
      })
    )
      .get("/health")
      .expect(200);

    expect(response.headers["strict-transport-security"]).toBeUndefined();
  });
});
