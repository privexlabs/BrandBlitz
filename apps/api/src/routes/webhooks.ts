import { Router } from "express";
import {
  getChallengeByMemo,
  updateChallengeStatus,
} from "../db/queries/challenges";
import { logger } from "../lib/logger";
import { config } from "../lib/config";

const router = Router();

/**
 * POST /webhooks/stellar/deposit
 * Internal webhook: called by the deposit monitor when a matching USDC
 * payment is detected on-chain. Activates the challenge.
 *
 * This endpoint is internal only — not exposed to the public internet.
 * Protected by a shared secret in the X-Webhook-Secret header.
 */
router.post("/stellar/deposit", async (req, res) => {
  const secret = req.headers["x-webhook-secret"];
  if (secret !== config.WEBHOOK_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { memo, txHash, amount } = req.body as {
    memo: string;
    txHash: string;
    amount: string;
  };

  if (!memo || !txHash) {
    res.status(400).json({ error: "Missing memo or txHash" });
    return;
  }

  const challenge = await getChallengeByMemo(memo);
  if (!challenge) {
    logger.warn("Deposit received for unknown challenge memo", { memo, txHash });
    res.json({ status: "unknown_memo" });
    return;
  }

  if (challenge.status !== "pending_deposit") {
    res.json({ status: "already_processed" });
    return;
  }

  await updateChallengeStatus(challenge.id, "active", { depositTx: txHash });

  logger.info("Challenge activated via deposit", {
    challengeId: challenge.id,
    txHash,
    amount,
  });

  res.json({ status: "activated", challengeId: challenge.id });
});

export default router;
