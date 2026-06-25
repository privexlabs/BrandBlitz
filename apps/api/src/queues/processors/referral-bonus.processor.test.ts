import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findReferralPayoutById: vi.fn(),
  updateReferralPayoutStatus: vi.fn(),
  getSession: vi.fn(),
  isFraudSession: vi.fn(),
  auditReferralBonusSkipped: vi.fn(),
  submitBatchPayout: vi.fn(),
}));

vi.mock("@brandblitz/stellar", () => ({
  submitBatchPayout: mocks.submitBatchPayout,
}));

vi.mock("../../lib/config", () => ({
  config: {
    HOT_WALLET_SECRET: "test-hot-wallet-secret",
    STELLAR_NETWORK: "testnet",
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../lib/redis", () => ({
  stellarSequenceStore: {},
  redis: {},
}));

vi.mock("../../db/queries/referral-payouts", () => ({
  findReferralPayoutById: mocks.findReferralPayoutById,
  updateReferralPayoutStatus: mocks.updateReferralPayoutStatus,
}));

vi.mock("../../db/queries/sessions", () => ({
  getSession: mocks.getSession,
}));

vi.mock("../../services/referrals", () => ({
  isFraudSession: mocks.isFraudSession,
  auditReferralBonusSkipped: mocks.auditReferralBonusSkipped,
}));

vi.mock("../referral-bonus.queue", () => ({
  referralBonusQueue: { name: "referral-bonus" },
}));

vi.mock("../dlq", () => ({
  forwardToDlq: vi.fn(),
  referralBonusDlqQueue: {},
}));

import { processReferralBonusJob } from "./referral-bonus.processor";

function buildPayout() {
  return {
    id: "payout-1",
    referral_id: "referral-1",
    challenge_id: "challenge-1",
    referrer_id: "referrer-1",
    referred_id: "referred-1",
    referrer_stellar_address: "GREFERRER",
    referred_stellar_address: "GREFERRED",
    referrer_amount_stroops: "5000000",
    referred_amount_stroops: "10000000",
    status: "pending",
  };
}

describe("processReferralBonusJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findReferralPayoutById.mockResolvedValue(buildPayout());
    mocks.getSession.mockResolvedValue({ id: "session-1" });
    mocks.isFraudSession.mockResolvedValue(false);
    mocks.submitBatchPayout.mockResolvedValue([{ success: true, txHash: "tx-1" }]);
  });

  it("cancels the payout when fraud is detected before processing", async () => {
    mocks.isFraudSession.mockResolvedValue(true);

    await processReferralBonusJob({ data: { referralPayoutId: "payout-1" } } as any);

    expect(mocks.submitBatchPayout).not.toHaveBeenCalled();
    expect(mocks.updateReferralPayoutStatus).toHaveBeenCalledWith(
      "payout-1",
      "failed",
      undefined,
      "Referral bonus skipped because session was flagged as fraud"
    );
    expect(mocks.auditReferralBonusSkipped).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        referrerId: "referrer-1",
        referredId: "referred-1",
        referralPayoutId: "payout-1",
      })
    );
  });

  it("processes the referral bonus when no fraud flags exist", async () => {
    await processReferralBonusJob({ data: { referralPayoutId: "payout-1" } } as any);

    expect(mocks.submitBatchPayout).toHaveBeenCalledWith(
      [
        { address: "GREFERRER", amount: "5000000" },
        { address: "GREFERRED", amount: "10000000" },
      ],
      "test-hot-wallet-secret",
      "referral-payout-1",
      "testnet",
      { sequenceStore: {} }
    );
    expect(mocks.updateReferralPayoutStatus).toHaveBeenCalledWith("payout-1", "sent", "tx-1");
  });
});
