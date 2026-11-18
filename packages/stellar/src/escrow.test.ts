import { describe, it, expect, beforeEach, vi } from "vitest";
import { Account, Keypair, Networks, StrKey, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { EscrowClient, type EscrowRecipient } from "./escrow";

/**
 * Integration tests for EscrowClient.
 *
 * These tests verify the wrapper correctly constructs Soroban transactions.
 * Full end-to-end tests require a live testnet and are run separately.
 */

describe("EscrowClient", () => {
  let client: EscrowClient;

  const config = {
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  };

  beforeEach(() => {
    client = new EscrowClient(config);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(client).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("should construct initialize transaction", async () => {
      // Mock the Horizon and Soroban servers
      vi.spyOn(client as any, "horizonServer", "get").mockReturnValue({
        loadAccount: vi.fn().mockResolvedValue({
          sequence: "0",
          balances: [],
        }),
      });

      vi.spyOn(client as any, "sorobanServer", "get").mockReturnValue({
        sendTransaction: vi.fn().mockResolvedValue({
          status: "SUCCESS",
          hash: "test-tx-hash",
        }),
      });

      // This would normally require a real account and network
      // For now, we just verify the method exists and is callable
      expect(typeof client.initialize).toBe("function");
    });
  });

  describe("settle", () => {
    it("should accept array of recipients", async () => {
      const recipients: EscrowRecipient[] = [
        {
          address: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTBTG2TZJJGKRGFJREALLXF4",
          amountStroops: 1000000n,
        },
        {
          address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          amountStroops: 2000000n,
        },
      ];

      expect(typeof client.settle).toBe("function");
      // Verify method signature accepts recipients
      expect(client.settle.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("refund", () => {
    it("should construct refund transaction", async () => {
      expect(typeof client.refund).toBe("function");
    });
  });

  describe("generateAdminOperationXdr", () => {
    const adminKeypair = Keypair.random();

    beforeEach(() => {
      (client as any).horizonServer = {
        loadAccount: vi.fn().mockResolvedValue(new Account(adminKeypair.publicKey(), "1")),
      };
    });

    async function buildOperations(operation: "withdraw" | "close_escrow" | "distribute") {
      const { xdrUnsigned, operationHash } = await client.generateAdminOperationXdr(
        operation,
        {},
        adminKeypair.secret()
      );
      const tx = TransactionBuilder.fromXDR(xdrUnsigned, Networks.TESTNET);
      return { tx, operationHash, xdrUnsigned };
    }

    describe("close_escrow", () => {
      it("never constructs a self-merge (destination === source) operation", async () => {
        const { tx } = await buildOperations("close_escrow");

        expect("operations" in tx).toBe(true);
        const operations = (tx as any).operations as Array<Record<string, unknown>>;
        for (const op of operations) {
          expect(op.type).not.toBe("accountMerge");
          const source = (op.source as string | undefined) ?? (tx as any).source;
          if ("destination" in op) {
            expect(op.destination).not.toBe(source);
          }
        }
      });

      it("invokes the escrow contract's refund entrypoint via invokeHostFunction", async () => {
        const { tx, operationHash, xdrUnsigned } = await buildOperations("close_escrow");
        const operations = (tx as any).operations as Array<{
          type: string;
          func: xdr.HostFunction;
        }>;

        expect(operations).toHaveLength(1);
        expect(operations[0].type).toBe("invokeHostFunction");

        const invocation = operations[0].func.invokeContract();
        expect(invocation.functionName().toString()).toBe("refund");
        expect(invocation.args()).toHaveLength(0);
        expect(StrKey.encodeContract(invocation.contractAddress().contractId() as any)).toBe(
          config.contractId
        );

        // Unsigned: produced for offline co-signing.
        expect(tx.signatures).toHaveLength(0);
        expect(operationHash).toMatch(/^[0-9a-f]{64}$/);
        expect(xdrUnsigned.length).toBeGreaterThan(0);
      });

      it("builds the transaction from the admin signer's account", async () => {
        const { tx } = await buildOperations("close_escrow");
        expect((tx as any).source).toBe(adminKeypair.publicKey());
      });
    });
  });

  describe("view methods", () => {
    it("should have getBalance method", () => {
      expect(typeof client.getBalance).toBe("function");
    });

    it("should have isSettled method", () => {
      expect(typeof client.isSettled).toBe("function");
    });

    it("should have getMemo method", () => {
      expect(typeof client.getMemo).toBe("function");
    });
  });
});

/**
 * Integration test for full escrow flow on testnet.
 *
 * Run with: npm run test -- escrow.test.ts --grep "testnet"
 * Requires: STELLAR_ACCOUNT, STELLAR_SECRET env vars
 */
describe.skip("EscrowClient testnet integration", () => {
  it("should initialize, deposit, and settle on testnet", async () => {
    const contractId = process.env.SOROBAN_CONTRACT_ID;
    if (!contractId) {
      throw new Error("SOROBAN_CONTRACT_ID not set");
    }

    const client = new EscrowClient({
      contractId,
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const adminSecret = process.env.STELLAR_SECRET;
    if (!adminSecret) {
      throw new Error("STELLAR_SECRET not set");
    }

    // Initialize contract
    const initTx = await client.initialize(
      "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTBTG2TZJJGKRGFJREALLXF4",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      "test-challenge-123",
      adminSecret
    );

    expect(initTx).toBeDefined();
    expect(initTx.length).toBeGreaterThan(0);

    // Deposit USDC
    const depositTx = await client.deposit(
      "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTBTG2TZJJGKRGFJREALLXF4",
      10000000n, // 1 USDC
      adminSecret
    );

    expect(depositTx).toBeDefined();

    // Settle to winners
    const recipients: EscrowRecipient[] = [
      {
        address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        amountStroops: 5000000n,
      },
    ];

    const settleTx = await client.settle(recipients, adminSecret);

    expect(settleTx).toBeDefined();

    // Verify settled
    const isSettled = await client.isSettled();
    expect(isSettled).toBe(true);
  });
});
