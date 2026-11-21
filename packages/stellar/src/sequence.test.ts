import { describe, expect, it, vi } from "vitest";
import { reserveSequence, resetSequence, type SequenceStore } from "./sequence";

class InMemorySequenceStore implements SequenceStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, next.toString());
    return next;
  }

  async setIfAbsent(key: string, value: string): Promise<boolean> {
    if (this.values.has(key)) {
      return false;
    }

    this.values.set(key, value);
    return true;
  }
}

class InMemorySequenceStoreWithoutSetIfAbsent implements SequenceStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.values.delete(key);
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, next.toString());
    return next;
  }
}

describe("sequence reservation", () => {
  it("reserves 200 monotonic sequences concurrently", async () => {
    const store = new InMemorySequenceStore();
    const loadBaseSequence = vi.fn(async () => "1000");

    const reservations = await Promise.all(
      Array.from({ length: 200 }, () =>
        reserveSequence({
          store,
          keyPrefix: "stellar:seq:test",
          loadBaseSequence,
        })
      )
    );

    expect(loadBaseSequence).toHaveBeenCalledTimes(1);
    expect(new Set(reservations.map((reservation) => reservation.transactionSequence)).size).toBe(
      200
    );
    expect(reservations[0]?.baseSequence).toBe("1000");

    const sorted = reservations
      .map((reservation) => BigInt(reservation.transactionSequence))
      .sort((a, b) => Number(a - b));

    expect(sorted[0]).toBe(1001n);
    expect(sorted[199]).toBe(1200n);
  });

  it("resets the offset counter after a bad sequence event", async () => {
    const store = new InMemorySequenceStore();
    const onReset = vi.fn();

    await reserveSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "2000",
    });
    await reserveSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "2000",
    });

    await resetSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "3000",
      reason: "tx_bad_seq",
      onReset,
    });

    const nextReservation = await reserveSequence({
      store,
      keyPrefix: "stellar:seq:test",
      loadBaseSequence: async () => "3000",
    });

    expect(nextReservation.transactionSequence).toBe("3001");
    expect(onReset).toHaveBeenCalledWith({
      keyPrefix: "stellar:seq:test",
      reason: "tx_bad_seq",
      baseSequence: "3000",
    });
  });
});

describe("sequence reservation without setIfAbsent (#858)", () => {
  it("reserves 50 monotonic sequences concurrently using fallback set path", async () => {
    const store = new InMemorySequenceStoreWithoutSetIfAbsent();
    const loadBaseSequence = vi.fn(async () => "4000");

    const reservations = await Promise.all(
      Array.from({ length: 50 }, () =>
        reserveSequence({
          store,
          keyPrefix: "stellar:seq:no-cas",
          loadBaseSequence,
        })
      )
    );

    expect(loadBaseSequence).toHaveBeenCalledTimes(1);
    expect(new Set(reservations.map((r) => r.transactionSequence)).size).toBe(50);
    const sorted = reservations
      .map((r) => BigInt(r.transactionSequence))
      .sort((a, b) => Number(a - b));
    expect(sorted[0]).toBe(4001n);
    expect(sorted[49]).toBe(4050n);
  });

  it("resets offset counter cleanly without setIfAbsent", async () => {
    const store = new InMemorySequenceStoreWithoutSetIfAbsent();
    await reserveSequence({
      store,
      keyPrefix: "stellar:seq:no-cas-reset",
      loadBaseSequence: async () => "5000",
    });

    await resetSequence({
      store,
      keyPrefix: "stellar:seq:no-cas-reset",
      loadBaseSequence: async () => "6000",
      reason: "tx_bad_seq",
    });

    const next = await reserveSequence({
      store,
      keyPrefix: "stellar:seq:no-cas-reset",
      loadBaseSequence: async () => "6000",
    });
    expect(next.transactionSequence).toBe("6001");
  });

  it("handles reset during an in-flight base sequence load without stale overwrite", async () => {
    const store = new InMemorySequenceStoreWithoutSetIfAbsent();
    let resolveInFlight!: (val: string) => void;
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const slowLoad = new Promise<string>((resolve) => {
      resolveInFlight = resolve;
    });

    const firstReservationPromise = reserveSequence({
      store,
      keyPrefix: "stellar:seq:inflight-reset",
      loadBaseSequence: () => {
        markLoadStarted();
        return slowLoad;
      },
    });

    // Wait until firstReservation is actually inside loadBaseSequence
    await loadStarted;

    await resetSequence({
      store,
      keyPrefix: "stellar:seq:inflight-reset",
      loadBaseSequence: async () => "9000",
      reason: "tx_bad_seq",
    });

    resolveInFlight("7000");
    await expect(firstReservationPromise).rejects.toThrow(/Sequence reservation race detected/);

    const afterReset = await reserveSequence({
      store,
      keyPrefix: "stellar:seq:inflight-reset",
      loadBaseSequence: async () => "9000",
    });
    expect(afterReset.baseSequence).toBe("9000");
  });

  it("converges on a single base sequence when two independent loaders race with setIfAbsent vs documents divergence without it", async () => {
    const atomicStore = new InMemorySequenceStore();
    const [r1, r2] = await Promise.all([
      reserveSequence({
        store: atomicStore,
        keyPrefix: "stellar:seq:atomic-race",
        loadBaseSequence: async () => "100",
      }),
      reserveSequence({
        store: atomicStore,
        keyPrefix: "stellar:seq:atomic-race",
        loadBaseSequence: async () => "200",
      }),
    ]);
    expect(r1.baseSequence).toBe(r2.baseSequence);

    // Without setIfAbsent, independent keyPrefixes / uncoordinated stores can diverge if loaders differ
    const nonAtomicStoreA = new InMemorySequenceStoreWithoutSetIfAbsent();
    const nonAtomicStoreB = new InMemorySequenceStoreWithoutSetIfAbsent();
    const [divA, divB] = await Promise.all([
      reserveSequence({
        store: nonAtomicStoreA,
        keyPrefix: "stellar:seq:div-a",
        loadBaseSequence: async () => "100",
      }),
      reserveSequence({
        store: nonAtomicStoreB,
        keyPrefix: "stellar:seq:div-b",
        loadBaseSequence: async () => "200",
      }),
    ]);
    expect(divA.baseSequence).toBe("100");
    expect(divB.baseSequence).toBe("200");
  });
});
