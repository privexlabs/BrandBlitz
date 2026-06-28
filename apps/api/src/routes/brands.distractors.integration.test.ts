import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brand } from "../db/queries/brands";
import type { Challenge } from "../db/queries/challenges";

const mocks = vi.hoisted(() => ({
  getBrandById: vi.fn(),
  getActiveDistractorBrands: vi.fn(),
  createChallenge: vi.fn(),
  insertChallengeQuestions: vi.fn(),
  loggerWarn: vi.fn(),
  authUser: {
    sub: "owner-user-1",
    email: "owner@example.com",
    iat: 0,
    exp: 0,
  } as any,
  tosAccepted: true,
}));

vi.mock("../db/queries/brands", () => ({
  createBrand: vi.fn(),
  getBrandsByOwner: vi.fn(),
  getBrandById: mocks.getBrandById,
  getActiveDistractorBrands: mocks.getActiveDistractorBrands,
  toBrandApi: (brand: Brand) => ({ ...brand, product_image_urls: [] }),
  updateBrand: vi.fn(),
  deleteBrand: vi.fn(),
  getBrandMetaById: vi.fn(),
}));

vi.mock("../db/queries/challenges", () => ({
  createChallenge: mocks.createChallenge,
  insertChallengeQuestions: mocks.insertChallengeQuestions,
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!mocks.authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = mocks.authUser;
    next();
  },
}));

vi.mock("../middleware/require-tos", () => ({
  requireCurrentTosAccepted: (_req: any, res: any, next: any) => {
    if (!mocks.tosAccepted) {
      res.status(403).json({ error: "Terms of Service acceptance required" });
      return;
    }
    next();
  },
}));

vi.mock("@brandblitz/storage", () => ({
  optimizeImage: vi.fn(),
  getPublicUrl: (_bucket: string, key: string) => `https://storage.example.com/${key}`,
  BUCKETS: {
    BRAND_ASSETS: "brand-assets",
  },
  StorageError: class StorageError extends Error {},
}));

vi.mock("../lib/logger", () => ({
  logger: {
    warn: mocks.loggerWarn,
  },
}));

import router from "./brands";
import { errorHandler } from "../middleware/error";

const STELLAR_TEXT_MEMO_MAX_BYTES = 28;

function buildBrand(params: {
  id: string;
  ownerUserId?: string;
  name: string;
  tagline: string;
  usp: string;
  hasProductImage?: boolean;
}): Brand {
  return {
    id: params.id,
    owner_user_id: params.ownerUserId ?? "owner-user-1",
    name: params.name,
    logo_url: null,
    primary_color: null,
    secondary_color: null,
    tagline: params.tagline,
    brand_story: null,
    usp: params.usp,
    product_image_keys: (params.hasProductImage ?? true) ? ["product.webp"] : [],
    created_at: "2026-04-24T00:00:00.000Z",
  };
}

function buildChallenge(brandId: string): Challenge {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    brand_id: brandId,
    challenge_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    deposit_memo: "bb-bbbbbbbbbbbbbbbbbbbbbbbbb",
    pool_amount_stroops: "500000000",
    pool_amount_usdc: "50.0000000",
    status: "pending_deposit",
    deposit_tx_hash: null,
    deposit_confirmations: 0,
    payout_tx_hashes: null,
    max_players: null,
    starts_at: "2026-04-24T00:00:00.000Z",
    ends_at: null,
    reported_count: 0,
    deleted_at: null,
    created_at: "2026-04-24T00:00:00.000Z",
  };
}

function validChallengePayload(overrides: Record<string, unknown> = {}) {
  return {
    brandId: "11111111-1111-4111-8111-111111111111",
    poolAmountUsdc: "100.0000000",
    endsAt: "2026-12-01T00:00:00.000Z",
    ...overrides,
  };
}

