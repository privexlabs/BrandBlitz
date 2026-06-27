import { describe, it, expect } from "vitest";
import { generateChallengeQuestions } from "./questions";
import type { Brand } from "../db/queries/brands";

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: "brand-1",
    owner_user_id: "user-1",
    name: "BrandX",
    tagline: "Best product ever",
    usp: "Fast and reliable",
    brand_story: null,
    logo_url: null,
    primary_color: null,
    secondary_color: null,
    product_image_keys: ["img1.png"],
    question_template: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

const distractorPool = Array.from({ length: 10 }, (_, i) => ({
  name: `Distractor${i}`,
  tagline: `Tagline ${i}`,
  usp: `USP ${i}`,
}));

describe("generateChallengeQuestions", () => {
  it("generates exactly 3 questions when full brand data is provided", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), distractorPool);
    expect(result).toHaveLength(3);
  });

  it("assigns rounds 1, 2, and 3", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), distractorPool);
    const rounds = result.map((q) => q.round).sort();
    expect(rounds).toEqual([1, 2, 3]);
  });

  it("uses defaults when question_template is null", () => {
    const brand = makeBrand({ question_template: null });
    const result = generateChallengeQuestions("challenge-1", brand, distractorPool);

    const r1 = result.find((q) => q.round === 1)!;
    expect(r1.question_text).toBe("Which tagline belongs to this brand?");
    expect(r1.prompt_type).toBe("logo");

    const r2 = result.find((q) => q.round === 2)!;
    expect(r2.question_text).toContain("Fast and reliable");
    expect(r2.prompt_type).toBe("tagline");

    const r3 = result.find((q) => q.round === 3)!;
    expect(r3.question_text).toBe("Which brand makes this product?");
    expect(r3.prompt_type).toBe("productImage1");
  });

  it("overrides question_text per round from question_template", () => {
    const brand = makeBrand({
      question_template: {
        round_1: { question_text: "Custom round 1 text" },
        round_2: { question_text: "Custom round 2 text" },
      },
    });
    const result = generateChallengeQuestions("challenge-1", brand, distractorPool);

    expect(result.find((q) => q.round === 1)!.question_text).toBe("Custom round 1 text");
    expect(result.find((q) => q.round === 2)!.question_text).toBe("Custom round 2 text");
    // round 3 not overridden — uses default
    expect(result.find((q) => q.round === 3)!.question_text).toBe("Which brand makes this product?");
  });

  it("overrides prompt_type per round from question_template", () => {
    const brand = makeBrand({
      question_template: {
        round_1: { prompt_type: "tagline" },
      },
    });
    const result = generateChallengeQuestions("challenge-1", brand, distractorPool);
    expect(result.find((q) => q.round === 1)!.prompt_type).toBe("tagline");
    // rounds without override keep their defaults
    expect(result.find((q) => q.round === 2)!.prompt_type).toBe("tagline");
    expect(result.find((q) => q.round === 3)!.prompt_type).toBe("productImage1");
  });

  it("falls back to generic questions when brand data is sparse", () => {
    const brand = makeBrand({ tagline: null, usp: null, product_image_keys: [] });
    const result = generateChallengeQuestions("challenge-1", brand, distractorPool);
    expect(result).toHaveLength(3);
    result.forEach((q) => {
      expect(q.question_text).toBe("What is the name of this brand?");
    });
  });

  it("uses fallback Option A/B/C when distractor pool is empty", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), []);
    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      const fallbacks = options.filter((o) => o?.startsWith("Option"));
      expect(fallbacks.length).toBeGreaterThan(0);
    });
  });

  it("sets correct_option to the letter matching correct_answer position", () => {
    const brand = makeBrand();
    const result = generateChallengeQuestions("challenge-1", brand, distractorPool);
    result.forEach((q) => {
      const opts: Record<string, string | undefined> = {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      };
      expect(opts[q.correct_option]).toBe(q.correct_answer);
    });
  });

  it("does not include the correct answer as a distractor", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), distractorPool);
    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      const occurrences = options.filter((o) => o === q.correct_answer);
      expect(occurrences).toHaveLength(1);
    });
  });

  it("sets challenge_id on all questions", () => {
    const result = generateChallengeQuestions("chal-xyz", makeBrand(), distractorPool);
    result.forEach((q) => {
      expect(q.challenge_id).toBe("chal-xyz");
    });
  });
});
