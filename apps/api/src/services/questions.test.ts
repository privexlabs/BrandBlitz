import { describe, expect, it } from "vitest";
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
    product_image_keys: ["img1.png", "img2.png"],
    question_template: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

const distractorPool = Array.from({ length: 20 }).map((_, i) => ({
  name: `Brand${i}`,
  tagline: `Tagline ${i}`,
  usp: `USP ${i}`,
}));

describe("Questions Generation Engine", () => {
  // -------------------------
  // BASIC GENERATION
  // -------------------------
  it("generates exactly 3 questions when full brand data is provided", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), distractorPool);

    expect(result.length).toBe(3);

    const types = result.map((q) => q.question_type);
    expect(types).toContain("which_tagline");
    expect(types).toContain("which_brand");
    expect(types).toContain("which_product");
  });

  it("assigns rounds 1, 2, and 3", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), distractorPool);
    const rounds = result.map((q) => q.round).sort();
    expect(rounds).toEqual([1, 2, 3]);
  });

  // -------------------------
  // FALLBACK TAGLINE
  // -------------------------
  it("falls back to brand name when tagline is missing", () => {
    const result = generateChallengeQuestions(
      "challenge-1",
      makeBrand({ tagline: null }),
      distractorPool
    );

    const fallbackQ = result.find((q) => q.question_text === "What is the name of this brand?");

    expect(fallbackQ?.correct_answer).toBe("BrandX");
  });

  // -------------------------
  // DISTRACTOR LOGIC
  // -------------------------
  it("uses distractors from pool without duplicates or correct answer", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), distractorPool);

    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];

      // correct answer not duplicated in distractors
      const occurrences = options.filter((o) => o === q.correct_answer);
      expect(occurrences.length).toBe(1);
    });
  });

  it("deduplicates and ignores blank distractors before padding options", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), [
      { name: "BrandX", tagline: "Best product ever", usp: "Fast and reliable" },
      { name: "BrandY", tagline: "Tagline Y", usp: "USP Y" },
      { name: "BrandY", tagline: "Tagline Y", usp: "USP Y" },
      { name: "   ", tagline: "   ", usp: "   " },
    ]);

    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      expect(options.every((option) => option.trim().length > 0)).toBe(true);
      expect(new Set(options).size).toBe(4);
      expect(options.filter((option) => option === q.correct_answer)).toHaveLength(1);
    });
  });

  // -------------------------
  // EMPTY POOL HANDLING
  // -------------------------
  it("falls back to Option A/B/C when distractor pool is empty", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), []);

    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      expect(options).toContain("Option A");
      expect(options).toContain("Option B");
      expect(options).toContain("Option C");
    });
  });

  // -------------------------
  // CORRECT OPTION SHUFFLING
  // -------------------------
  it("assigns correct_option consistently after shuffle", () => {
    const result = generateChallengeQuestions("challenge-1", makeBrand(), distractorPool);

    result.forEach((q) => {
      const options = [q.option_a, q.option_b, q.option_c, q.option_d];
      const correctIndex = options.indexOf(q.correct_answer);
      expect(q.correct_option).toBe(["A", "B", "C", "D"][correctIndex]);
    });
  });

  // -------------------------
  // TEMPLATE OVERRIDES (#487)
  // -------------------------
  it("uses defaults when question_template is null", () => {
    const result = generateChallengeQuestions(
      "challenge-1",
      makeBrand({ question_template: null }),
      distractorPool
    );

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
    expect(result.find((q) => q.round === 3)!.question_text).toBe(
      "Which brand makes this product?"
    );
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
    const result = generateChallengeQuestions(
      "challenge-1",
      makeBrand({ tagline: null, usp: null, product_image_keys: [] }),
      distractorPool
    );
    expect(result).toHaveLength(3);
    result.forEach((q) => {
      expect(q.question_text).toBe("What is the name of this brand?");
    });
  });

  it("applies template overrides to fallback rounds when brand data is sparse", () => {
    const result = generateChallengeQuestions(
      "challenge-1",
      makeBrand({
        tagline: null,
        usp: null,
        product_image_keys: [],
        question_template: {
          round_1: { question_text: "Fallback round 1", prompt_type: "tagline" },
          round_2: { question_text: "Fallback round 2", prompt_type: "productImage1" },
          round_3: { question_text: "Fallback round 3", prompt_type: "logo" },
        },
      }),
      distractorPool
    );

    expect(result.map((q) => q.question_text)).toEqual([
      "Fallback round 1",
      "Fallback round 2",
      "Fallback round 3",
    ]);
    expect(result.map((q) => q.prompt_type)).toEqual(["tagline", "productImage1", "logo"]);
  });

  it("falls back to brand recognition for missing product imagery", () => {
    const result = generateChallengeQuestions(
      "challenge-1",
      makeBrand({ product_image_keys: [] }),
      distractorPool
    );

    expect(result).toHaveLength(3);
    const round3 = result.find((q) => q.round === 3)!;
    expect(round3.question_type).toBe("which_brand");
    expect(round3.prompt_type).toBe("logo");
    expect(round3.question_text).toBe("What is the name of this brand?");
    expect(round3.correct_answer).toBe("BrandX");
  });

  it("sets challenge_id on all questions", () => {
    const result = generateChallengeQuestions("chal-xyz", makeBrand(), distractorPool);
    result.forEach((q) => {
      expect(q.challenge_id).toBe("chal-xyz");
    });
  });
});
