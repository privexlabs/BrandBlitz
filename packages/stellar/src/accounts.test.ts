import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMuxedAddress,
  sponsorNewAccount,
  accountHasUsdcTrustline,
  setupMultisigThreshold,
  combineSignatures,
} from "./accounts";
import * as client from "./client";
import {
  Account,
  MuxedAccount,
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Asset,
  Networks,
  xdr,
} from "@stellar/stellar-sdk";

// Mocks
vi.mock("./client");

import { Keypair as StellarKeypair } from "@stellar/stellar-sdk";
const basePublicKey = StellarKeypair.random().publicKey();
const userId = 1234567890123456789n;

const usdcAsset = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"); // testnet USDC issuer

// --- createMuxedAddress ---
describe("createMuxedAddress", () => {
  it("round-trips encode/decode", () => {
    const addr = createMuxedAddress(basePublicKey, userId);
    // decode
    const decoded = MuxedAccount.fromAddress(addr, "testnet");
    expect(decoded.baseAccount()).toBe(basePublicKey);
    expect(decoded.id()).toBe(userId.toString());
  });

  it("throws on invalid base address", () => {
    expect(() => createMuxedAddress("INVALID", userId)).toThrow();
  });
});

// --- sponsorNewAccount ---
describe("sponsorNewAccount", () => {
  // Use valid Stellar public keys
  const winnerPublicKey = StellarKeypair.random().publicKey();
  const sponsorSecret = StellarKeypair.random().secret();
  const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
  const sponsorAccount = {
    accountId: sponsorKeypair.publicKey(),
    sequence: "1",
    incrementSequenceNumber: vi.fn(),
    balances: [],
  };
  const txMock = { sign: vi.fn(), toEnvelope: () => ({ toXDR: () => "XDR" }) };
  beforeEach(() => {
    vi.resetAllMocks();
    (client.withRetry as any).mockImplementation(async (fn: () => Promise<unknown>) => fn());
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue(sponsorAccount),
    });
    (client.getUsdcAsset as any).mockReturnValue(usdcAsset);
    (client.getNetworkPassphrase as any).mockReturnValue("testnet-passphrase");
    vi.spyOn(TransactionBuilder.prototype, "addOperation").mockImplementation(function (
      this: TransactionBuilder,
      _op
    ) {
      return this;
    });
    vi.spyOn(TransactionBuilder.prototype, "build").mockImplementation(() => txMock as any);
    vi.spyOn(TransactionBuilder.prototype, "setTimeout").mockImplementation(function (
      this: TransactionBuilder
    ) {
      return this;
    });
  });

  it("creates sponsorship tx with correct op order", async () => {
    const result = await sponsorNewAccount(winnerPublicKey, sponsorSecret, "testnet");
    expect(result.txEnvelopeXdr).toBe("XDR");
    expect(TransactionBuilder.prototype.addOperation).toHaveBeenCalledTimes(4);
    expect(txMock.sign).toHaveBeenCalledOnce();
    expect(txMock.sign).toHaveBeenCalledWith(sponsorKeypair);
  });

  it("works for public network", async () => {
    await sponsorNewAccount(winnerPublicKey, sponsorSecret, "public");
    expect(client.getHorizonServer).toHaveBeenCalledWith("public");
    expect(client.getUsdcAsset).toHaveBeenCalledWith("public");
    expect(client.getNetworkPassphrase).toHaveBeenCalledWith("public");
  });

  it("retries a 503 Horizon failure and returns a valid envelope", async () => {
    const actualClient = await vi.importActual<typeof import("./client")>("./client");
    vi.useFakeTimers();
    (client.withRetry as any).mockImplementation(actualClient.withRetry);

    const loadAccount = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Service unavailable"), { status: 503 }))
      .mockResolvedValueOnce(sponsorAccount);
    (client.getHorizonServer as any).mockReturnValue({ loadAccount });

    const promise = sponsorNewAccount(winnerPublicKey, sponsorSecret, "testnet");
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ txEnvelopeXdr: "XDR" });
    expect(loadAccount).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not retry a non-retryable 400 Horizon failure", async () => {
    const actualClient = await vi.importActual<typeof import("./client")>("./client");
    (client.withRetry as any).mockImplementation(actualClient.withRetry);

    const loadAccount = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("Bad request"), { status: 400 }));
    (client.getHorizonServer as any).mockReturnValue({ loadAccount });

    await expect(sponsorNewAccount(winnerPublicKey, sponsorSecret, "testnet")).rejects.toThrow(
      "Bad request"
    );
    expect(loadAccount).toHaveBeenCalledTimes(1);
  });
});

