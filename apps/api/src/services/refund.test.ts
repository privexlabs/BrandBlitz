import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRefundByChallengeId: vi.fn(),
  createRefund: vi.fn(),
  getChallengeById: vi.fn(),
  updateChallengeStatus: vi.fn(),
  query: vi.fn(),
  forTransaction: vi.fn(),
  submitTransaction: vi.fn(),
}));

vi.mock("../db/queries/refunds", () => ({
  findRefundByChallengeId: mocks.findRefundByChallengeId,
  createRefund: mocks.createRefund,
}));

vi.mock("../db/queries/challenges", () => ({
  getChallengeById: mocks.getChallengeById,
  updateChallengeStatus: mocks.updateChallengeStatus,
}));

vi.mock("../db", () => ({
  query: mocks.query,
}));

vi.mock("../lib/config", () => ({
  config: {
    STELLAR_NETWORK: "testnet",
    HOT_WALLET_SECRET: "test-hot-wallet-secret",
  },
}));

vi.mock("@brandblitz/stellar", () => ({
  getHorizonServer: () => ({
    operations: () => ({
      forTransaction: mocks.forTransaction,
    }),
    loadAccount: vi.fn().mockResolvedValue({ sequenceNumber: () => "1" }),
    submitTransaction: mocks.submitTransaction,
  }),
  getNetworkPassphrase: () => "Test SDF Network ; September 2015",
  getUsdcAsset: () => ({ code: "USDC", issuer: "GISSUER" }),
}));

vi.mock("@stellar/stellar-sdk", () => {
  class FakeTransactionBuilder {
    addMemo() {
      return this;
    }
    addOperation() {
      return this;
    }
    setTimeout() {
      return this;
    }
    build() {
      return { sign: vi.fn() };
    }
  }

  return {
    Account: class FakeAccount {
      constructor(_accountId: string, _sequence: string) {}
    },
    Keypair: {
      fromSecret: vi.fn().mockReturnValue({ publicKey: () => "GHOT", sign: vi.fn() }),
    },
    TransactionBuilder: FakeTransactionBuilder,
    Operation: { payment: vi.fn((op) => op) },
    Memo: { text: vi.fn((text) => ({ text })) },
    BASE_FEE: "100",
  };
});

import { refundChallenge } from "./refund";
import { Memo, Operation } from "@stellar/stellar-sdk";

