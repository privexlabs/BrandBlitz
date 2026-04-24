import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { getHorizonServer, getUsdcAsset, getNetworkPassphrase, type NetworkName } from "./client";
import { MAX_OPS_PER_TX, PAYOUT_BATCH_DELAY_MS } from "./constants";

export interface PayoutRecipient {
  address: string;
  amount: string; // in USDC, e.g. "10.5000000"
}

export interface PayoutBatchResult {
  txHash: string;
  recipients: PayoutRecipient[];
  success: boolean;
  error?: string;
}

/**
 * Build and submit a batch payout transaction.
 * Up to MAX_OPS_PER_TX (50) Payment operations per transaction — atomic all-or-nothing.
 *
 * Architecture decision: Single transaction with multiple Payment ops is the
 * cheapest and most reliable approach. ~$0.0007 total fee for 50 payouts.
 */
export async function submitBatchPayout(
  recipients: PayoutRecipient[],
  hotWalletSecret: string,
  challengeId: string,
  network: NetworkName = "testnet"
): Promise<PayoutBatchResult[]> {
  if (recipients.length === 0) return [];

  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);
  const passphrase = getNetworkPassphrase(network);
  const hotKeypair = Keypair.fromSecret(hotWalletSecret);
  const hotAccount = await horizon.loadAccount(hotKeypair.publicKey());

  const results: PayoutBatchResult[] = [];
  const batches = chunkArray(recipients, MAX_OPS_PER_TX);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    try {
      const tx = new TransactionBuilder(hotAccount, {
        fee: BASE_FEE,
        networkPassphrase: passphrase,
      })
        .addMemo(Memo.text(buildPayoutMemo(challengeId, i)))
        .setTimeout(180);

      for (const recipient of batch) {
        tx.addOperation(
          Operation.payment({
            destination: recipient.address,
            asset: usdc,
            amount: recipient.amount,
          })
        );
      }

      const builtTx = tx.build();
      builtTx.sign(hotKeypair);

      const response = await horizon.submitTransaction(builtTx);

      results.push({
        txHash: response.hash,
        recipients: batch,
        success: true,
      });

      // Reload account to get updated sequence number for next batch
      if (i < batches.length - 1) {
        await delay(PAYOUT_BATCH_DELAY_MS);
        hotAccount.incrementSequenceNumber();
      }
    } catch (err: any) {
      results.push({
        txHash: "",
        recipients: batch,
        success: false,
        error: err?.message ?? "Unknown error",
      });
    }
  }

  return results;
}

/**
 * Build a deterministic payout memo that respects Stellar's 28-byte text memo limit.
 */
function buildPayoutMemo(challengeId: string, batchIndex: number): string {
  const challengeTag = challengeId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20);
  return `bb-${challengeTag}-${batchIndex}`;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
