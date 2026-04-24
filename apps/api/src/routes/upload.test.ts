import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mockSend = vi.fn();
const mockGetSignedUrl = vi.fn();
const mockGetPublicUrl = vi.fn((bucket: string, key: string) => `https://public/${bucket}/${key}`);

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { sub: "user-123", email: "test@example.com" };
    return next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { sub: "user-123", email: "test@example.com" };
    return next();
  },
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
  challengeStartLimiter: (_req: any, _res: any, next: any) => next(),
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@brandblitz/storage", () => ({
  s3: { send: mockSend },
  BUCKETS: {
    BRAND_ASSETS: "brand-assets",
    SHARE_CARDS: "share-cards",
  },
  getPublicUrl: mockGetPublicUrl,
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import { errorHandler } from "../middleware/error";

let app: express.Express;
let registerRoutes: (app: express.Express) => void;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const routes = await import("../routes");
  registerRoutes = routes.registerRoutes;
  registerRoutes(app);
  app.use(errorHandler);
});

beforeEach(() => {
  vi.resetAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("upload routes integration", () => {
  it("POST /upload/presign returns signed URL and public URL for valid brand-logo uploads", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://signed-url");

    const response = await request(app)
      .post("/upload/presign")
      .send({
        type: "brand-logo",
        contentType: "image/png",
        contentLength: 1024 * 1024,
      })
      .expect(200);

    expect(response.body).toEqual({
      uploadUrl: "https://signed-url",
      key: expect.stringMatching(/^logos\/[\w-]{36}$/),
      publicUrl: expect.stringContaining("https://public/brand-assets/logos/"),
      expiresIn: 60,
    });
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);

    const command = mockGetSignedUrl.mock.calls[0][1];
    expect(command.input).toMatchObject({
      Bucket: "brand-assets",
      ContentType: "image/png",
      Key: response.body.key,
    });

    expect(mockGetPublicUrl).toHaveBeenCalledWith(
      "brand-assets",
      response.body.key
    );
  });

  it("POST /upload/presign rejects disallowed MIME types with 400", async () => {
    const response = await request(app)
      .post("/upload/presign")
      .send({
        type: "brand-logo",
        contentType: "image/gif",
        contentLength: 1024,
      })
      .expect(400);

    expect(response.body.error).toBe("Validation Error");
  });

  it("POST /upload/presign rejects oversize contentLength with 400", async () => {
    const response = await request(app)
      .post("/upload/presign")
      .send({
        type: "brand-logo",
        contentType: "image/png",
        contentLength: 3 * 1024 * 1024,
      })
      .expect(400);

    expect(response.body.error).toBe(
      "Content length exceeds maximum of 2MB for brand-logo"
    );
  });

  it("POST /upload/verify returns 200 when the object exists", async () => {
    mockSend.mockResolvedValueOnce({});

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/test-key" })
      .expect(200);

    expect(response.body).toEqual({
      exists: true,
      publicUrl: "https://public/brand-assets/logos/test-key",
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]?.input).toMatchObject({
      Bucket: "brand-assets",
      Key: "logos/test-key",
    });
  });

  it("POST /upload/verify returns 404 when the object does not exist", async () => {
    mockSend.mockRejectedValueOnce(new Error("Not found"));

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/test-key" })
      .expect(404);

    expect(response.body.error).toBe("File not found in storage");
  });
});
