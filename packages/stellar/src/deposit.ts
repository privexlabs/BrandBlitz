import { rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { getRpcServer, getUsdcAsset, getNetworkConfig, type NetworkName } from "./client";
import { DEPOSIT_POLL_INTERVAL_MS } from "./constants";

export interface DepositEvent {
  txHash: string;
  amount: string;
  memo: string;
  to: string;
  ledger: number;
  createdAt: string;
}

/**
 * Poll Stellar RPC getEvents for USDC transfers to the hot wallet.
 * Returns a list of deposit events since the given cursor ledger.
 *
 * Architecture decision: RPC getEvents (Protocol 23+) preferred over
 * Horizon streaming — more reliable at scale, no long-lived connections.
 */
export async function fetchDepositEvents(
  hotWalletAddress: string,
  fromLedger: number,
  network: NetworkName = "testnet"
): Promise<{ events: DepositEvent[]; latestLedger: number }> {
  const rpc = getRpcServer(network);
  const usdc = getUsdcAsset(network);
  const { networkPassphrase } = getNetworkConfig(network);

  const response = await rpc.getEvents({
    startLedger: fromLedger,
    filters: [
      {
        type: "contract",
        // SAC (Stellar Asset Contract) transfer events for USDC
        contractIds: [usdc.contractId(networkPassphrase)],
        topics: [
          ["transfer", "*", hotWalletAddress],
        ],
      },
    ],
    limit: 200,
  });

  const events: DepositEvent[] = [];

  for (const event of response.events) {
    try {
      const txMeta = await rpc.getTransaction(event.txHash);
      if (txMeta.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        console.warn(`Skipping unsuccessful transaction: ${event.txHash}`, { status: txMeta.status });
        continue;
      }

      if (!event.ledgerClosedAt) {
        console.warn(`Skipping event with missing ledgerClosedAt: ${event.txHash}`);
        continue;
      }

      const memo = (txMeta as any).memo?.text ?? "";
      const amount = event.value?.toString() ?? "0";

      events.push({
        txHash: event.txHash,
        amount,
        memo,
        to: hotWalletAddress,
        ledger: event.ledger,
        createdAt: new Date(event.ledgerClosedAt).toISOString(),
      });
    } catch (err) {
      console.warn(`Error processing deposit event ${event.txHash}:`, err);
      continue;
    }
  }

  return {
    events,
    latestLedger: response.latestLedger,
  };
}

/**
 * Returns the interval in ms to wait between deposit polls.
 */
export function getDepositPollInterval(): number {
  return DEPOSIT_POLL_INTERVAL_MS;
}
