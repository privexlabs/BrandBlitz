import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brand } from "./brands";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../index", () => ({
  query: mocks.query,
}));

import { getActiveDistractorBrands } from "./brands";

function buildBrand(index: number): Brand {
  return {
    id: `brand-${index}`,
    owner_user_id: `owner-${index}`,
    name: `Brand ${index}`,
    logo_url: null,
    primary_color: null,
    secondary_color: null,
    tagline: `Tagline ${index}`,
    brand_story: `Story ${index}`,
    usp: `USP ${index}`,
    product_image_1_url: null,
    product_image_2_url: null,
    created_at: "2026-04-24T00:00:00.000Z",
  };
}

describe("getActiveDistractorBrands", () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it("returns empty array when no distractor brands are available", async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    const result = await getActiveDistractorBrands(
      "11111111-1111-4111-8111-111111111111"
    );

    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("LIMIT 20"),
      ["11111111-1111-4111-8111-111111111111"]
    );
    expect(result).toEqual([]);
  });

  it("returns all brands when the pool has only three entries", async () => {
    const brands = [buildBrand(1), buildBrand(2), buildBrand(3)];
    mocks.query.mockResolvedValue({ rows: brands });

    const result = await getActiveDistractorBrands(
      "22222222-2222-4222-8222-222222222222"
    );

    expect(result).toHaveLength(3);
    expect(result.map((brand) => brand.id)).toEqual(["brand-1", "brand-2", "brand-3"]);
  });

  it("caps the returned pool at 20 brands when more are available", async () => {
    const fiftyBrands = Array.from({ length: 50 }, (_, i) => buildBrand(i + 1));
    mocks.query.mockResolvedValue({ rows: fiftyBrands });

    const result = await getActiveDistractorBrands(
      "33333333-3333-4333-8333-333333333333"
    );

    expect(result).toHaveLength(20);
    expect(result[0]?.id).toBe("brand-1");
    expect(result[19]?.id).toBe("brand-20");
  });
});
