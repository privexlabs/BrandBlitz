/**
 * Store interface for sequence management.
 *
 * IMPORTANT: For multi-instance deployments, setIfAbsent MUST be implemented
 * to ensure atomic base sequence writes. Without it, concurrent instances may
 * diverge on base sequence values, corrupting the sequence reservation system.
 */
export interface SequenceStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  /**
   * Atomically set a key only if it doesn't exist.
   * Required for correctness in multi-instance deployments.
   */
  setIfAbsent?(key: string, value: string): Promise<boolean>;
}

export interface SequenceReservation {
  keyPrefix: string;
  baseSequence: string;
  offset: number;
  accountSequence: string;
  transactionSequence: string;
}

export interface SequenceResetInfo {
  keyPrefix: string;
  reason: string;
  baseSequence: string;
}

interface SequenceKeys {
  baseKey: string;
  offsetKey: string;
  generationKey: string;
}

interface SequenceOptions {
  store: SequenceStore;
  keyPrefix: string;
  loadBaseSequence: () => Promise<string>;
}

interface ResetSequenceOptions extends SequenceOptions {
  reason: string;
  onReset?: (info: SequenceResetInfo) => void | Promise<void>;
}

const pendingBaseLoads = new Map<string, { promise: Promise<string>; generation: number }>();
let globalGeneration = 0;

function getSequenceKeys(keyPrefix: string): SequenceKeys {
  return {
    baseKey: `${keyPrefix}:base`,
    offsetKey: `${keyPrefix}:offset`,
    generationKey: `${keyPrefix}:generation`,
  };
}

/**
 * Ensures a base sequence is loaded and stored.
 * Uses generation tracking to prevent stale loads from overwriting fresh resets.
 *
 * @param options - Store, key prefix, and base sequence loader
 * @returns The current base sequence for this keyPrefix
 */
async function ensureBaseSequence({
  store,
  keyPrefix,
  loadBaseSequence,
}: SequenceOptions): Promise<string> {
  const { baseKey } = getSequenceKeys(keyPrefix);
  const existing = await store.get(baseKey);
  if (existing) {
    return existing;
  }

  const pending = pendingBaseLoads.get(baseKey);
  if (pending) {
    return pending.promise;
  }

  const currentGeneration = globalGeneration;

  const nextLoad = (async () => {
    const loaded = await loadBaseSequence();

    // Validate this load is still current (not superseded by a reset)
    if (globalGeneration !== currentGeneration) {
      // A reset occurred while we were loading; discard this stale result
      const fresh = await store.get(baseKey);
      if (fresh) return fresh;
      throw new Error(
        `Sequence reservation race detected: reset occurred during base load for ${keyPrefix}. Retry required.`
      );
    }

    if (store.setIfAbsent) {
      const stored = await store.setIfAbsent(baseKey, loaded);
      if (stored) {
        return loaded;
      }

      return (await store.get(baseKey)) ?? loaded;
    }

    // Without setIfAbsent, we can't guarantee atomicity across instances.
    // This fallback is only safe in single-instance deployments.
    await store.set(baseKey, loaded);
    return loaded;
  })().finally(() => {
    const current = pendingBaseLoads.get(baseKey);
    if (current?.generation === currentGeneration) {
      pendingBaseLoads.delete(baseKey);
    }
  });

  pendingBaseLoads.set(baseKey, { promise: nextLoad, generation: currentGeneration });
  return nextLoad;
}

export function buildSequenceKeyPrefix(network: string, publicKey: string): string {
  return `stellar:seq:${network}:${publicKey}`;
}

/**
 * Reserves a unique sequence number for a Stellar transaction.
 *
 * Atomicity guarantee: baseSequence and offset are fetched in relation to the same
 * generation. If a reset occurs between the two fetches, the generation check will
 * detect it and the caller should retry.
 *
 * @param options - Store, key prefix, and base sequence loader
 * @returns Reservation details including the account sequence to use
 */
export async function reserveSequence(options: SequenceOptions): Promise<SequenceReservation> {
  const { store, keyPrefix } = options;
  const { offsetKey, generationKey } = getSequenceKeys(keyPrefix);

  // Capture generation before fetching base
  const generationBefore = await store.get(generationKey);

  const baseSequence = await ensureBaseSequence(options);
  const offset = await store.incr(offsetKey);

  // Verify generation hasn't changed (indicating a reset occurred)
  const generationAfter = await store.get(generationKey);

  if (generationBefore !== generationAfter) {
    // A reset occurred between base fetch and offset increment
    // The offset we got is from the new generation, but our base is stale
    throw new Error(
      `Sequence reservation race detected: reset occurred during reservation for ${keyPrefix}. Retry required.`
    );
  }

  const accountSequence = (BigInt(baseSequence) + BigInt(offset - 1)).toString();

  return {
    keyPrefix,
    baseSequence,
    offset,
    accountSequence,
    transactionSequence: (BigInt(accountSequence) + 1n).toString(),
  };
}

/**
 * Resets the sequence state by loading a fresh base sequence from the network.
 * Increments the generation counter to invalidate any in-flight loads.
 *
 * @param options - Store, key prefix, base sequence loader, reason, and optional reset callback
 * @returns The newly loaded base sequence
 */
export async function resetSequence(options: ResetSequenceOptions): Promise<string> {
  const { store, keyPrefix, loadBaseSequence, reason, onReset } = options;
  const { baseKey, offsetKey, generationKey } = getSequenceKeys(keyPrefix);

  // Increment generation to invalidate in-flight operations
  globalGeneration++;
  await store.set(generationKey, globalGeneration.toString());

  pendingBaseLoads.delete(baseKey);

  const baseSequence = await loadBaseSequence();
  await store.set(baseKey, baseSequence);
  await store.del(offsetKey);

  if (onReset) {
    await onReset({ keyPrefix, reason, baseSequence });
  }

  return baseSequence;
}
