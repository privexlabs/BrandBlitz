import { generateQuestions } from "./questions";

// If your file uses RNG internally, we mock seed behavior
jest.mock("../utils/rng", () => {
  return {
    createRng: () => {
      let seed = 1;
      return {
        next: () => {
          seed = (seed * 9301 + 49297) % 233280;
          return seed / 233280;
        },
      };
    },
  };
});

describe("Questions Generation Engine", () => {
  const brand = {
    name: "BrandX",
    tagline: "Best product ever",
    usp: "Fast and reliable",
    productImages: ["img1.png", "img2.png"],
  };

  const distractorPool = Array.from({ length: 20 }).map((_, i) => ({
    name: `Brand${i}`,
  }));

  // -------------------------
  // BASIC GENERATION
  // -------------------------
  it("generates exactly 3 questions when full brand data is provided", () => {
    const result = generateQuestions(brand, distractorPool, 123);

    expect(result.length).toBe(3);

    const types = result.map((q: any) => q.type);
    expect(types).toContain("tagline");
    expect(types).toContain("usp");
    expect(types).toContain("product");
  });

  // -------------------------
  // FALLBACK TAGLINE
  // -------------------------
  it("falls back to brand name when tagline is missing", () => {
    const result = generateQuestions(
      { ...brand, tagline: undefined },
      distractorPool,
      123
    );

    const taglineQ = result.find((q: any) => q.type === "tagline");

    expect(taglineQ.answer).toBe(brand.name);
  });

  // -------------------------
  // DISTRACTOR LOGIC
  // -------------------------
  it("uses distractors from pool without duplicates or correct answer", () => {
    const result = generateQuestions(brand, distractorPool, 123);

    result.forEach((q: any) => {
      const options = q.options;

      // no duplicates
      const unique = new Set(options);
      expect(unique.size).toBe(options.length);

      // correct answer not duplicated in distractors
      const occurrences = options.filter((o: string) => o === q.answer);
      expect(occurrences.length).toBe(1);
    });
  });

  // -------------------------
  // EMPTY POOL HANDLING
  // -------------------------
  it("falls back to Option A/B/C when distractor pool is empty", () => {
    const result = generateQuestions(brand, [], 123);

    result.forEach((q: any) => {
      expect(q.options).toContain("Option A");
      expect(q.options).toContain("Option B");
      expect(q.options).toContain("Option C");
    });
  });

  // -------------------------
  // DETERMINISTIC OUTPUT
  // -------------------------
  it("produces deterministic output for same seed", () => {
    const a = generateQuestions(brand, distractorPool, 999);
    const b = generateQuestions(brand, distractorPool, 999);

    expect(a).toEqual(b);
  });

  // -------------------------
  // CORRECT OPTION SHUFFLING
  // -------------------------
  it("assigns correct_option consistently after shuffle", () => {
    const result = generateQuestions(brand, distractorPool, 123);

    result.forEach((q: any) => {
      const correctIndex = q.options.indexOf(q.answer);
      expect(q.correct_option).toBe(correctIndex);
    });
  });
});