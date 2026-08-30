import { describe, expect, it } from "vitest";
import { calculatePayoutShareStroops, stroopsToUsdc, usdcToStroops } from "./usdc";

describe("USDC stroop helpers", () => {
  describe("usdcToStroops", () => {
    it("converts standard USDC strings to integer stroops", () => {
      expect(usdcToStroops("12.3456789")).toBe("123456789");
      expect(usdcToStroops("1")).toBe("10000000");
      expect(usdcToStroops("0")).toBe("0");
      expect(usdcToStroops("0.1")).toBe("1000000");
      expect(usdcToStroops("0.0000001")).toBe("1");
      expect(usdcToStroops("100.0")).toBe("1000000000");
    });

    it("handles extremely large USDC amounts (no overflow)", () => {
      expect(usdcToStroops("999999999999999999.9999999")).toBe("9999999999999999999999999");
    });

    it("throws error for invalid format, negative, or more than 7 decimal places", () => {
      expect(() => usdcToStroops("-1")).toThrow();
      expect(() => usdcToStroops("1.23456789")).toThrow(); // 8 places
      expect(() => usdcToStroops("abc")).toThrow();
      expect(() => usdcToStroops("1.2.3")).toThrow();
      expect(() => usdcToStroops(" 1.0 ")).toThrow();
      expect(usdcToStroops("1.")).toBe("10000000");
    });
  });

  describe("stroopsToUsdc", () => {
    it("formats integer stroops (bigint, number, string) as 7-decimal USDC", () => {
      expect(stroopsToUsdc(123456789n)).toBe("12.3456789");
      expect(stroopsToUsdc("1")).toBe("0.0000001");
      expect(stroopsToUsdc(0)).toBe("0.0000000");
      expect(stroopsToUsdc(10000000n)).toBe("1.0000000");
    });

    it("handles extremely large stroop amounts (no overflow)", () => {
      expect(stroopsToUsdc("9999999999999999999999999")).toBe("999999999999999999.9999999");
    });
  });

  describe("calculatePayoutShareStroops", () => {
    it("calculates correct payout shares using integer math and truncates down", () => {
      expect(calculatePayoutShareStroops(1, 3, 100000000n)).toBe(33333333n);
      expect(calculatePayoutShareStroops(1, 2, 100n)).toBe(50n);
      expect(calculatePayoutShareStroops(0, 5, 100n)).toBe(0n);
      expect(calculatePayoutShareStroops(5, 5, 100n)).toBe(100n);
    });

    it("returns 0n if total points is 0", () => {
      expect(calculatePayoutShareStroops(1, 0, 1000n)).toBe(0n);
    });

    it("handles large amounts and scores without overflow", () => {
      const pool = 9999999999999999n;
      const score = 123456789;
      const total = 987654321;
      const expected = (BigInt(pool) * BigInt(score)) / BigInt(total);
      expect(calculatePayoutShareStroops(score, total, pool)).toBe(expected);
    });
  });
});

