import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchDepositEvents } from "./deposit";
import * as client from "./client";

vi.mock("./client", () => ({
  getRpcServer: vi.fn(),
  getUsdcAsset: vi.fn(),
  getNetworkConfig: vi.fn(),
}));

describe("fetchDepositEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the correct passphrase from networkConfig for testnet", async () => {
    const mockRpc = {
      getEvents: vi.fn().mockResolvedValue({ events: [], latestLedger: 100 }),
    };
    const mockAsset = {
      contractId: vi.fn().mockReturnValue("mock-contract-id"),
    };
    
    vi.mocked(client.getRpcServer).mockReturnValue(mockRpc as any);
    vi.mocked(client.getUsdcAsset).mockReturnValue(mockAsset as any);
    vi.mocked(client.getNetworkConfig).mockReturnValue({
      networkPassphrase: "Test SDF Network ; September 2015",
    } as any);

    await fetchDepositEvents("hot-wallet", 1, "testnet");

    expect(client.getNetworkConfig).toHaveBeenCalledWith("testnet");
    expect(mockAsset.contractId).toHaveBeenCalledWith("Test SDF Network ; September 2015");
  });

  it("uses the correct passphrase from networkConfig for public", async () => {
    const mockRpc = {
      getEvents: vi.fn().mockResolvedValue({ events: [], latestLedger: 100 }),
    };
    const mockAsset = {
      contractId: vi.fn().mockReturnValue("mock-contract-id"),
    };
    
    vi.mocked(client.getRpcServer).mockReturnValue(mockRpc as any);
    vi.mocked(client.getUsdcAsset).mockReturnValue(mockAsset as any);
    vi.mocked(client.getNetworkConfig).mockReturnValue({
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    } as any);

    await fetchDepositEvents("hot-wallet", 1, "public");

    expect(client.getNetworkConfig).toHaveBeenCalledWith("public");
    expect(mockAsset.contractId).toHaveBeenCalledWith("Public Global Stellar Network ; September 2015");
  });
});
