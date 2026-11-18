import { describe, expect, it } from "vitest";
import * as stellar from "@brandblitz/stellar";
import { EscrowClient, type EscrowConfig, type EscrowRecipient } from "@brandblitz/stellar";
import { EscrowClient as DeepEscrowClient } from "./escrow";

describe("@brandblitz/stellar package root", () => {
  it("exports EscrowClient from the package root", () => {
    expect(typeof stellar.EscrowClient).toBe("function");
    expect(EscrowClient).toBe(DeepEscrowClient);
  });

  it("exports the EscrowConfig and EscrowRecipient types from the package root", () => {
    const config: EscrowConfig = {
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      horizonUrl: "https://horizon-testnet.stellar.org",
      sorobanUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    };
    const recipient: EscrowRecipient = {
      address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      amountStroops: 1n,
    };

    expect(new EscrowClient(config)).toBeInstanceOf(DeepEscrowClient);
    expect(recipient.amountStroops).toBe(1n);
  });

  it("still exposes the other modules (no circular-export breakage)", () => {
    expect(typeof stellar.stroopsToUsdc).toBe("function");
    expect(typeof stellar.usdcToStroops).toBe("function");
  });
});
