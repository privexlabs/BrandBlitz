import type { Server } from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { errorHandler } from "../middleware/error";
import webhooksRouter from "./webhooks";
import { signWebhookPayload, WEBHOOK_REPLAY_TTL_SECONDS } from "../middleware/verify-webhook";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getChallengeByMemo: vi.fn(),
  getChallengeByDepositTxHash: vi.fn(),
  updateChallengeStatus: vi.fn(),
  findPayoutByTxHash: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  redisSet: vi.fn(),
}));

const getChallengeByMemoMock = mocks.getChallengeByMemo;
const getChallengeByDepositTxHashMock = mocks.getChallengeByDepositTxHash;
const updateChallengeStatusMock = mocks.updateChallengeStatus;
const findPayoutByTxHashMock = mocks.findPayoutByTxHash;
const loggerInfoMock = mocks.loggerInfo;
const loggerWarnMock = mocks.loggerWarn;
const redisSetMock = mocks.redisSet;

vi.mock("../db/queries/challenges", () => ({
  getChallengeByMemo: mocks.getChallengeByMemo,
  getChallengeByDepositTxHash: mocks.getChallengeByDepositTxHash,
  updateChallengeStatus: mocks.updateChallengeStatus,
}));

vi.mock("../db/queries/payouts", () => ({
  findPayoutByTxHash: mocks.findPayoutByTxHash,
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  webhookLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/config", () => ({
  config: {
    WEBHOOK_SECRET: "test-secret",
  },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: vi.fn(),
  },
}));

vi.mock("../lib/redis", () => ({
  redis: { call: vi.fn(), set: mocks.redisSet },
}));

// ── Test server helpers ────────────────────────────────────────────────────────

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    })
  );
  app.use("/webhooks", webhooksRouter);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function depositBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    memo: "550e8400-e29b-41d4-a716-446655440000",
    txHash: "a".repeat(64),
    amount: "10.0000000",
    ...overrides,
  };
}

function signedWebhookInit(
  body: Record<string, unknown>,
  options: {
    webhookId?: string;
    timestamp?: string;
    secret?: string;
    signature?: string;
  } = {}
): { headers: Record<string, string>; body: string } {
  const rawBody = JSON.stringify(body);
  const timestamp = options.timestamp ?? Date.now().toString();
  const secret = options.secret ?? "test-secret";

  return {
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": secret,
      "X-Webhook-Id": options.webhookId ?? "webhook-test-id",
      "X-Webhook-Timestamp": timestamp,
      "X-Webhook-Signature": options.signature ?? signWebhookPayload(secret, timestamp, rawBody),
    },
    body: rawBody,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Webhooks API", () => {
  let currentServer: Server | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = "test-secret";
    redisSetMock.mockResolvedValue("OK");

    getChallengeByMemoMock.mockResolvedValue({
      id: "challenge-1",
      status: "pending_deposit",
    });
    getChallengeByDepositTxHashMock.mockResolvedValue(null);
    findPayoutByTxHashMock.mockResolvedValue(null);
    updateChallengeStatusMock.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (currentServer) {
        currentServer.close(() => resolve());
        currentServer = undefined;
        return;
      }
      resolve();
    });
  });

  describe("POST /webhooks/stellar/deposit", () => {
    it("activates a challenge on a valid webhook", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody();
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(200);
      expect(updateChallengeStatusMock).toHaveBeenCalledWith("challenge-1", "active", {
        depositTx: "a".repeat(64),
      });
    });

    it("is idempotent for already active challenges", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      getChallengeByMemoMock.mockResolvedValue({ id: "challenge-1", status: "active" });
      const body = depositBody();
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(200);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown memo", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      getChallengeByMemoMock.mockResolvedValue(null);
      const body = depositBody();
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(404);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("returns 200 and no-ops for duplicate tx hashes", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      getChallengeByDepositTxHashMock.mockResolvedValue({ id: "challenge-older" });
      const body = depositBody({ txHash: "b".repeat(64) });
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(200);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("rejects the wrong shared secret", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody();
      const signed = signedWebhookInit(body, { secret: "wrong-secret" });

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(401);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("rejects a wrong HMAC signature", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody();
      const signed = signedWebhookInit(body, {
        signature: `sha256=${"0".repeat(64)}`,
      });

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(401);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("rejects stale webhook timestamps", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody();
      const signed = signedWebhookInit(body, {
        timestamp: String(Date.now() - 6 * 60 * 1000),
      });

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(401);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("returns a no-op for replayed webhook ids", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      redisSetMock.mockResolvedValue(null);
      const body = depositBody();
      const signed = signedWebhookInit(body, { webhookId: "already-seen" });

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "duplicate_webhook_ignored",
      });
      expect(redisSetMock).toHaveBeenCalledWith(
        "stellar-webhook:already-seen",
        "1",
        "EX",
        WEBHOOK_REPLAY_TTL_SECONDS,
        "NX"
      );
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("returns 400 for missing required fields", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody();
      delete body.txHash;
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(400);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("rejects an empty memo", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody({ memo: "" });
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(400);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("rejects an empty tx hash", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody({ txHash: "" });
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(400);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });

    it("rejects unknown fields", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      const body = depositBody({ extra: "unexpected" });
      const signed = signedWebhookInit(body);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
      });

      expect(response.status).toBe(400);
      expect(updateChallengeStatusMock).not.toHaveBeenCalled();
    });
  });
});
