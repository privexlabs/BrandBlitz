import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../index", () => ({
  query: mocks.query,
}));

import { getPublicConfig, PUBLIC_CONFIG_KEYS } from "./config";

describe("config queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads only whitelisted public config keys", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        { key: "game_round_duration_seconds", value: 30 },
        { key: "max_rounds_per_session", value: 3 },
        { key: "maintenance_mode", value: true },
      ],
    });

    const config = await getPublicConfig();

    expect(mocks.query).toHaveBeenCalledWith(
      "SELECT key, value FROM app_config WHERE key = ANY($1::text[])",
      [PUBLIC_CONFIG_KEYS]
    );
    expect(config).toEqual({
      game_round_duration_seconds: 30,
      max_rounds_per_session: 3,
      maintenance_mode: true,
    });
    expect(config).not.toHaveProperty("webhook_secret_current");
  });

  it("returns an empty object when no public keys are configured", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(getPublicConfig()).resolves.toEqual({});
  });
});
