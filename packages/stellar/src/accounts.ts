import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  MuxedAccount,
  xdr,
} from "@stellar/stellar-sdk";
import {
  getHorizonServer,
  getUsdcAsset,
  getNetworkPassphrase,
  withRetry,
  type NetworkName,
} from "./client";

/**
 * Create a muxed account address from a base account public key and a user ID.
 * Muxed accounts allow virtual sub-accounts without on-chain accounts or XLM reserves.
 *
 * Architecture decision: Single hot wallet + muxed accounts instead of per-user accounts
 * saves 2 XLM (~$0.20) per user in minimum reserve costs.
 */
export function createMuxedAddress(basePublicKey: string, userId: bigint): string {
  const muxed = new MuxedAccount(basePublicKey, userId.toString());
  return muxed.accountId();
}

/**
 * Sponsor a new Stellar account for a first-time winner.
 * Covers the base reserve (1 XLM) and USDC trustline (0.5 XLM extra).
 *
 * Architecture decision: CAP-0033 Sponsored Reserves — platform pays, user retains control.
 * Requires both sponsor signature (backend) AND winner signature (via embedded wallet).
 */
export async function sponsorNewAccount(
  winnerPublicKey: string,
  sponsorSecret: string,
  network: NetworkName = "testnet"
): Promise<{ txEnvelopeXdr: string }> {
  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);
  const passphrase = getNetworkPassphrase(network);
  const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
  const sponsorAccount = await withRetry(() => horizon.loadAccount(sponsorKeypair.publicKey()), {
    maxAttempts: 5,
    baseDelayMs: 250,
    maxDelayMs: 30_000,
  });

  const tx = new TransactionBuilder(sponsorAccount, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  })
    .addOperation(
      Operation.beginSponsoringFutureReserves({
        sponsoredId: winnerPublicKey,
      })
    )
    .addOperation(
      Operation.createAccount({
        destination: winnerPublicKey,
        startingBalance: "0",
      })
    )
    .addOperation(
      Operation.changeTrust({
        asset: usdc,
        source: winnerPublicKey,
      })
    )
    .addOperation(
      Operation.endSponsoringFutureReserves({
        source: winnerPublicKey,
      })
    )
    .setTimeout(300)
    .build();

  // Sponsor signs — winner must also sign before submission
  tx.sign(sponsorKeypair);

  return { txEnvelopeXdr: tx.toEnvelope().toXDR("base64") };
}

/**
 * Check if a Stellar account exists and has a USDC trustline.
 */
export async function accountHasUsdcTrustline(
  publicKey: string,
  network: NetworkName = "testnet"
): Promise<boolean> {
  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);

  try {
    const account = await horizon.loadAccount(publicKey);
    return account.balances.some(
      (b) =>
        b.asset_type === "credit_alphanum4" &&
        (b as any).asset_code === "USDC" &&
        (b as any).asset_issuer === usdc.getIssuer()
    );
  } catch {
    return false;
  }
}

/** Return an account's USDC trustline balance in Stellar stroops (7 decimals). */
export async function getAccountUsdcBalance(
  publicKey: string,
  network: NetworkName = "testnet"
): Promise<bigint> {
  const horizon = getHorizonServer(network);
  const usdc = getUsdcAsset(network);
  const account = await horizon.loadAccount(publicKey);
  const balance = account.balances.find(
    (item) =>
      item.asset_type === "credit_alphanum4" &&
      (item as any).asset_code === "USDC" &&
      (item as any).asset_issuer === usdc.getIssuer()
  ) as { balance?: string } | undefined;

  if (!balance?.balance) return 0n;
  const [whole, fraction = ""] = balance.balance.split(".");
  return BigInt(`${whole}${fraction.padEnd(7, "0").slice(0, 7)}`);
}

/**
 * Set up multisig threshold for escrow account.
 * Adds co-signer public keys and sets the transaction threshold.
 *
 * @param accountId - Escrow account public key
 * @param signers - Array of [publicKey, weight] tuples; weights typically [1, 1, 1] for 3 signers
 * @param threshold - Number of signatures required (e.g., 2 for 2-of-3)
 * @param masterSignerSecret - Master key secret for signing the setOptions operation
 * @param network - Stellar network (testnet or public)
 *
 * Returns unsigned XDR that must be co-signed by additional hardware wallets.
 */
