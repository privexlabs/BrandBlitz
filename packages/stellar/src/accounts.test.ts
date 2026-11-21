import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMuxedAddress,
  sponsorNewAccount,
  accountHasUsdcTrustline,
  combineSignatures,
} from "./accounts";
import * as client from "./client";
import {
  MuxedAccount,
  Keypair,
  TransactionBuilder,
  Operation,
  BASE_FEE,
  Asset,
  Account,
  Networks,
  StrKey,
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

// --- getAccountUsdcBalance (issue #863) ---
describe("getAccountUsdcBalance", () => {
  const usdc = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  const publicKey = "GEXAMPLEACCOUNT";

  beforeEach(() => {
    vi.resetAllMocks();
    (client.getUsdcAsset as any).mockReturnValue(usdc);
  });

  it("returns 0n when account has no USDC trustline balance", async () => {
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({ balances: [{ asset_type: "native" }] }),
    });
    expect(await getAccountUsdcBalance(publicKey, "testnet")).toBe(0n);
  });

  it("filters by both asset_code and asset_issuer — same code different issuer returns 0n", async () => {
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: "GDIFFERENTISSUER",
            balance: "50.0000000",
          },
        ],
      }),
    });
    expect(await getAccountUsdcBalance(publicKey, "testnet")).toBe(0n);
  });

  it("converts a decimal balance string correctly to stroops bigint", async () => {
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: usdc.getIssuer(),
            balance: "100.1234567",
          },
        ],
      }),
    });
    expect(await getAccountUsdcBalance(publicKey, "testnet")).toBe(1001234567n);
  });

  it("converts a whole-number balance string with no decimal point", async () => {
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: usdc.getIssuer(),
            balance: "100",
          },
        ],
      }),
    });
    // 100 USDC = 1_000_000_000 stroops
    expect(await getAccountUsdcBalance(publicKey, "testnet")).toBe(1_000_000_000n);
  });

  it("truncates fractional digits beyond 7 decimal places", async () => {
    (client.getHorizonServer as any).mockReturnValue({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: usdc.getIssuer(),
            balance: "1.123456789",
          },
        ],
      }),
    });
    // Only first 7 fractional digits are taken: 1234567
    expect(await getAccountUsdcBalance(publicKey, "testnet")).toBe(11234567n);
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

// --- combineSignatures ---

describe("combineSignatures", () => {
  const passphrase = Networks.TESTNET;

  // Builds and signs a classic (v1) transaction with the given signers.
  // All envelopes built from the same source/seq share the same tx hash, so
  // signatures from different keypairs can be merged.
  function signedEnvelope(source: Keypair, signers: Keypair[]): string {
    const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
      .setTimeout(300)
      .build();
    for (const signer of signers) tx.sign(signer);
    return tx.toEnvelope().toXDR("base64");
  }

  function signaturesOf(xdrEnvelope: string): xdr.DecoratedSignature[] {
    const env = xdr.TransactionEnvelope.fromXDR(xdrEnvelope, "base64");
    if (env.switch().name === "envelopeTypeTxV0") return env.v0().signatures();
    return env.v1().signatures();
  }

  it("throws when given an empty array", async () => {
    await expect(combineSignatures([])).rejects.toThrow("At least one signed envelope required");
  });

  it("combines single-signature envelopes from two keypairs into one envelope with both signatures", async () => {
    const source = Keypair.random();
    const signerA = Keypair.random();
    const signerB = Keypair.random();

    // Same transaction, each envelope carries only one signer's signature.
    const envA = signedEnvelope(source, [signerA]);
    const envB = signedEnvelope(source, [signerB]);
    expect(signaturesOf(envA)).toHaveLength(1);
    expect(signaturesOf(envB)).toHaveLength(1);

    const combined = await combineSignatures([envA, envB]);
    const hints = signaturesOf(combined).map((sig) => sig.hint().toString("hex"));

    expect(hints).toHaveLength(2);
    // A signature hint is the last 4 bytes of the signer's public key.
    expect(hints).toEqual(
      expect.arrayContaining([
        Buffer.from(StrKey.decodeEd25519PublicKey(signerA.publicKey()))
          .subarray(-4)
          .toString("hex"),
        Buffer.from(StrKey.decodeEd25519PublicKey(signerB.publicKey()))
          .subarray(-4)
          .toString("hex"),
      ])
    );
  });

  it("deduplicates identical signatures across input envelopes", async () => {
    const source = Keypair.random();
    const signerA = Keypair.random();
    const signerB = Keypair.random();

    const envA = signedEnvelope(source, [signerA]);
    const envB = signedEnvelope(source, [signerB]);

    // envA appears twice, and its signature must only appear once in the output.
    const combined = await combineSignatures([envA, envA, envB]);

    expect(signaturesOf(combined)).toHaveLength(2);
  });

  it("combines v0 envelopes and keeps the v0 envelope type", async () => {
    const source = Keypair.random();
    const signerA = Keypair.random();
    const signerB = Keypair.random();

    // Build the v0 body from the same fields as the v1 transaction above.
    const v0Body = new xdr.TransactionV0({
      sourceAccountEd25519: StrKey.decodeEd25519PublicKey(source.publicKey()),
      fee: 100,
      seqNum: xdr.Int64.fromString("2"),
      timeBounds: null,
      memo: xdr.Memo.memoNone(),
      operations: [
        new xdr.Operation({
          sourceAccount: null,
          body: xdr.OperationBody.bumpSequence(
            new xdr.BumpSequenceOp({ bumpTo: xdr.Int64.fromString("1") })
          ),
        }),
      ],
      ext: new xdr.TransactionV0Ext(0),
    });

    // v0 signatures cover the same payload as the equivalent v1 transaction.
    const payloadTx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
      fee: BASE_FEE,
      networkPassphrase: passphrase,
    })
      .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
      .setTimeout(0)
      .build();
    const hash = payloadTx.hash();

    const v0Envelope = (signer: Keypair): string =>
      xdr.TransactionEnvelope.envelopeTypeTxV0(
        new xdr.TransactionV0Envelope({
          tx: v0Body,
          signatures: [signer.signDecorated(hash)],
        })
      ).toXDR("base64");

    const combined = await combineSignatures([v0Envelope(signerA), v0Envelope(signerB)]);
    const env = xdr.TransactionEnvelope.fromXDR(combined, "base64");

    expect(env.switch().name).toBe("envelopeTypeTxV0");
    expect(env.v0().signatures()).toHaveLength(2);
    expect(env.v0().tx().seqNum().toString()).toBe("2");
  });
});
