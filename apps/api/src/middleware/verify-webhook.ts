import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../lib/config";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";

export const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;
export const WEBHOOK_REPLAY_TTL_SECONDS = 10 * 60;

type RawBodyRequest = Request & {
  rawBody?: string;
};

function getHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function webhookBody(req: RawBodyRequest): string {
  return req.rawBody ?? JSON.stringify(req.body ?? {});
}

function parseTimestamp(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

function signatureMatches(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `sha256=${digest}`;
}

export async function verifyStellarWebhook(
  req: RawBodyRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sharedSecret = getHeader(req, "x-webhook-secret");
  if (sharedSecret !== config.WEBHOOK_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const webhookId = getHeader(req, "x-webhook-id");
  const timestampHeader = getHeader(req, "x-webhook-timestamp");
  const signatureHeader = getHeader(req, "x-webhook-signature");

  if (!webhookId || !timestampHeader || !signatureHeader?.startsWith("sha256=")) {
    res.status(401).json({ error: "Missing webhook signature headers" });
    return;
  }

  const timestamp = parseTimestamp(timestampHeader);
  if (!timestamp || Math.abs(Date.now() - timestamp) > WEBHOOK_MAX_AGE_MS) {
    res.status(401).json({ error: "Stale webhook timestamp" });
    return;
  }

  const expectedSignature = signWebhookPayload(
    config.WEBHOOK_SECRET,
    timestampHeader,
    webhookBody(req)
  );

  const receivedDigest = signatureHeader.slice("sha256=".length);
  const expectedDigest = expectedSignature.slice("sha256=".length);
  if (!signatureMatches(receivedDigest, expectedDigest)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const replayKey = `stellar-webhook:${webhookId}`;
  try {
    const stored = await redis.set(replayKey, "1", "EX", WEBHOOK_REPLAY_TTL_SECONDS, "NX");
    if (stored !== "OK") {
      res.status(200).json({ status: "duplicate_webhook_ignored" });
      return;
    }
  } catch (error) {
    logger.error("Webhook replay guard failed", {
      webhookId,
      err: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({ error: "Webhook replay guard unavailable" });
    return;
  }

  next();
}
