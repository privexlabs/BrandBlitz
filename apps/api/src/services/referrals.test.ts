import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  findReferralByReferredId: vi.fn(),
  findUserById: vi.fn(),
  createReferralPayout: vi.fn(),
  enqueueReferralBonus: vi.fn(),
  getSession: vi.fn(),
  markReferralRewarded: vi.fn(),
}));

vi.mock("../db", () => ({
  query: mocks.query,
}));

vi.mock("../db/queries/referrals", () => ({
  createReferral: vi.fn(),
  countReferralConversions: vi.fn(),
  countReferralInvites: vi.fn(),
  findReferralByReferrerAndReferred: vi.fn(),
  findReferralByReferredId: mocks.findReferralByReferredId,
  markReferralRewarded: mocks.markReferralRewarded,
}));

vi.mock("../db/queries/users", () => ({
  findUserById: mocks.findUserById,
  findUserByReferralCode: vi.fn(),
  getUserReferralCode: vi.fn(),
  setUserReferralCode: vi.fn(),
}));

vi.mock("../db/queries/referral-payouts", () => ({
  createReferralPayout: mocks.createReferralPayout,
  getReferralPayoutTotalsForUser: vi.fn(),
}));

vi.mock("../db/queries/sessions", () => ({
  getSession: mocks.getSession,
}));

vi.mock("../queues/referral-bonus.queue", () => ({
  enqueueReferralBonus: mocks.enqueueReferralBonus,
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

vi.mock("../middleware/error", () => ({
  createError: (message: string, statusCode: number) =>
    Object.assign(new Error(message), { statusCode }),
}));

import { queueReferralBonusForPayout } from "./referrals";

describe("queueReferralBonusForPayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findReferralByReferredId.mockResolvedValue({
      id: "referral-1",
      referrer_id: "referrer-1",
      referred_id: "referred-1",
      rewarded: false,
    });
    mocks.findUserById.mockImplementation((userId: string) =>
      Promise.resolve({
        id: userId,
        stellar_address: `${userId}-stellar`,
        embedded_wallet_address: null,
      })
    );
    mocks.getSession.mockResolvedValue({ id: "session-1" });
    mocks.createReferralPayout.mockResolvedValue({
      id: "payout-1",
      status: "pending",
    });
  });

  it("skips enqueue and writes audit log when the referred session has fraud flags", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: true }] }).mockResolvedValueOnce({
      rows: [],
    });

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.createReferralPayout).not.toHaveBeenCalled();
    expect(mocks.enqueueReferralBonus).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("referral_bonus_skipped"),
      expect.arrayContaining([
        "session-1",
        expect.objectContaining({
          sessionId: "session-1",
          referrerId: "referrer-1",
          referredId: "referred-1",
          reason: "fraud_flag",
        }),
      ])
    );
  });

  it("enqueues the referral bonus when the referred session has no fraud flags", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: false }] });

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.createReferralPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        referralId: "referral-1",
        referrerId: "referrer-1",
        referredId: "referred-1",
      })
    );
    expect(mocks.markReferralRewarded).toHaveBeenCalledWith("referral-1");
    expect(mocks.enqueueReferralBonus).toHaveBeenCalledWith("payout-1");
  });

  it("does nothing when the referred user has no referral", async () => {
    mocks.findReferralByReferredId.mockResolvedValue(null);

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.findUserById).not.toHaveBeenCalled();
    expect(mocks.createReferralPayout).not.toHaveBeenCalled();
    expect(mocks.markReferralRewarded).not.toHaveBeenCalled();
    expect(mocks.enqueueReferralBonus).not.toHaveBeenCalled();
  });

  it("does nothing when the referral was already rewarded", async () => {
    mocks.findReferralByReferredId.mockResolvedValue({
      id: "referral-1",
      referrer_id: "referrer-1",
      referred_id: "referred-1",
      rewarded: true,
    });

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.findUserById).not.toHaveBeenCalled();
    expect(mocks.createReferralPayout).not.toHaveBeenCalled();
    expect(mocks.markReferralRewarded).not.toHaveBeenCalled();
    expect(mocks.enqueueReferralBonus).not.toHaveBeenCalled();
  });

  it("uses embedded wallet addresses before Stellar addresses", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    mocks.findUserById.mockImplementation((userId: string) =>
      Promise.resolve({
        id: userId,
        stellar_address: `${userId}-stellar`,
        embedded_wallet_address: `${userId}-embedded`,
      })
    );

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.createReferralPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        referrerStellarAddress: "referrer-1-embedded",
        referredStellarAddress: "referred-1-embedded",
      })
    );
  });

  it("does not create a payout when either user lacks a payout address", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    mocks.findUserById.mockImplementation((userId: string) =>
      Promise.resolve({
        id: userId,
        stellar_address: userId === "referrer-1" ? "" : `${userId}-stellar`,
        embedded_wallet_address: null,
      })
    );

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.createReferralPayout).not.toHaveBeenCalled();
    expect(mocks.markReferralRewarded).not.toHaveBeenCalled();
    expect(mocks.enqueueReferralBonus).not.toHaveBeenCalled();
  });

  it("caps the referrer bonus at five USDC", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: false }] });

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 1_000_000_000n,
    });

    expect(mocks.createReferralPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        referrerAmountStroops: 50_000_000n,
        referredAmountStroops: 10_000_000n,
      })
    );
  });

  it("skips payout creation when the referrer bonus rounds down to zero", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: false }] });

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 9n,
    });

    expect(mocks.createReferralPayout).not.toHaveBeenCalled();
    expect(mocks.markReferralRewarded).not.toHaveBeenCalled();
    expect(mocks.enqueueReferralBonus).not.toHaveBeenCalled();
  });

  it("does not check fraud flags when no challenge id is provided", async () => {
    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: null,
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.createReferralPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        challengeId: null,
      })
    );
    expect(mocks.enqueueReferralBonus).toHaveBeenCalledWith("payout-1");
  });

  it("does not enqueue when payout creation returns a non-pending payout", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ exists: false }] });
    mocks.createReferralPayout.mockResolvedValue({
      id: "payout-1",
      status: "sent",
    });

    await queueReferralBonusForPayout({
      referredUserId: "referred-1",
      challengeId: "challenge-1",
      referralWinAmountStroops: 100_000_000n,
    });

    expect(mocks.markReferralRewarded).not.toHaveBeenCalled();
    expect(mocks.enqueueReferralBonus).not.toHaveBeenCalled();
  });
});
