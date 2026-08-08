/**
 * Similarity threshold for rename detection. A candidate label is considered
 * a rename target only when similarity is strictly greater than this value.
 * 0.7 balances rename detection accuracy against false positives.
 */
export const SIMILARITY_THRESHOLD = 0.7;

/**
 * Similarity between two label names in [0, 1], based on Levenshtein
 * distance over lowercased code points (1.0 = identical).
 */
export function calculateLabelSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  if (la === lb) {
    return 1;
  }

  const distance = levenshteinDistance(la, lb);
  const maxLen = Math.max([...la].length, [...lb].length);
  return 1 - distance / maxLen;
}

export function levenshteinDistance(a: string, b: string): number {
  const ac = [...a];
  const bc = [...b];

  if (ac.length === 0) {
    return bc.length;
  }
  if (bc.length === 0) {
    return ac.length;
  }

  let prev = Array.from({ length: bc.length + 1 }, (_, j) => j);

  for (let i = 1; i <= ac.length; i++) {
    const curr = Array.from({ length: bc.length + 1 }, () => 0);
    curr[0] = i;
    for (let j = 1; j <= bc.length; j++) {
      const cost = ac[i - 1] === bc[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = curr;
  }

  return prev[bc.length] ?? 0;
}
