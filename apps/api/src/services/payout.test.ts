import { beforeEach, describe, expect, it, vi } from "vitest";

const submitBatchPayoutMock = vi.fn();
const getLeaderboardMock = vi.fn();
const getChallengeByIdMock = vi.fn();
const updateChallengeStatusMock = vi.fn();
const createPayoutMock = vi.fn();
const updatePayoutStatusMock = vi.fn();
const queueAddMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const emitCounterMetricMock = vi.fn();

vi.mock("@brandblitz/stellar", () => ({
  submitBatchPayout: submitBatchPayoutMock,
}));

vi.mock("../db/queries/sessions", () => ({
  getLeaderboard: getLeaderboardMock,
}));

vi.mock("../db/queries/challenges", () => ({
  getChallengeById: getChallengeByIdMock,
  updateChallengeStatus: updateChallengeStatusMock,
}));

vi.mock("../db/queries/payouts", () => ({
  createPayout: createPayoutMock,
  updatePayoutStatus: updatePayoutStatusMock,
}));

vi.mock("../queues/payout.queue", () => ({
  payoutQueue: {
    add: queueAddMock,
  },
}));

vi.mock("../lib/redis", () => ({
  emitCounterMetric: emitCounterMetricMock,
  stellarSequenceStore: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    setIfAbsent: vi.fn(),
  },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: vi.fn(),
  },
}));

import { enqueuePayout, processPayout } from "./payout";

