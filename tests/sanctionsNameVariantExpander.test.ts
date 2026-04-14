/**
 * Sanctions name variant expander tests.
 */
import { describe, it, expect } from "vitest";
import {
  expandNameVariants,
  matchesWithVariants,
  __test__,
} from "../src/services/sanctionsNameVariantExpander";

const {
  normalize,
  applyArabicLatinRules,
  foldDoubleConsonants,
  stripVowels,
  phoneticKey,
  MAX_VARIANTS,
} = __test__;

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

describe("normalize", () => {
  it("lowercases + trims + collapses whitespace", () => {
    expect(normalize("  Mohammed   Al-Sabah  ")).toBe("mohammed al-sabah");
  });

  it("strips diacritics", () => {
    expect(normalize("Müller")).toBe("muller");
    expect(normalize("José García")).toBe("jose garcia");
  });

  it("strips curly + straight quotes", () => {
    expect(normalize("O'Brien")).toBe("obrien");
    expect(normalize("D\u2019Souza")).toBe("dsouza");
  });

  it("returns empty string for non-strings", () => {
    expect(normalize(null as unknown as string)).toBe("");
    expect(normalize(undefined as unknown as string)).toBe("");
    expect(normalize(42 as unknown as string)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// applyArabicLatinRules
// ---------------------------------------------------------------------------

describe("applyArabicLatinRules", () => {
  it("collapses the Mohammed family to mohamed", () => {
    const variants = applyArabicLatinRules("mohammed");
    expect(variants).toContain("mohamed");
  });

  it("collapses muhammad + muhamad + mohammad + mohamad", () => {
    expect(applyArabicLatinRules("muhammad")).toContain("mohamed");
    expect(applyArabicLatinRules("muhamad")).toContain("mohamed");
    expect(applyArabicLatinRules("mohammad")).toContain("mohamed");
    expect(applyArabicLatinRules("mohamad")).toContain("mohamed");
  });

  it("collapses mohd + mhd to mohamed", () => {
    expect(applyArabicLatinRules("mohd abdullah")).toContain(
      "mohamed abdullah"
    );
  });

  it("collapses the Hussein family", () => {
    expect(applyArabicLatinRules("hussain")).toContain("hussein");
    expect(applyArabicLatinRules("husain")).toContain("hussein");
    expect(applyArabicLatinRules("hossein")).toContain("hussein");
  });

  it("collapses the Yousef family", () => {
    expect(applyArabicLatinRules("yusuf")).toContain("yousef");
    expect(applyArabicLatinRules("yousif")).toContain("yousef");
    expect(applyArabicLatinRules("yousuf")).toContain("yousef");
  });

  it("collapses abdel + abd al + abdal to abdul", () => {
    expect(applyArabicLatinRules("abdel aziz")).toContain("abdul aziz");
    expect(applyArabicLatinRules("abd al rahman")).toContain("abdul rahman");
  });

  it("does not touch unrelated names", () => {
    const v = applyArabicLatinRules("john smith");
    expect(v).toContain("john smith");
    // No stray Mohamed in the variants.
    expect(v.some((s) => s.includes("mohamed"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// foldDoubleConsonants
// ---------------------------------------------------------------------------

describe("foldDoubleConsonants", () => {
  it("folds double consonants to single", () => {
    expect(foldDoubleConsonants("mohammed")).toBe("mohamed");
    expect(foldDoubleConsonants("hassan")).toBe("hasan");
  });

  it("preserves double vowels", () => {
    expect(foldDoubleConsonants("yousuuf")).toBe("yousuuf");
  });

  it("handles runs longer than 2", () => {
    expect(foldDoubleConsonants("abccc")).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// stripVowels
// ---------------------------------------------------------------------------

describe("stripVowels", () => {
  it("strips interior vowels after consonants", () => {
    expect(stripVowels("mohamed")).toBe("mhmd");
    expect(stripVowels("ahmed")).toBe("ahmd");
  });

  it("keeps leading vowels", () => {
    expect(stripVowels("abdul")).toBe("abdl");
  });
});

// ---------------------------------------------------------------------------
// phoneticKey
// ---------------------------------------------------------------------------

describe("phoneticKey", () => {
  it("maps Q to K", () => {
    expect(phoneticKey("qadir")).toBe("kadir");
  });

  it("maps Z to S", () => {
    expect(phoneticKey("muazzam")).toBe("muassam");
  });

  it("maps V to F", () => {
    expect(phoneticKey("vladimir")).toBe("fladimir");
  });

  it("strips initial silent letters (kn, wr, gn, ps)", () => {
    expect(phoneticKey("knight")).toBe("night");
    expect(phoneticKey("wright")).toBe("right");
    expect(phoneticKey("gnome")).toBe("nome");
    expect(phoneticKey("psyche")).toBe("syche");
  });

  it("simplifies sch to sh", () => {
    expect(phoneticKey("schmidt")).toBe("shmidt");
  });
});

// ---------------------------------------------------------------------------
// expandNameVariants
// ---------------------------------------------------------------------------

describe("expandNameVariants", () => {
  it("always contains the canonical form first", () => {
    const result = expandNameVariants("Mohammed");
    expect(result.canonical).toBe("mohammed");
    expect(result.variants[0]).toBe("mohammed");
  });

  it("returns an empty set for empty input", () => {
    const result = expandNameVariants("");
    expect(result.canonical).toBe("");
    expect(result.variants).toHaveLength(0);
  });

  it("expands Mohammed to include the transliteration family", () => {
    const result = expandNameVariants("Mohammed");
    expect(result.variants).toContain("mohamed");
  });

  it("expands Muhammad bin Rashid to a consistent canonical", () => {
    const result = expandNameVariants("Muhammad bin Rashid");
    expect(result.variants).toContain("mohamed bin rashid");
  });

  it("caps variants at MAX_VARIANTS to prevent explosion", () => {
    const result = expandNameVariants("Muhammad Abdel Hussein Yusuf");
    expect(result.variants.length).toBeLessThanOrEqual(MAX_VARIANTS);
  });

  it("produces a non-empty phoneticKey for a real name", () => {
    expect(expandNameVariants("Ahmed").phoneticKey.length).toBeGreaterThan(0);
  });

  it("is deterministic — same input always produces same canonical", () => {
    const a = expandNameVariants("Mohammed Al-Thani");
    const b = expandNameVariants("Mohammed Al-Thani");
    expect(a.canonical).toBe(b.canonical);
    expect(a.variants).toEqual(b.variants);
  });
});

// ---------------------------------------------------------------------------
// matchesWithVariants
// ---------------------------------------------------------------------------

describe("matchesWithVariants", () => {
  // Simple Jaccard-like similarity for tests — returns 1 for exact match.
  const exactSimilarity = (a: string, b: string) => (a === b ? 1 : 0);

  it("matches an exact canonical", () => {
    const result = matchesWithVariants("Ahmed", "ahmed", exactSimilarity);
    expect(result.matched).toBe(true);
    expect(result.bestScore).toBe(1);
    expect(result.bestVariant).toBe("ahmed");
  });

  it("matches through a transliteration variant", () => {
    // Query is Mohammed, target is the sanctioned party spelled Mohamed.
    // Exact-similarity returns 1 only for the transformed variant.
    const result = matchesWithVariants(
      "Mohammed",
      "mohamed",
      exactSimilarity
    );
    expect(result.matched).toBe(true);
    expect(result.bestVariant).toBe("mohamed");
  });

  it("does not match unrelated names", () => {
    const result = matchesWithVariants(
      "John Smith",
      "Mohammed Al-Sabah",
      exactSimilarity
    );
    expect(result.matched).toBe(false);
  });

  it("respects the threshold", () => {
    // With a high threshold (0.99) and a sim function that returns 0.5,
    // matchesWithVariants must return matched: false.
    const halfSim = () => 0.5;
    const result = matchesWithVariants("foo", "bar", halfSim, 0.99);
    expect(result.matched).toBe(false);
    expect(result.bestScore).toBe(0.5);
  });
});
