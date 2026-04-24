import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    verify: {
      v2: {
        services: vi.fn(() => ({
          verifications: { create: vi.fn() },
          verificationChecks: { create: vi.fn() },
        })),
      },
    },
  })),
}));

import { hashPhoneNumber } from "./phone";

describe("phone hashing", () => {
  beforeEach(() => {
    process.env.PHONE_HASH_SALT = "unit-test-phone-salt";
  });

  it("hashes the same phone number deterministically", () => {
    const hashA = hashPhoneNumber("+1 (555) 123-4567");
    const hashB = hashPhoneNumber("+15551234567");

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });
});