export async function setupMultisigThreshold(
  accountId: string,
  signers: Array<{ publicKey: string; weight: number }>,
  threshold: number,
  masterSignerSecret: string,
  network: NetworkName = "testnet"
): Promise<{ txEnvelopeXdr: string; txHash: string }> {
  if (signers.length > 20) {
    throw new Error("Stellar accounts support at most 20 signers");
  }
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new Error(`Invalid threshold ${threshold}: must be an integer between 0 and 255`);
  }
  for (const signer of signers) {
    if (!Number.isInteger(signer.weight) || signer.weight < 0 || signer.weight > 255) {
      throw new Error(
        `Invalid signer weight ${signer.weight} for ${signer.publicKey}: must be an integer between 0 and 255`
      );
    }
  }

  const horizon = getHorizonServer(network);
  const passphrase = getNetworkPassphrase(network);
  const masterKeypair = Keypair.fromSecret(masterSignerSecret);
  const account = await horizon.loadAccount(accountId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  });

  // Add each co-signer
  for (const signer of signers) {
    tx.addOperation(
      Operation.setOptions({
        signer: {
          ed25519PublicKey: signer.publicKey,
          weight: signer.weight,
        },
      })
    );
  }

  // Set transaction threshold and master key weight
  tx.addOperation(
    Operation.setOptions({
      lowThreshold: 1,
      medThreshold: threshold,
      highThreshold: threshold,
      masterWeight: 1, // Master can still sign, but not alone
    })
  );

  const built = tx.setTimeout(300).build();

  // Sign with master key
  built.sign(masterKeypair);

  const envelope = built.toEnvelope();
  const xdrBase64 = envelope.toXDR("base64");

  // Compute SHA-256 hash of transaction for signing
  const txHash = built.hash().toString("hex");

  return { txEnvelopeXdr: xdrBase64, txHash };
}

/**
 * Combine multiple signed transaction envelopes into a single transaction
 * with all signatures collected.
 *
 * @param xdrEnvelopes - Array of signed transaction envelope XDRs (base64)
 * @returns Combined transaction envelope XDR with all signatures
 */
export async function combineSignatures(xdrEnvelopes: string[]): Promise<string> {
  if (xdrEnvelopes.length === 0) {
    throw new Error("At least one signed envelope required");
  }

  // Parse first envelope to get the base transaction
  const firstEnvelope = xdr.TransactionEnvelope.fromXDR(xdrEnvelopes[0], "base64");
  const firstSwitch = firstEnvelope.switch();
  const firstTxBodyXdr =
    firstSwitch === xdr.EnvelopeType.envelopeTypeTxV0()
      ? firstEnvelope.v0()?.tx().toXDR("base64")
      : firstSwitch === xdr.EnvelopeType.envelopeTypeTx()
        ? firstEnvelope.v1()?.tx().toXDR("base64")
        : undefined;

  if (!firstTxBodyXdr) {
    throw new Error("Unsupported or invalid transaction envelope at index 0");
  }

  // Collect all signatures from all envelopes
  const allSignatures = new Set<string>();

  for (let i = 0; i < xdrEnvelopes.length; i++) {
    const envelope = xdr.TransactionEnvelope.fromXDR(xdrEnvelopes[i], "base64");
    const envSwitch = envelope.switch();

    if (envSwitch !== firstSwitch) {
      throw new Error(`Envelope at index ${i} has a different envelope type than envelope 0`);
    }

    const txBodyXdr =
      envSwitch === xdr.EnvelopeType.envelopeTypeTxV0()
        ? envelope.v0()?.tx().toXDR("base64")
        : envSwitch === xdr.EnvelopeType.envelopeTypeTx()
          ? envelope.v1()?.tx().toXDR("base64")
          : undefined;

    if (txBodyXdr !== firstTxBodyXdr) {
      throw new Error(`Envelope at index ${i} has a different transaction body than envelope 0`);
    }

    // Extract signatures depending on envelope type
    if (envSwitch === xdr.EnvelopeType.envelopeTypeTxV0()) {
      const v0 = envelope.v0();
      if (v0) {
        v0.signatures().forEach((sig) => {
          allSignatures.add(sig.toXDR("base64"));
        });
      }
    } else if (envSwitch === xdr.EnvelopeType.envelopeTypeTx()) {
      const v1 = envelope.v1();
      if (v1) {
        v1.signatures().forEach((sig) => {
          allSignatures.add(sig.toXDR("base64"));
        });
      }
    }
  }

  // Build new envelope with combined signatures
  let newEnvelope: xdr.TransactionEnvelope;

  if (firstSwitch === xdr.EnvelopeType.envelopeTypeTxV0()) {
    const v0 = firstEnvelope.v0();
    if (!v0) throw new Error("Invalid v0 envelope");

    const signatures = Array.from(allSignatures).map((sig) =>
      xdr.DecoratedSignature.fromXDR(sig, "base64")
    );

    newEnvelope = xdr.TransactionEnvelope.envelopeTypeTxV0(
      new xdr.TransactionV0Envelope({
        tx: v0.tx(),
        signatures,
      })
    );
  } else {
    const v1 = firstEnvelope.v1();
    if (!v1) throw new Error("Invalid transaction envelope");

    const signatures = Array.from(allSignatures).map((sig) =>
      xdr.DecoratedSignature.fromXDR(sig, "base64")
    );

    newEnvelope = xdr.TransactionEnvelope.envelopeTypeTx(
      new xdr.TransactionV1Envelope({
        tx: v1.tx(),
        signatures,
      })
    );
  }

  return newEnvelope.toXDR("base64");
}
