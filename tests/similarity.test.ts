import { describe, expect, it } from "vitest";
import {
  calculateLabelSimilarity,
  levenshteinDistance,
  SIMILARITY_THRESHOLD,
} from "#core/similarity.js";

describe(levenshteinDistance, () => {
  it("handles empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
    expect(levenshteinDistance("abc", "")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
  });

  it("computes edit distance", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
    expect(levenshteinDistance("abc", "ab")).toBe(1);
    expect(levenshteinDistance("abc", "axc")).toBe(1);
  });

  it("counts unicode code points, not UTF-16 units", () => {
    expect(levenshteinDistance("バグ", "バグ")).toBe(0);
    expect(levenshteinDistance("バグ", "バク")).toBe(1);
  });
});

describe(calculateLabelSimilarity, () => {
  it("returns 1 for identical names (case-insensitive)", () => {
    expect(calculateLabelSimilarity("bug", "bug")).toBe(1);
    expect(calculateLabelSimilarity("Bug", "bug")).toBe(1);
  });

  it("gives low similarity to unrelated names", () => {
    expect(calculateLabelSimilarity("enhancement", "feature")).toBeLessThan(0.5);
  });

  it("gives partial similarity to related names", () => {
    const similarity = calculateLabelSimilarity("bug-report", "bug");
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it("scores near-identical names above the threshold", () => {
    expect(calculateLabelSimilarity("bug-reports", "bug-report")).toBeGreaterThan(
      SIMILARITY_THRESHOLD,
    );
  });
});

describe("similarity threshold", () => {
  it("is 0.7", () => {
    expect(SIMILARITY_THRESHOLD).toBe(0.7);
  });
});
