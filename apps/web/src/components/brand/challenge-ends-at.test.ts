import { describe, expect, it } from "vitest";
import { challengeEndsAt } from "./challenge-validation";

describe("challengeEndsAt", () => {
  const now = Date.parse("2026-06-23T12:00:00.000Z");

  it("returns a future end time for a valid duration", () => {
    expect(challengeEndsAt("1", now)).toBe("2026-06-23T13:00:00.000Z");
  });

  it.each(["0", "-1", "0.5", "721", "not-a-number"])(
    "rejects invalid duration %s",
    (duration) => {
      expect(challengeEndsAt(duration, now)).toBeNull();
    }
  );
});