describe("payout service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STELLAR_NETWORK = "testnet";
    process.env.STELLAR_HOT_WALLET_SECRET = "SSECRET";
  });

  it("enqueuePayout submits the expected BullMQ job options", async () => {
    queueAddMock.mockResolvedValue(undefined);

    await enqueuePayout("challenge-1");

    expect(queueAddMock).toHaveBeenCalledWith(
      "process-payout",
      { challengeId: "challenge-1" },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      }
    );
  });

  it("processPayout creates records, submits one batch, and marks payouts sent", async () => {
    getChallengeByIdMock.mockResolvedValue({
      id: "challenge-1",
      status: "ended",
      pool_amount_usdc: "60.0000000",
    });
    getLeaderboardMock.mockResolvedValue([
      {
        user_id: "user-1",
        total_score: 100,
        challenge_ended_at: "2026-04-24T10:00:00.000Z",
        created_at: "2026-04-24T09:00:00.000Z",
        stellar_address: "GUSER1",
      },
      {
        user_id: "user-2",
        total_score: 50,
        challenge_ended_at: "2026-04-24T10:01:00.000Z",
        created_at: "2026-04-24T09:00:00.000Z",
        stellar_address: "GUSER2",
      },
      {
        user_id: "user-3",
        total_score: 25,
        challenge_ended_at: "2026-04-24T10:02:00.000Z",
        created_at: "2026-04-24T09:00:00.000Z",
        stellar_address: "GUSER3",
      },
    ]);

    let payoutId = 0;
    createPayoutMock.mockImplementation(async () => ({ id: `payout-${++payoutId}` }));
    submitBatchPayoutMock.mockResolvedValue([
      {
        txHash: "tx-success",
        recipients: [
          { address: "GUSER1", amount: "34.2857143" },
          { address: "GUSER2", amount: "17.1428571" },
          { address: "GUSER3", amount: "8.5714286" },
        ],
        success: true,
      },
    ]);

    await processPayout("challenge-1");

    expect(createPayoutMock).toHaveBeenCalledTimes(3);
    expect(submitBatchPayoutMock).toHaveBeenCalledTimes(1);
    expect(submitBatchPayoutMock).toHaveBeenCalledWith(
      [
        { address: "GUSER1", amount: "34.2857143" },
        { address: "GUSER2", amount: "17.1428571" },
        { address: "GUSER3", amount: "8.5714286" },
      ],
      "SSECRET",
      "challenge-1",
      "testnet",
      expect.objectContaining({
        sequenceStore: expect.any(Object),
        onSequenceReset: expect.any(Function),
      })
    );
    expect(updatePayoutStatusMock).toHaveBeenNthCalledWith(
      1,
      "payout-1",
      "sent",
      "tx-success"
    );
    expect(updatePayoutStatusMock).toHaveBeenNthCalledWith(
      2,
      "payout-2",
      "sent",
      "tx-success"
    );
    expect(updatePayoutStatusMock).toHaveBeenNthCalledWith(
      3,
      "payout-3",
      "sent",
      "tx-success"
    );
    expect(updateChallengeStatusMock).toHaveBeenCalledWith("challenge-1", "settled", {
      payoutTxHashes: ["tx-success"],
    });
  });

  it("marks a challenge settled when there are no ranked sessions", async () => {
    getChallengeByIdMock.mockResolvedValue({
      id: "challenge-2",
      status: "ended",
      pool_amount_usdc: "10.0000000",
    });
    getLeaderboardMock.mockResolvedValue([]);

    await processPayout("challenge-2");

    expect(submitBatchPayoutMock).not.toHaveBeenCalled();
    expect(updateChallengeStatusMock).toHaveBeenCalledWith("challenge-2", "settled");
  });

  it("marks payouts failed when Stellar submission fails", async () => {
    getChallengeByIdMock.mockResolvedValue({
      id: "challenge-3",
      status: "ended",
      pool_amount_usdc: "20.0000000",
    });
    getLeaderboardMock.mockResolvedValue([
      {
        user_id: "user-1",
        total_score: 100,
        challenge_ended_at: "2026-04-24T10:00:00.000Z",
        created_at: "2026-04-24T09:00:00.000Z",
        stellar_address: "GUSER1",
      },
      {
        user_id: "user-2",
        total_score: 50,
        challenge_ended_at: "2026-04-24T10:01:00.000Z",
        created_at: "2026-04-24T09:00:00.000Z",
        stellar_address: "GUSER2",
      },
    ]);
    createPayoutMock
      .mockResolvedValueOnce({ id: "payout-1" })
      .mockResolvedValueOnce({ id: "payout-2" });
    submitBatchPayoutMock.mockResolvedValue([
      {
        txHash: "",
        recipients: [
          { address: "GUSER1", amount: "13.3333333" },
          { address: "GUSER2", amount: "6.6666667" },
        ],
        success: false,
        error: "tx_failed",
      },
    ]);

    await processPayout("challenge-3");

    expect(updatePayoutStatusMock).toHaveBeenNthCalledWith(1, "payout-1", "failed", undefined);
    expect(updatePayoutStatusMock).toHaveBeenNthCalledWith(2, "payout-2", "failed", undefined);
    expect(updateChallengeStatusMock).toHaveBeenCalledWith("challenge-3", "payout_failed", undefined);
  });

  it("returns early when the challenge is not in the ended state", async () => {
    getChallengeByIdMock.mockResolvedValue({
      id: "challenge-4",
      status: "active",
      pool_amount_usdc: "30.0000000",
    });

    await processPayout("challenge-4");

    expect(getLeaderboardMock).not.toHaveBeenCalled();
    expect(createPayoutMock).not.toHaveBeenCalled();
    expect(submitBatchPayoutMock).not.toHaveBeenCalled();
    expect(updateChallengeStatusMock).not.toHaveBeenCalled();
  });

  it("skips recipients whose share falls below the dust threshold", async () => {
    getChallengeByIdMock.mockResolvedValue({
      id: "challenge-5",
      status: "ended",
      pool_amount_usdc: "0.0000001",
    });
    getLeaderboardMock.mockResolvedValue([
      {
        user_id: "user-1",
        total_score: 9999999,
        challenge_ended_at: "2026-04-24T10:00:00.000Z",
        created_at: "2026-04-24T09:00:00.000Z",
        stellar_address: "GUSER1",
      },
      {
        user_id: "user-2",
        total_score: 1,
        challenge_ended_at: "2026-04-24T10:01:00.000Z",
        created_at: "2026-04-24T09:00:00.000Z",
        stellar_address: "GUSER2",
      },
    ]);
    createPayoutMock.mockResolvedValue({ id: "payout-1" });
    submitBatchPayoutMock.mockResolvedValue([
      {
        txHash: "tx-dust",
        recipients: [{ address: "GUSER1", amount: "0.0000001" }],
        success: true,
      },
    ]);

    await processPayout("challenge-5");

    expect(createPayoutMock).toHaveBeenCalledTimes(1);
    expect(createPayoutMock).toHaveBeenCalledWith({
      challengeId: "challenge-5",
      userId: "user-1",
      stellarAddress: "GUSER1",
      amountUsdc: "0.0000001",
    });
    expect(submitBatchPayoutMock).toHaveBeenCalledWith(
      [{ address: "GUSER1", amount: "0.0000001" }],
      "SSECRET",
      "challenge-5",
      "testnet",
      expect.any(Object)
    );
  });
});