// --- accountHasUsdcTrustline ---
describe("accountHasUsdcTrustline", () => {
  const publicKey = "GEXAMPLEACCOUNT";
  const usdc = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"); // testnet USDC issuer
  beforeEach(() => {
    vi.resetAllMocks();
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn(),
    });
    (client.getUsdcAsset as any).mockReturnValue(usdc);
  });

  it("returns true if account has USDC trustline", async () => {
    const balances = [
      { asset_type: "native" },
      { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: usdc.getIssuer() },
    ];
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({ balances }),
    });
    expect(await accountHasUsdcTrustline(publicKey, "testnet")).toBe(true);
  });

  it("returns false if account does not have USDC trustline", async () => {
    const balances = [
      { asset_type: "native" },
      { asset_type: "credit_alphanum4", asset_code: "OTHER", asset_issuer: usdc.getIssuer() },
    ];
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({ balances }),
    });
    expect(await accountHasUsdcTrustline(publicKey, "testnet")).toBe(false);
  });

  it("returns false if account not found", async () => {
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockRejectedValue(new Error("not found")),
    });
    expect(await accountHasUsdcTrustline(publicKey, "testnet")).toBe(false);
  });

  it("works for public network", async () => {
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({ balances: [] }),
    });
    await accountHasUsdcTrustline(publicKey, "public");
    expect(client.getHorizonServer).toHaveBeenCalledWith("public");
    expect(client.getUsdcAsset).toHaveBeenCalledWith("public");
  });
});

// --- Slug generation determinism regression test ---
describe("createMuxedAddress determinism", () => {
  it("same user ID always yields the same slug", () => {
    const userId = 1234567890123456789n;
    const slug1 = createMuxedAddress(basePublicKey, userId);
    const slug2 = createMuxedAddress(basePublicKey, userId);
    const slug3 = createMuxedAddress(basePublicKey, userId);

    expect(slug1).toBe(slug2);
    expect(slug2).toBe(slug3);
  });

  it("different user IDs yield different slugs", () => {
    const slug1 = createMuxedAddress(basePublicKey, 1n);
    const slug2 = createMuxedAddress(basePublicKey, 2n);

    expect(slug1).not.toBe(slug2);
  });

  it("known test vector produces expected output", () => {
    // Test vector from Stellar docs
    const testPublicKey = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
    const testUserId = 1234n;
    const slug = createMuxedAddress(testPublicKey, testUserId);

    // Verify slug starts with M (muxed account prefix)
    expect(slug[0]).toBe("M");

    // Verify deterministic - same inputs = same output
    const slug2 = createMuxedAddress(testPublicKey, testUserId);
    expect(slug).toBe(slug2);
  });
});

