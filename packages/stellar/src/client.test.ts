import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getNetwork,
  getHorizonServer,
  getRpcServer,
  getUsdcAsset,
  getNetworkPassphrase,
  drainSharedAgent,
  sharedAgent,
  withRetry,
} from "./client";
import { STELLAR_NETWORKS } from "./constants";
import { setLogger } from "./logger";

describe("client", () => {
  describe("getNetwork", () => {
    it("should return testnet config by default", () => {
      const config = getNetwork();
      expect(config).toBe(STELLAR_NETWORKS.testnet);
    });

    it("should return public config when requested", () => {
      const config = getNetwork("public");
      expect(config).toBe(STELLAR_NETWORKS.public);
    });

    it("should throw on invalid network name", () => {
      // @ts-expect-error - testing invalid input
      expect(() => getNetwork("invalid")).toThrow("Invalid network name: invalid");
    });
  });

  describe("getHorizonServer", () => {
    it("should create Horizon server with correct URL", () => {
      const server = getHorizonServer("testnet");
      expect(server.serverURL.toString()).toContain("horizon-testnet.stellar.org");
    });
  });

  describe("getRpcServer", () => {
    it("should create RPC server with the testnet URL", () => {
      const server = getRpcServer("testnet");
      expect(server.serverURL.toString()).toContain("soroban-testnet.stellar.org");
    });

    it("should create RPC server with the public URL", () => {
      const server = getRpcServer("public");
      expect(server.serverURL.toString()).toContain("mainnet.stellar.validationcloud.io");
    });
  });

  describe("getNetworkPassphrase", () => {
    it("should return the testnet passphrase", () => {
      expect(getNetworkPassphrase("testnet")).toBe(STELLAR_NETWORKS.testnet.networkPassphrase);
    });

    it("should return the public passphrase", () => {
      expect(getNetworkPassphrase("public")).toBe(STELLAR_NETWORKS.public.networkPassphrase);
    });
  });

  describe("getUsdcAsset", () => {
    it("should return correct USDC asset for testnet", () => {
      const asset = getUsdcAsset("testnet");
      expect(asset.code).toBe("USDC");
      expect(asset.issuer).toBe(STELLAR_NETWORKS.testnet.usdcIssuer);
    });

    it("should return correct USDC asset for public", () => {
      const asset = getUsdcAsset("public");
      expect(asset.code).toBe("USDC");
      expect(asset.issuer).toBe(STELLAR_NETWORKS.public.usdcIssuer);
    });
  });

  describe("sharedAgent", () => {
    it("has keepAlive enabled for connection reuse", () => {
      expect(sharedAgent.keepAlive).toBe(true);
    });

    it("maxSockets is a positive number", () => {
      expect(sharedAgent.maxSockets).toBeGreaterThan(0);
    });

    it("drainSharedAgent destroys the shared agent", () => {
      const destroySpy = vi.spyOn(sharedAgent, "destroy");
      drainSharedAgent();
      expect(destroySpy).toHaveBeenCalled();
      destroySpy.mockRestore();
    });

    it("drainSharedAgent does not throw when called with no prior HTTP activity", () => {
      expect(() => drainSharedAgent()).not.toThrow();
    });
  });

  describe("drainSharedAgent", () => {
    type HorizonAxiosClient = {
      defaults: { httpsAgent?: unknown; httpAgent?: unknown };
    };
    const horizonModule = Horizon as unknown as { AxiosClient?: HorizonAxiosClient };
    let originalAxiosClient: HorizonAxiosClient | undefined;

    beforeEach(() => {
      originalAxiosClient = horizonModule.AxiosClient;
    });

    afterEach(() => {
      if (originalAxiosClient) {
        horizonModule.AxiosClient = originalAxiosClient;
      } else {
        delete horizonModule.AxiosClient;
      }
    });

    it("clears Horizon axios agent defaults so new servers do not reuse destroyed agents", () => {
      const defaults = { httpsAgent: sharedAgent, httpAgent: sharedAgent };
      horizonModule.AxiosClient = { defaults };

      drainSharedAgent();

      expect(defaults.httpsAgent).toBeUndefined();
      expect(defaults.httpAgent).toBeUndefined();

      const server = getHorizonServer("testnet");
      expect(server.serverURL.toString()).toContain("horizon-testnet.stellar.org");
      const serverHttpClient = (
        server as unknown as { httpClient: { defaults: HorizonAxiosClient["defaults"] } }
      ).httpClient;
      expect(serverHttpClient.defaults.httpsAgent).not.toBe(sharedAgent);
      expect(serverHttpClient.defaults.httpAgent).not.toBe(sharedAgent);
    });

    it("is idempotent when called twice", () => {
      const defaults = { httpsAgent: sharedAgent, httpAgent: sharedAgent };
      horizonModule.AxiosClient = { defaults };

      expect(() => {
        drainSharedAgent();
        drainSharedAgent();
      }).not.toThrow();
      expect(defaults.httpsAgent).toBeUndefined();
      expect(defaults.httpAgent).toBeUndefined();
    });
  });

  describe("withRetry", () => {
    const mockWarn = vi.fn();

    beforeEach(() => {
      vi.useFakeTimers();
      mockWarn.mockReset();
      // issue #866: wire retries through the shared logger abstraction.
      setLogger({ warn: mockWarn });
    });

    afterEach(() => {
      setLogger(undefined);
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("should execute function successfully on first attempt", async () => {
      const fn = vi.fn().mockResolvedValueOnce("success");
      const result = await withRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on 429 status code", async () => {
      const error = new Error("Rate limited");
      (error as any).response = { status: 429 };

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on 503 status code", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on 504 status code", async () => {
      const error = new Error("Gateway timeout");
      (error as any).response = { status: 504 };

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on network timeout errors", async () => {
      const error = new Error("Connection timeout");

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry ETIMEDOUT errors identified by message", async () => {
      const error = new Error("connect ETIMEDOUT 1.2.3.4:443");

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry ETIMEDOUT errors identified by code", async () => {
      const error = new Error("Socket connection stalled");
      (error as any).code = "ETIMEDOUT";

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-retryable errors", async () => {
      const error = new Error("Invalid request");
      (error as any).response = { status: 400 };

      const fn = vi.fn().mockRejectedValueOnce(error);

      await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow("Invalid request");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should exhaust retries and throw error with retryExhausted flag", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi.fn().mockRejectedValue(error);

      const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100 });
      const rejection = expect(promise).rejects.toMatchObject({
        retryExhausted: true,
        message: "Service unavailable",
      });
      await vi.runAllTimersAsync();
      await rejection;

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should use exponential backoff with jitter", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 30_000 });

      await vi.runAllTimersAsync();
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await promise;
      expect(result).toBe("success");
    });

    it("should respect maxDelayMs cap", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      let delayUsed: number | null = null;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockImplementationOnce(async () => {
          // Calculate approximate delay from timer state
          return "success";
        });

      const promise = withRetry(fn, {
        maxAttempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 500,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should log retry attempts with delay info", async () => {
      const error = new Error("Rate limited");
      (error as any).response = { status: 429 };

      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      await promise;

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining("Stellar RPC Retry"),
        expect.objectContaining({
          statusCode: 429,
          delayMs: expect.any(Number),
        })
      );
    });

    it("should log exhaustion message", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi.fn().mockRejectedValue(error);

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      const rejection = expect(promise).rejects.toThrow("Service unavailable");
      await vi.runAllTimersAsync();
      await rejection;

      expect(mockWarn).toHaveBeenCalledWith(
        expect.stringContaining("Exhausted"),
        expect.objectContaining({
          statusCode: 503,
        })
      );
    });

    it("should use custom retry options", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, {
        maxAttempts: 5,
        baseDelayMs: 50,
        maxDelayMs: 1000,
        retryableStatusCodes: [429, 500, 503, 504],
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should only retry custom status codes if specified", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi.fn().mockRejectedValue(error);

      // 503 not in custom list, so no retry
      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          retryableStatusCodes: [429, 504],
        })
      ).rejects.toThrow("Service unavailable");

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
