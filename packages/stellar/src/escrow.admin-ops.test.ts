import { createHash } from "crypto";
import { Account, Keypair, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EscrowClient } from "./escrow";

const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

const config = {
  contractId: CONTRACT_ID,
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: PASSPHRASE,
};

/** Builds a contract-instance ScVal whose storage holds the given unit-variant DataKey entries. */
function instanceWith(entries: Record<string, xdr.ScVal>): xdr.ScVal {
  const storage = Object.entries(entries).map(([name, val]) =>
    xdr.ScMapEntry.create({ key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]), val })
  );
  const instance = xdr.ScContractInstance.create({
    executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32)),
    storage,
  });
  return xdr.ScVal.scvContractInstance(instance);
}

describe("EscrowClient.generateAdminOperationXdr", () => {
  let client: EscrowClient;
  const admin = Keypair.random();
  const recipient = Keypair.random().publicKey();

  beforeEach(() => {
    client = new EscrowClient(config);
    (client as any).horizonServer = {
      loadAccount: vi.fn().mockResolvedValue(new Account(admin.publicKey(), "100")),
    };
  });

  it("rejects withdraw instead of building a classic self-payment", async () => {
    await expect(
      client.generateAdminOperationXdr("withdraw", { amount: 10_000_000n }, admin.secret())
    ).rejects.toThrow(/withdraw is not supported/);
  });

  it("rejects an unrecognised operation rather than returning an empty transaction", async () => {
    await expect(
      client.generateAdminOperationXdr("drain" as any, {}, admin.secret())
    ).rejects.toThrow(/Unsupported admin operation: drain/);
  });

  it("builds close_escrow as a Soroban invocation of the contract's refund entrypoint", async () => {
    const { xdrUnsigned } = await client.generateAdminOperationXdr(
      "close_escrow",
      {},
      admin.secret()
    );
    const tx = TransactionBuilder.fromXDR(xdrUnsigned, PASSPHRASE) as any;
    expect(tx.operations).toHaveLength(1);
    // Never a classic self-merge of the admin account into itself (#882).
    expect(tx.operations[0].type).not.toBe("accountMerge");
    expect(tx.operations[0].type).toBe("invokeHostFunction");
    const invocation = (tx.operations[0].func as xdr.HostFunction).invokeContract();
    expect(invocation.functionName().toString()).toBe("refund");
  });

  it("builds distribute as a Soroban invocation of the contract's settle entrypoint", async () => {
    const { xdrUnsigned } = await client.generateAdminOperationXdr(
      "distribute",
      { recipients: [{ address: recipient, amount: 1_000_000n }] },
      admin.secret()
    );
    const tx = TransactionBuilder.fromXDR(xdrUnsigned, PASSPHRASE) as any;
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0].type).toBe("invokeHostFunction");
  });

  it("returns an unsigned envelope", async () => {
    const { xdrUnsigned } = await client.generateAdminOperationXdr(
      "close_escrow",
      {},
      admin.secret()
    );
    const tx = TransactionBuilder.fromXDR(xdrUnsigned, PASSPHRASE);
    expect(tx.signatures).toHaveLength(0);
  });

  it("returns the sha256 hex digest of the unsigned XDR as operationHash", async () => {
    const { xdrUnsigned, operationHash } = await client.generateAdminOperationXdr(
      "close_escrow",
      {},
      admin.secret()
    );
    expect(operationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(operationHash).toBe(createHash("sha256").update(xdrUnsigned, "utf-8").digest("hex"));
  });
});

describe("EscrowClient view methods read instance storage", () => {
  let client: EscrowClient;
  let getContractData: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new EscrowClient(config);
    getContractData = vi.fn();
    (client as any).sorobanServer = { getContractData };
  });

  it("looks up the contract-instance ledger entry, not a bare per-key symbol", async () => {
    getContractData.mockResolvedValue({ val: instanceWith({}) });
    await client.getBalance();
    const [, key] = getContractData.mock.calls[0];
    expect(key.toXDR("base64")).toBe(xdr.ScVal.scvLedgerKeyContractInstance().toXDR("base64"));
  });

  it("reads Balance from the DataKey::Balance entry", async () => {
    getContractData.mockResolvedValue({
      val: instanceWith({ Balance: nativeToScVal(1_234_567n, { type: "i128" }) }),
    });
    expect(await client.getBalance()).toBe(1_234_567n);
  });

  it("returns zero when Balance is unset", async () => {
    getContractData.mockResolvedValue({ val: instanceWith({ Settled: xdr.ScVal.scvBool(false) }) });
    expect(await client.getBalance()).toBe(0n);
  });

  it("reads Settled from the DataKey::Settled entry", async () => {
    getContractData.mockResolvedValue({ val: instanceWith({ Settled: xdr.ScVal.scvBool(true) }) });
    expect(await client.isSettled()).toBe(true);
  });

  it("reports not settled when the entry is missing", async () => {
    getContractData.mockResolvedValue(null);
    expect(await client.isSettled()).toBe(false);
  });

  it("reads Memo from the DataKey::Memo entry", async () => {
    getContractData.mockResolvedValue({
      val: instanceWith({ Memo: xdr.ScVal.scvString("challenge-7") }),
    });
    expect(await client.getMemo()).toBe("challenge-7");
  });
});

describe("EscrowClient.settle authorization", () => {
  let client: EscrowClient;
  const signer = Keypair.random();
  const recipients = [{ address: Keypair.random().publicKey(), amountStroops: 1n }];

  beforeEach(() => {
    client = new EscrowClient(config);
    (client as any).horizonServer = {
      loadAccount: vi.fn().mockResolvedValue(new Account(signer.publicKey(), "7")),
    };
  });

  it("simulates and signs the prepared transaction before sending it", async () => {
    const prepared = { sign: vi.fn() };
    const prepareTransaction = vi.fn().mockResolvedValue(prepared);
    const sendTransaction = vi.fn().mockResolvedValue({ status: "PENDING", hash: "tx-settle" });
    (client as any).sorobanServer = { prepareTransaction, sendTransaction };

    await expect(client.settle(recipients, signer.secret())).resolves.toBe("tx-settle");
    expect(prepareTransaction).toHaveBeenCalledTimes(1);
    expect(prepared.sign).toHaveBeenCalledWith(expect.anything());
    expect(sendTransaction).toHaveBeenCalledWith(prepared);
  });

  it("surfaces an authorization failure as a readable admin error", async () => {
    (client as any).sorobanServer = {
      prepareTransaction: vi
        .fn()
        .mockRejectedValue(new Error("HostError: Error(Auth, InvalidAction) require_auth failed")),
      sendTransaction: vi.fn(),
    };
    await expect(client.settle(recipients, signer.secret())).rejects.toThrow(
      /Settle rejected: the admin did not authorise this call/
    );
  });

  it("surfaces other simulation failures with the operation name", async () => {
    (client as any).sorobanServer = {
      prepareTransaction: vi.fn().mockRejectedValue(new Error("Error(Contract, #5)")),
      sendTransaction: vi.fn(),
    };
    await expect(client.settle(recipients, signer.secret())).rejects.toThrow(
      /Settle simulation failed/
    );
  });
});