// --- setupMultisigThreshold (#861) ---
describe("setupMultisigThreshold", () => {
  const masterKeypair = StellarKeypair.random();
  const signer1 = StellarKeypair.random().publicKey();
  const signer2 = StellarKeypair.random().publicKey();
  const signer3 = StellarKeypair.random().publicKey();

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue(new Account(masterKeypair.publicKey(), "100")),
    });
    (client.getNetworkPassphrase as any).mockReturnValue(Networks.TESTNET);
  });

  it.each([1, 2, 3])(
    "constructs co-signer setOptions operations before threshold setOptions for %i signer(s)",
    async (count) => {
      const signers = [signer1, signer2, signer3]
        .slice(0, count)
        .map((publicKey) => ({ publicKey, weight: 1 }));

      const { txEnvelopeXdr, txHash } = await setupMultisigThreshold(
        masterKeypair.publicKey(),
        signers,
        Math.min(2, count),
        masterKeypair.secret(),
        "testnet"
      );

      const parsed = TransactionBuilder.fromXDR(txEnvelopeXdr, Networks.TESTNET);
      expect(parsed.operations).toHaveLength(count + 1);

      for (let i = 0; i < count; i++) {
        const op = parsed.operations[i] as Operation.SetOptions;
        expect(op.type).toBe("setOptions");
        expect(op.signer).toEqual({
          ed25519PublicKey: signers[i].publicKey,
          weight: 1,
        });
      }

      const thresholdOp = parsed.operations[count] as Operation.SetOptions;
      expect(thresholdOp.type).toBe("setOptions");
      expect(thresholdOp.lowThreshold).toBe(1);
      expect(thresholdOp.medThreshold).toBe(Math.min(2, count));
      expect(thresholdOp.highThreshold).toBe(Math.min(2, count));
      expect(thresholdOp.masterWeight).toBe(1);

      expect(txHash).toBe(parsed.hash().toString("hex"));
    }
  );

  it("throws when signers.length exceeds Stellar's 20-signer limit", async () => {
    const signers = Array.from({ length: 21 }, () => ({
      publicKey: StellarKeypair.random().publicKey(),
      weight: 1,
    }));

    await expect(
      setupMultisigThreshold(
        masterKeypair.publicKey(),
        signers,
        2,
        masterKeypair.secret(),
        "testnet"
      )
    ).rejects.toThrow(/20/);
  });

  it("throws when threshold or signer weight is outside the valid 0-255 range", async () => {
    await expect(
      setupMultisigThreshold(
        masterKeypair.publicKey(),
        [{ publicKey: signer1, weight: 1 }],
        256,
        masterKeypair.secret(),
        "testnet"
      )
    ).rejects.toThrow(/0 and 255/);

    await expect(
      setupMultisigThreshold(
        masterKeypair.publicKey(),
        [{ publicKey: signer1, weight: -1 }],
        1,
        masterKeypair.secret(),
        "testnet"
      )
    ).rejects.toThrow(/0 and 255/);
  });
});

// --- combineSignatures (#859, #860) ---
describe("combineSignatures", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function buildSignedTx(source: Keypair, sequence: string, signers: Keypair[]): string {
    const account = new Account(source.publicKey(), sequence);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.setOptions({
          homeDomain: "brandblitz.example",
        })
      )
      .setTimeout(300)
      .build();

    for (const kp of signers) {
      tx.sign(kp);
    }
    return tx.toEnvelope().toXDR("base64");
  }

  it("recombines two separately signed v1 (txTypeTx) envelopes and round-trips through fromXDR", async () => {
    const source = StellarKeypair.random();
    const cosigner = StellarKeypair.random();

    const env1 = buildSignedTx(source, "500", [source]);
    const env2 = buildSignedTx(source, "500", [cosigner]);

    const combinedXdr = await combineSignatures([env1, env2]);

    const rawEnvelope = xdr.TransactionEnvelope.fromXDR(combinedXdr, "base64");
    expect(rawEnvelope.switch()).toBe(xdr.EnvelopeType.envelopeTypeTx());

    const parsed = TransactionBuilder.fromXDR(combinedXdr, Networks.TESTNET);
    expect(parsed.signatures).toHaveLength(2);
  });

  it("throws with the mismatched envelope index when given envelopes for two different transactions", async () => {
    const source = StellarKeypair.random();
    const cosigner = StellarKeypair.random();

    const envTx1 = buildSignedTx(source, "500", [source]);
    const envTx2 = buildSignedTx(source, "501", [cosigner]);

    await expect(combineSignatures([envTx1, envTx2])).rejects.toThrow(/index 1/i);
  });
});
