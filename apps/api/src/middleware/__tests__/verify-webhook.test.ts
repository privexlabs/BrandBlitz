import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signWebhookPayload, verifyWebhook } from "../verify-webhook";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  redisSet: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("../../db/index", () => ({
  query: mocks.query,
}));

vi.mock("../../lib/redis", () => ({
  redis: {
    set: mocks.redisSet,
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  },
}));

const CURRENT_SECRET = "current-webhook-secret";
const PENDING_SECRET = "pending-webhook-secret";
const TIMESTAMP = 1_800_000_000;
const WEBHOOK_ID = "evt_test_123";

function reqFor(
  payload: string | Buffer,
  secret = CURRENT_SECRET,
  overrides: Record<string, unknown> = {}
) {
  const timestamp = TIMESTAMP;
  const signature = signWebhookPayload(payload, timestamp, secret);

  return {
    headers: {
      "x-webhook-signature": `sha256=${signature}`,
      "x-webhook-timestamp": String(timestamp),
      "x-webhook-id": WEBHOOK_ID,
      ...(overrides.headers as Record<string, unknown> | undefined),
    },
    rawBody: payload,
    ...overrides,
  };
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

async function runVerify(req: any) {
  const res = mockRes();
  const next = vi.fn();

  await verifyWebhook(req, res, next);

  return { res, next };
}

describe("verifyWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(TIMESTAMP * 1000);

    mocks.query.mockResolvedValue({
      rows: [
        {
          key: "webhook_secret_current",
          value: { secret: CURRENT_SECRET },
        },
        {
          key: "webhook_secret_pending",
          value: {
            secret: PENDING_SECRET,
            expiresAt: new Date((TIMESTAMP + 60) * 1000).toISOString(),
          },
        },
      ],
    });
    mocks.redisSet.mockResolvedValue("OK");
  });

  it("calls next for a valid HMAC-SHA256 signature", async () => {
    const payload = JSON.stringify({ type: "deposit.detected", amount: "100.0000000" });
    const { res, next } = await runVerify(reqFor(payload));

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(mocks.redisSet).toHaveBeenCalledWith(`webhook:id:${WEBHOOK_ID}`, "1", "EX", 600, "NX");
  });

  it("rejects a signature generated with a different secret", async () => {
    const payload = JSON.stringify({ type: "deposit.detected" });
    const { res, next } = await runVerify(reqFor(payload, "wrong-secret"));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid webhook signature" });
  });

  it("rejects a signature when one byte is flipped", async () => {
    const payload = JSON.stringify({ type: "deposit.detected" });
    const request = reqFor(payload);
    request.headers["x-webhook-signature"] = `${request.headers["x-webhook-signature"].slice(
      0,
      -1
    )}0`;

    const { res, next } = await runVerify(request);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 for a missing signature without computing an HMAC", async () => {
    const request = reqFor("{}", CURRENT_SECRET, {
      headers: { "x-webhook-signature": undefined },
    });
    const createHmacSpy = vi.spyOn(crypto, "createHmac");
    createHmacSpy.mockClear();

    const { res, next } = await runVerify(request);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Missing signature" });
    expect(createHmacSpy).not.toHaveBeenCalled();
  });

  it("returns 401 for an empty signature header without computing an HMAC", async () => {
    const request = reqFor("{}", CURRENT_SECRET, {
      headers: { "x-webhook-signature": "" },
    });
    const createHmacSpy = vi.spyOn(crypto, "createHmac");
    createHmacSpy.mockClear();

    const { res, next } = await runVerify(request);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid signature format" });
    expect(createHmacSpy).not.toHaveBeenCalled();
  });

  it("uses crypto.timingSafeEqual for matching signatures", async () => {
    const timingSafeEqualSpy = vi.spyOn(crypto, "timingSafeEqual");

    await runVerify(reqFor(JSON.stringify({ type: "deposit.detected" })));

    expect(timingSafeEqualSpy).toHaveBeenCalled();
  });

  it("requires rawBody before HMAC verification can succeed", async () => {
    const payload = Buffer.alloc(256 * 1024, "a");
    const request = reqFor(payload);
    delete (request as any).rawBody;

    const { res, next } = await runVerify(request);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Raw webhook payload unavailable" });
  });

  it("accepts a non-expired pending secret during secret rotation", async () => {
    const payload = JSON.stringify({ type: "deposit.detected" });
    const { res, next } = await runVerify(reqFor(payload, PENDING_SECRET));

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("treats duplicate webhook ids as already processed", async () => {
    mocks.redisSet.mockResolvedValue(null);

    const { res, next } = await runVerify(reqFor(JSON.stringify({ type: "deposit.detected" })));

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: "duplicate" });
  });
});
