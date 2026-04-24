import { describe, it, expect } from "vitest";
import { STELLAR_NETWORKS, DEPOSIT_POLL_INTERVAL_MS } from "./constants";

describe("constants", () => {
  it("should have correct testnet values", () => {
    expect(STELLAR_NETWORKS.testnet.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(STELLAR_NETWORKS.testnet.networkPassphrase).toBe("Test SDF Network ; September 2015");
  });

  it("should have correct public values", () => {
    expect(STELLAR_NETWORKS.public.rpcUrl).toBe("https://mainnet.stellar.validationcloud.io/v1/rpc");
    expect(STELLAR_NETWORKS.public.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
  });

  it("should have correct deposit poll interval", () => {
    expect(DEPOSIT_POLL_INTERVAL_MS).toBe(5000);
  });
});