describe("refundChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRefundByChallengeId.mockResolvedValue(null);
    mocks.forTransaction.mockReturnValue({
      call: vi.fn().mockResolvedValue({
        records: [{ type: "payment", from: "GBRAND" }],
      }),
    });
    mocks.submitTransaction.mockResolvedValue({ hash: "refund-tx" });
    mocks.createRefund.mockResolvedValue({
      id: "refund-1",
      challenge_id: "00000000-0000-0000-0000-000000000001",
      tx_hash: "refund-tx",
    });
  });

  it("refunds a deposited challenge and marks it refunded", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      deposit_tx_hash: "deposit-tx",
      pool_amount_stroops: "2500000",
    });

    const refund = await refundChallenge({
      challengeId: "00000000-0000-0000-0000-000000000001",
      adminId: "admin-1",
      reason: "brand requested cancellation",
    });

    expect(refund.tx_hash).toBe("refund-tx");
    expect(mocks.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "GBRAND",
        amountStroops: "2500000",
        txHash: "refund-tx",
      })
    );
    expect(mocks.updateChallengeStatus).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      "refunded"
    );
    expect(Memo.text).toHaveBeenCalledWith("REFUND:00000000-0000-0000-00");
    expect(Operation.payment).toHaveBeenCalledWith({
      destination: "GBRAND",
      asset: { code: "USDC", issuer: "GISSUER" },
      amount: "0.2500000",
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("challenge_refund"), [
      "admin-1",
      "00000000-0000-0000-0000-000000000001",
      JSON.stringify({
        refundId: "refund-1",
        txHash: "refund-tx",
        amount: "0.2500000",
        destination: "GBRAND",
        reason: "brand requested cancellation",
      }),
    ]);
  });

  it("returns an existing refund without submitting a duplicate payment", async () => {
    const existingRefund = {
      id: "refund-existing",
      challenge_id: "00000000-0000-0000-0000-000000000001",
      tx_hash: "existing-refund-tx",
    };
    mocks.findRefundByChallengeId.mockResolvedValue(existingRefund);

    const refund = await refundChallenge({
      challengeId: "00000000-0000-0000-0000-000000000001",
      adminId: "admin-1",
      reason: "duplicate request",
    });

    expect(refund).toBe(existingRefund);
    expect(mocks.getChallengeById).not.toHaveBeenCalled();
    expect(mocks.submitTransaction).not.toHaveBeenCalled();
    expect(mocks.createRefund).not.toHaveBeenCalled();
    expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects when the challenge does not exist", async () => {
    mocks.getChallengeById.mockResolvedValue(null);

    await expect(
      refundChallenge({
        challengeId: "00000000-0000-0000-0000-000000000001",
        adminId: "admin-1",
        reason: "test",
      })
    ).rejects.toThrow("Challenge not found");

    expect(mocks.submitTransaction).not.toHaveBeenCalled();
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  it("rejects an already-settled challenge", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "settled",
      deposit_tx_hash: "deposit-tx",
      pool_amount_stroops: "2500000",
    });

    await expect(
      refundChallenge({
        challengeId: "00000000-0000-0000-0000-000000000001",
        adminId: "admin-1",
        reason: "test",
      })
    ).rejects.toThrow("Challenge already settled");

    expect(mocks.submitTransaction).not.toHaveBeenCalled();
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  it("rejects when no deposit is found", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      deposit_tx_hash: null,
      pool_amount_stroops: "2500000",
    });

    await expect(
      refundChallenge({
        challengeId: "00000000-0000-0000-0000-000000000001",
        adminId: "admin-1",
        reason: "test",
      })
    ).rejects.toThrow("No deposit found");

    expect(mocks.forTransaction).not.toHaveBeenCalled();
    expect(mocks.submitTransaction).not.toHaveBeenCalled();
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  it("rejects when the deposit transaction has no payment sender", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      deposit_tx_hash: "deposit-tx",
      pool_amount_stroops: "2500000",
    });
    mocks.forTransaction.mockReturnValue({
      call: vi.fn().mockResolvedValue({
        records: [{ type: "change_trust", source_account: "GBRAND" }],
      }),
    });

    await expect(
      refundChallenge({
        challengeId: "00000000-0000-0000-0000-000000000001",
        adminId: "admin-1",
        reason: "test",
      })
    ).rejects.toThrow("No deposit found");

    expect(mocks.submitTransaction).not.toHaveBeenCalled();
    expect(mocks.createRefund).not.toHaveBeenCalled();
  });

  it("falls back to source_account when the payment operation has no from field", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      deposit_tx_hash: "deposit-tx",
      pool_amount_stroops: "2500000",
    });
    mocks.forTransaction.mockReturnValue({
      call: vi.fn().mockResolvedValue({
        records: [{ type: "payment", source_account: "GSOURCE" }],
      }),
    });

    await refundChallenge({
      challengeId: "00000000-0000-0000-0000-000000000001",
      adminId: "admin-1",
      reason: "brand requested cancellation",
    });

    expect(mocks.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "GSOURCE",
        txHash: "refund-tx",
      })
    );
  });

  it("does not persist refund state when the Stellar refund submission fails", async () => {
    mocks.getChallengeById.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      status: "active",
      deposit_tx_hash: "deposit-tx",
      pool_amount_stroops: "2500000",
    });
    mocks.submitTransaction.mockRejectedValue(new Error("horizon timeout"));

    await expect(
      refundChallenge({
        challengeId: "00000000-0000-0000-0000-000000000001",
        adminId: "admin-1",
        reason: "test",
      })
    ).rejects.toThrow("horizon timeout");

    expect(mocks.createRefund).not.toHaveBeenCalled();
    expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
