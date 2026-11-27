import {
  Address,
  authorizeEntry,
  Contract,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  Horizon,
  rpc,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { withRetry, type RetryOptions } from "./client";

/** How many ledgers a signed Soroban address authorization stays valid for. */
const AUTH_ENTRY_VALIDITY_LEDGERS = 100;

export interface EscrowRecipient {
  address: string;
  amountStroops: bigint;
}

export interface EscrowConfig {
  contractId: string;
  horizonUrl: string;
  sorobanUrl: string;
  networkPassphrase: string;
}

/**
 * Builds the ScVal key for a unit variant of the contract's `#[contracttype] enum DataKey`.
 * soroban-sdk encodes unit variants as a one-element vector holding the variant name.
 */
function dataKeyUnitVariant(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

/**
 * Turns a failed transaction simulation into an error that names the operation and,
 * for authorization failures, says which party did not authorise the call.
 */
function explainSimulationError(operation: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/require_auth|authoriz|authoris|\bauth\b/i.test(message)) {
    return new Error(`${operation} rejected: the admin did not authorise this call (${message})`);
  }
  return new Error(`${operation} simulation failed: ${message}`);
}

/**
 * Soroban Escrow Contract Wrapper
 *
 * Wraps initialize, deposit, settle, and refund calls to the USDC escrow contract.
 * The contract holds prize pools atomically and distributes to winners on settlement.
 */
export class EscrowClient {
  private contract: Contract;
  private horizonServer: Horizon.Server;
  private sorobanServer: rpc.Server;
  private networkPassphrase: string;

  constructor(config: EscrowConfig) {
    this.contract = new Contract(config.contractId);
    this.horizonServer = new Horizon.Server(config.horizonUrl);
    this.sorobanServer = new rpc.Server(config.sorobanUrl);
    this.networkPassphrase = config.networkPassphrase;
  }

  /**
   * Initialize the escrow contract for a challenge.
   * Called once per challenge to set up the contract instance.
   *
   * Authorization: the contract's `initialize` does not call `require_auth`, so no
   * authorization entry is attached. The signer only pays the fee.
   *
   * @param admin - BrandBlitz hot-wallet address (authorized to settle/refund)
   * @param usdcTokenAddress - USDC SAC contract address on this network
   * @param memo - Challenge ID (unique identifier for this escrow)
   * @param signerSecret - Hot-wallet secret key for signing
   */
  async initialize(
    admin: string,
    usdcTokenAddress: string,
    memo: string,
    signerSecret: string
  ): Promise<string> {
    const signer = Keypair.fromSecret(signerSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call(
            "initialize",
            new Address(admin).toScVal(),
            new Address(usdcTokenAddress).toScVal(),
            nativeToScVal(memo, { type: "string" })
          ),
          auth: [],
        })
      )
      .setTimeout(300)
      .build();

    const prepared = await this.prepareAndSign(tx, signer, "Initialize");
    const result = await withRetry(() => this.sorobanServer.sendTransaction(prepared), {
      maxAttempts: 5,
      baseDelayMs: 250,
      maxDelayMs: 30_000,
    });

    if (result.status === "ERROR") {
      throw new Error(`Initialize failed: ${result.error_details}`);
    }

    return result.hash;
  }

  /**
   * Deposit USDC into the escrow contract.
   * Called by the brand to fund the prize pool.
   *
   * The authorization entries are not hand-built: simulation reports the
   * entries the contract requires, and each depositor entry is signed through
   * the SDK's authorizeEntry over the real authorization preimage.
   * Authorization: the depositor must sign (`depositor.require_auth()` on the contract),
   * so an explicit address credential is attached.
   *
   * @param depositor - Brand address (must have approved USDC for contract)
   * @param amountStroops - Amount in stroops (1 USDC = 10^7 stroops)
   * @param signerSecret - Depositor's secret key for signing
   */
  async deposit(depositor: string, amountStroops: bigint, signerSecret: string): Promise<string> {
    const signer = Keypair.fromSecret(signerSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call(
            "deposit",
            new Address(depositor).toScVal(),
            nativeToScVal(Number(amountStroops), { type: "i128" })
          ),
          auth: [],
        })
      )
      .setTimeout(300)
      .build();

    const prepared = await this.prepareAndSign(tx, signer, "Deposit");
    const result = await withRetry(() => this.sorobanServer.sendTransaction(prepared), {
      maxAttempts: 5,
      baseDelayMs: 250,
      maxDelayMs: 30_000,
    });

    if (result.status === "ERROR") {
      throw new Error(`Deposit failed: ${result.error_details}`);
    }

    return result.hash;
  }

  /**
   * Settle the escrow by distributing USDC to winners.
   * Called by the backend after challenge ends to pay out winners.
   *
   * Authorization: the contract calls `admin.require_auth()`. The transaction is simulated
   * and prepared before signing, so the auth entry for the admin is filled in from the
   * simulation. If the admin does not authorise the call, this throws a readable error
   * instead of the generic "Settle failed".
   *
   * @param recipients - Array of (address, amountStroops) pairs
   * @param signerSecret - Hot-wallet secret key for signing
   */
  async settle(recipients: EscrowRecipient[], signerSecret: string): Promise<string> {
    const signer = Keypair.fromSecret(signerSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    // Convert recipients to Soroban format
    const recipientScVals = recipients.map((r) =>
      nativeToScVal([new Address(r.address).toScVal(), Number(r.amountStroops)], { type: "vec" })
    );

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call("settle", nativeToScVal(recipientScVals, { type: "vec" })),
          auth: [],
        })
      )
      .setTimeout(300)
      .build();

    const prepared = await this.prepareAndSign(tx, signer, "Settle");
    const result = await withRetry(() => this.sorobanServer.sendTransaction(prepared), {
      maxAttempts: 5,
      baseDelayMs: 250,
      maxDelayMs: 30_000,
    });

    if (result.status === "ERROR") {
      throw new Error(`Settle failed: ${result.error_details}`);
    }

    return result.hash;
  }

  /**
   * Refund the full balance back to the depositor.
   * Called by admin for cancelled challenges.
   *
   * Authorization: the contract calls `admin.require_auth()`. The transaction is simulated and
   * prepared before signing, the same as `settle`.
   *
   * @param signerSecret - Admin hot-wallet secret key for signing
   */
  async refund(signerSecret: string): Promise<string> {
    const signer = Keypair.fromSecret(signerSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call("refund"),
          auth: [],
        })
      )
      .setTimeout(300)
      .build();

    const prepared = await this.prepareAndSign(tx, signer, "Refund");
    const result = await withRetry(() => this.sorobanServer.sendTransaction(prepared), {
      maxAttempts: 5,
      baseDelayMs: 250,
      maxDelayMs: 30_000,
    });

    if (result.status === "ERROR") {
      throw new Error(`Refund failed: ${result.error_details}`);
    }

    return result.hash;
  }

  /**
   * Simulate the built transaction, attach the resulting footprint, resource fee and
   * auth entries, sign the signer's authorizations, then sign the transaction.
   * Soroban rejects invocations that skip this step.
   */
  private async prepareAndSign(
    tx: Transaction,
    signer: Keypair,
    operation: string
  ): Promise<Transaction> {
    // Not retried: a simulation failure is deterministic. Authorization failures get a readable error.
    const prepared = (await this.sorobanServer.prepareTransaction(tx).catch((e: unknown) => {
      throw explainSimulationError(operation, e);
    })) as Transaction;

    const authorized = await this.authorizeSignerEntries(prepared, signer);
    authorized.sign(signer);
    return authorized;
  }

  /**
   * Sign every address-credential authorization entry that belongs to the signer.
   * Entries using source-account credentials are authorized by the transaction signature
   * itself, so they are left untouched.
   */
  private async authorizeSignerEntries(tx: Transaction, signer: Keypair): Promise<Transaction> {
    const envelope = tx.toEnvelope();
    let validUntilLedger: number | undefined;
    let changed = false;

    for (const operation of envelope.v1().tx().operations()) {
      const body = operation.body();
      if (body.switch() !== xdr.OperationType.invokeHostFunction()) {
        continue;
      }

      const invoke = body.invokeHostFunctionOp();
      const signedEntries: xdr.SorobanAuthorizationEntry[] = [];

      for (const entry of invoke.auth()) {
        const credentials = entry.credentials();
        const isSignerAddress =
          credentials.switch() === xdr.SorobanCredentialsType.sorobanCredentialsAddress() &&
          Address.fromScAddress(credentials.address().address()).toString() === signer.publicKey();

        if (!isSignerAddress) {
          signedEntries.push(entry);
          continue;
        }

        if (validUntilLedger === undefined) {
          const latest = await this.sorobanServer.getLatestLedger();
          validUntilLedger = latest.sequence + AUTH_ENTRY_VALIDITY_LEDGERS;
        }

        signedEntries.push(
          await authorizeEntry(entry, signer, validUntilLedger, this.networkPassphrase)
        );
        changed = true;
      }

      invoke.auth(signedEntries);
    }

    if (!changed) {
      return tx;
    }

    return new Transaction(envelope.toXDR("base64"), this.networkPassphrase);
  }

  /**
   * Reads a `DataKey` value. The contract writes these to instance storage, which is
   * held inside the contract-instance ledger entry rather than under its own key. A
   * per-key lookup therefore never finds them. Returns null when the key is unset.
   */
  private async readInstanceValue(variant: string): Promise<xdr.ScVal | null> {
    const instance = await withRetry(
      () =>
        this.sorobanServer.getContractData(
          this.contract.address().contractId(),
          xdr.ScVal.scvLedgerKeyContractInstance()
        ),
      { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5_000 }
    );

    if (!instance) {
      return null;
    }

    const storage = instance.val.instance().storage();
    if (!storage) {
      return null;
    }

    const wanted = dataKeyUnitVariant(variant).toXDR("base64");
    const entry = storage.find((e) => e.key().toXDR("base64") === wanted);
    return entry ? entry.val() : null;
  }

  /**
   * View: Get the current escrowed balance.
   */
  async getBalance(): Promise<bigint> {
    const value = await this.readInstanceValue("Balance");
    if (!value) {
      return 0n;
    }

    return BigInt(scValToNative(value) as number | bigint);
  }

  /**
   * View: Check if the escrow has been settled or refunded.
   */
  async isSettled(): Promise<boolean> {
    const value = await this.readInstanceValue("Settled");
    if (!value) {
      return false;
    }

    return scValToNative(value) as boolean;
  }

  /**
   * View: Get the challenge memo string (returns empty string if uninitialized).
   */
  async getMemo(): Promise<string> {
    const value = await this.readInstanceValue("Memo");
    if (!value) {
      return "";
    }

    return scValToNative(value) as string;
  }

  /**
   * Generate unsigned XDR for admin operations without submitting.
   * External signers review and co-sign offline before submission.
   *
   * @param operation - "withdraw" | "close_escrow" | "distribute"
   *   - `close_escrow` finalizes the Soroban escrow by invoking the contract's
   *     `refund` entrypoint (remaining balance → depositor, escrow marked settled).
   * @param operationData - Operation-specific parameters
   * @param adminSecret - Admin/hot-wallet secret for signing
   * @returns { xdrUnsigned, operationHash } for external co-signing
   */
  async generateAdminOperationXdr(
    operation: "withdraw" | "close_escrow" | "distribute",
    operationData: Record<string, unknown>,
    adminSecret: string
  ): Promise<{ xdrUnsigned: string; operationHash: string }> {
    const { createHash } = await import("crypto");
    const signer = Keypair.fromSecret(adminSecret);
    const account = await this.horizonServer.loadAccount(signer.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: "100000",
      networkPassphrase: this.networkPassphrase,
    });

    // Build operation based on type
    if (operation === "withdraw") {
      // The escrow contract has no withdraw entrypoint. The previous classic self-payment
      // never touched escrowed funds and used the public network's USDC issuer on every
      // network. Fail closed until the contract gains a real withdraw entrypoint.
      throw new Error("withdraw is not supported: the escrow contract has no withdraw entrypoint");
    } else if (operation === "close_escrow") {
      // Close (finalize) the Soroban escrow contract instance.
      //
      // The escrow lives in a Soroban contract, not a dedicated classic account,
      // so a classic `accountMerge` is the wrong primitive: merging the admin
      // signer's account into itself is rejected on-chain (ACCOUNT_MERGE_MALFORMED)
      // and would never touch the contract anyway. The contract's only
      // finalization entrypoint is `refund`, which returns the remaining balance
      // to the recorded depositor and marks the escrow as settled/closed.
      // `Contract.call` already yields a complete invokeHostFunction operation.
      tx.addOperation(this.contract.call("refund"));
    } else if (operation === "distribute") {
      // Distribute to multiple recipients (via Soroban call)
      const { recipients } = operationData as {
        recipients: Array<{ address: string; amount: bigint }>;
      };

      const recipientScVals = recipients.map((r) =>
        nativeToScVal([new Address(r.address).toScVal(), Number(r.amount)], { type: "vec" })
      );

      tx.addOperation(
        Operation.invokeHostFunction({
          func: this.contract.call("settle", nativeToScVal(recipientScVals, { type: "vec" })),
          auth: [],
        })
      );
    } else {
      throw new Error(`Unsupported admin operation: ${String(operation)}`);
    }

    const built = tx.setTimeout(300).build();

    // DO NOT SIGN YET - this is for external co-signers
    const xdrUnsigned = built.toEnvelope().toXDR("base64");

    // Hash for signing attestation
    const hash = createHash("sha256").update(xdrUnsigned, "utf-8").digest("hex");

    return { xdrUnsigned, operationHash: hash };
  }
}

export default EscrowClient;
