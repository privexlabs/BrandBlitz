import { submitBatchPayout, type PayoutRecipient } from "@brandblitz/stellar";
import type { NetworkName } from "@brandblitz/stellar";
import { getLeaderboard } from "../db/queries/sessions";
import { getChallengeById, updateChallengeStatus } from "../db/queries/challenges";
import { createPayout, updatePayoutStatus } from "../db/queries/payouts";
import { calculatePayoutShare, rankWinners } from "./scoring";
import { payoutQueue } from "../queues/payout.queue";
import { emitCounterMetric, stellarSequenceStore } from "../lib/redis";
import { logger } from "../lib/logger";

/**
 * Enqueue a payout job for a completed challenge.
 * The actual Stellar transactions are processed by the BullMQ worker.
 */
export async function enqueuePayout(challengeId: string): Promise<void> {
  await payoutQueue.add(
    "process-payout",
    { challengeId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );
  logger.info("Payout job enqueued", { challengeId });
}

/**
 * Process payout for a settled challenge.
 * Called by the BullMQ worker processor.
 */
export async function processPayout(challengeId: string): Promise<void> {
  const challenge = await getChallengeById(challengeId);
  if (!challenge) throw new Error(`Challenge ${challengeId} not found`);
  if (challenge.status !== "ended") {
    logger.warn("Payout skipped — challenge not in ended state", { challengeId });
    return;
  }

  const sessions = await getLeaderboard(challengeId, 1000); // all ranked sessions
  if (sessions.length === 0) {
    await updateChallengeStatus(challengeId, "settled");
    return;
  }

  const ranked = rankWinners(
    sessions.map((s) => ({
      userId: s.user_id,
      stellarAddress: s.stellar_address ?? "",
      totalScore: s.total_score,
      endedAt: s.challenge_ended_at ?? s.created_at,
    }))
  ).filter((session) => session.stellarAddress);

  const totalPoints = ranked.reduce((acc, session) => acc + session.totalScore, 0);
  const recipients: PayoutRecipient[] = [];
  const payoutRecords: { id: string; address: string; amount: string }[] = [];

  for (const winner of ranked) {
    const amount = calculatePayoutShare(
      winner.totalScore,
      totalPoints,
      challenge.pool_amount_usdc
    );

    if (parseFloat(amount) < 0.0000001) {
      continue;
    }

    const payout = await createPayout({
      challengeId,
      userId: winner.userId,
      stellarAddress: winner.stellarAddress,
      amountUsdc: amount,
    });

    recipients.push({ address: winner.stellarAddress, amount });
    payoutRecords.push({ id: payout.id, address: winner.stellarAddress, amount });
  }

  if (recipients.length === 0) {
    await updateChallengeStatus(challengeId, "settled");
    return;
  }

  const network = (process.env.STELLAR_NETWORK ?? "testnet") as NetworkName;
  const hotWalletSecret = process.env.STELLAR_HOT_WALLET_SECRET ?? process.env.HOT_WALLET_SECRET;
  if (!hotWalletSecret) {
    throw new Error("STELLAR_HOT_WALLET_SECRET is required");
  }

  const results = await submitBatchPayout(recipients, hotWalletSecret, challengeId, network, {
    sequenceStore: stellarSequenceStore,
    onSequenceReset: (info) => {
      emitCounterMetric("stellar.seq.reset_total", 1, {
        challengeId,
        keyPrefix: info.keyPrefix,
        reason: info.reason,
        network,
      });
    },
  });

  const txHashes: string[] = [];
  let hasFailure = false;

  for (const result of results) {
    const status = result.success ? "sent" : "failed";
    if (!result.success) {
      hasFailure = true;
    }

    for (const recipient of result.recipients) {
      const record = payoutRecords.find((candidate) => candidate.address === recipient.address);
      if (record) {
        await updatePayoutStatus(record.id, status, result.txHash || undefined);
      }
    }

    if (result.success) {
      txHashes.push(result.txHash);
    }
  }

  await updateChallengeStatus(
    challengeId,
    hasFailure ? "payout_failed" : "settled",
    txHashes.length > 0 ? { payoutTxHashes: txHashes } : undefined
  );

  if (hasFailure) {
    logger.warn("Payout completed with failures", { challengeId, txHashes });
    return;
  }

  logger.info("Payout complete", { challengeId, txHashes });
}