async function postChallenge(body: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use("/brands", router);
  app.use(errorHandler);

  const server = app.listen(0);

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const response = await fetch(`http://127.0.0.1:${port}/brands/challenges`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    const data = responseText
      ? (() => {
          try {
            return JSON.parse(responseText);
          } catch {
            return { raw: responseText };
          }
        })()
      : {};
    return { status: response.status, data };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("POST /brands/challenges distractor integration", () => {
  const brandId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    mocks.getBrandById.mockReset();
    mocks.getActiveDistractorBrands.mockReset();
    mocks.createChallenge.mockReset();
    mocks.insertChallengeQuestions.mockReset();
    mocks.loggerWarn.mockReset();
    mocks.authUser = {
      sub: "owner-user-1",
      email: "owner@example.com",
      iat: 0,
      exp: 0,
    };
    mocks.tosAccepted = true;

    process.env.HOT_WALLET_PUBLIC_KEY = "GTESTHOTWALLETADDRESS";

    mocks.getBrandById.mockResolvedValue(
      buildBrand({
        id: brandId,
        name: "Target Brand",
        tagline: "Target Tagline",
        usp: "Target USP",
      })
    );
    mocks.createChallenge.mockResolvedValue(buildChallenge(brandId));
    mocks.insertChallengeQuestions.mockResolvedValue(undefined);
    mocks.getActiveDistractorBrands.mockResolvedValue([]);
  });

  it("returns 401 before creating a challenge when the request is unauthenticated", async () => {
    mocks.authUser = null;

    const response = await postChallenge(validChallengePayload());

    expect(response.status).toBe(401);
    expect(response.data.error).toBe("Unauthorized");
    expect(mocks.createChallenge).not.toHaveBeenCalled();
    expect(mocks.insertChallengeQuestions).not.toHaveBeenCalled();
  });

  it("returns 403 before creating a challenge when current terms are not accepted", async () => {
    mocks.tosAccepted = false;

    const response = await postChallenge(validChallengePayload());

    expect(response.status).toBe(403);
    expect(response.data.error).toBe("Terms of Service acceptance required");
    expect(mocks.createChallenge).not.toHaveBeenCalled();
    expect(mocks.insertChallengeQuestions).not.toHaveBeenCalled();
  });

  it("rejects missing required challenge fields before touching the database", async () => {
    const response = await postChallenge({});

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Validation Error");
    expect(mocks.getBrandById).not.toHaveBeenCalled();
    expect(mocks.createChallenge).not.toHaveBeenCalled();
    expect(mocks.insertChallengeQuestions).not.toHaveBeenCalled();
  });

  it("returns deposit instructions with a Stellar-compatible text memo for a new pending-deposit challenge", async () => {
    const response = await postChallenge(validChallengePayload());

    expect(response.status).toBe(201);
    expect(response.data.challenge).toMatchObject({
      brand_id: brandId,
      status: "pending_deposit",
    });
    expect(response.data.depositInstructions).toMatchObject({
      hotWalletAddress: expect.stringMatching(/^G[A-Z0-9]+$/),
      memo: expect.any(String),
      amount: "100.0000000",
      asset: "USDC",
    });

    const memo = response.data.depositInstructions.memo as string;
    expect(Buffer.byteLength(memo, "utf8")).toBeLessThanOrEqual(STELLAR_TEXT_MEMO_MAX_BYTES);
    expect(memo).toMatch(/^bb-[0-9a-f]{25}$/i);
    expect(mocks.createChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId,
        challengeId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        ),
        depositMemo: memo,
        poolAmountUsdc: "100.0000000",
      })
    );
  });

  it("generates unique Stellar memo values for sequential challenge creations", async () => {
    mocks.createChallenge.mockImplementation(async ({ brandId: createdBrandId, depositMemo }) => ({
      ...buildChallenge(createdBrandId),
      deposit_memo: depositMemo,
    }));

    const first = await postChallenge(validChallengePayload());
    const second = await postChallenge(validChallengePayload({ maxPlayers: 75 }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstMemo = first.data.depositInstructions.memo;
    const secondMemo = second.data.depositInstructions.memo;
    expect(firstMemo).not.toBe(secondMemo);
    expect(mocks.createChallenge).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ depositMemo: firstMemo })
    );
    expect(mocks.createChallenge).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ depositMemo: secondMemo, maxPlayers: 75 })
    );
  });

  it("uses real distractor brand names in generated question options", async () => {
    const distractorBrands = [
      buildBrand({
        id: "22222222-2222-4222-8222-222222222222",
        ownerUserId: "owner-user-2",
        name: "Rival One",
        tagline: "Rival One Tagline",
        usp: "Rival One USP",
      }),
      buildBrand({
        id: "33333333-3333-4333-8333-333333333333",
        ownerUserId: "owner-user-3",
        name: "Rival Two",
        tagline: "Rival Two Tagline",
        usp: "Rival Two USP",
      }),
      buildBrand({
        id: "44444444-4444-4444-8444-444444444444",
        ownerUserId: "owner-user-4",
        name: "Rival Three",
        tagline: "Rival Three Tagline",
        usp: "Rival Three USP",
      }),
    ];
    mocks.getActiveDistractorBrands.mockResolvedValue(distractorBrands);

    const response = await postChallenge({
      brandId,
      poolAmountUsdc: "100.0000000",
      endsAt: "2026-12-01T00:00:00.000Z",
    });

    expect(response.status).toBe(201);
    expect(mocks.getActiveDistractorBrands).toHaveBeenCalledWith(brandId);
    expect(mocks.insertChallengeQuestions).toHaveBeenCalledTimes(1);

    const insertedQuestions = mocks.insertChallengeQuestions.mock.calls[0]?.[0] as Array<{
      round: number;
      option_a: string;
      option_b: string;
      option_c: string;
      option_d: string;
    }>;

    const productQuestion = insertedQuestions.find((question) => question.round === 3);
    expect(productQuestion).toBeDefined();

    const poolNames = new Set(distractorBrands.map((brand) => brand.name));
    const options = [
      productQuestion?.option_a,
      productQuestion?.option_b,
      productQuestion?.option_c,
      productQuestion?.option_d,
    ].filter((option): option is string => Boolean(option));

    expect(options.some((option) => poolNames.has(option))).toBe(true);
    expect(options.some((option) => option.startsWith("Option "))).toBe(false);
  });

  it("logs a warning and falls back to generic options when pool is empty", async () => {
    mocks.getActiveDistractorBrands.mockResolvedValue([]);

    const response = await postChallenge({
      brandId,
      poolAmountUsdc: "100.0000000",
      endsAt: "2026-12-01T00:00:00.000Z",
    });

    expect(response.status).toBe(201);
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      "Distractor pool is empty; using fallback options for generated questions",
      expect.objectContaining({
        brandId,
      })
    );

    const insertedQuestions = mocks.insertChallengeQuestions.mock.calls[0]?.[0] as Array<{
      option_a: string;
      option_b: string;
      option_c: string;
      option_d: string;
    }>;

    const hasFallbackOption = insertedQuestions.some((question) =>
      [question.option_a, question.option_b, question.option_c, question.option_d].some((option) =>
        option.startsWith("Option ")
      )
    );

    expect(hasFallbackOption).toBe(true);
  });

  it("rejects challenge creation when endsAt is in the past", async () => {
    const response = await postChallenge({
      brandId,
      poolAmountUsdc: "100.0000000",
      endsAt: "2020-01-01T00:00:00.000Z",
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Challenge end time must be in the future");
    expect(mocks.createChallenge).not.toHaveBeenCalled();
  });

  it("rejects challenge creation when duration is less than one hour", async () => {
    const response = await postChallenge({
      brandId,
      poolAmountUsdc: "100.0000000",
      endsAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toBe("Challenge duration must be at least 1 hour");
    expect(mocks.createChallenge).not.toHaveBeenCalled();
  });
});
