import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("../index", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

import { getPublicConfig, PUBLIC_CONFIG_KEYS } from "./config";

describe("getPublicConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only queries app_config for the whitelisted keys", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await getPublicConfig();

    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [PUBLIC_CONFIG_KEYS]);
  });

  it("flattens whitelisted rows into a flat key/value object", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: "game_round_duration_seconds", value: 30 },
        { key: "maintenance_mode", value: true },
      ],
    });

    const result = await getPublicConfig();

    expect(result).toEqual({
      game_round_duration_seconds: 30,
      maintenance_mode: true,
    });
  });

  it("returns an empty object when no whitelisted keys exist in app_config", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await getPublicConfig();

    expect(result).toEqual({});
  });
});
