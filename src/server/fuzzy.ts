/**
 * Pure-TypeScript fuzzy matching for memory retrieval. Scores candidate text
 * against a query using token overlap, substring containment, word-prefix, and
 * subsequence bonuses — no native extensions, deterministic, case-insensitive.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for',
  'if', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'that', 'the',
  'their', 'then', 'there', 'these', 'this', 'to', 'was', 'will', 'with',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

/** Longest common subsequence length, capped for cheap scoring. */
function lcsLength(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const cap = Math.min(a.length, b.length, 64);
  let previous = new Array<number>(cap + 1).fill(0);
  let current = new Array<number>(cap + 1).fill(0);
  for (let i = 1; i <= Math.min(a.length, cap); i++) {
    for (let j = 1; j <= Math.min(b.length, cap); j++) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? previous[j - 1] + 1
          : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[Math.min(b.length, cap)];
}

export interface FuzzyScore {
  score: number;
  /** Human-readable 0-100 match strength, rounded. */
  strength: number;
}

/**
 * Scores one candidate string against a query. Zero means no signal at all;
 * scores above ~0.5 are strong matches.
 */
export function fuzzyScore(query: string, candidate: string): FuzzyScore {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0)
    return { score: 0, strength: 0 };
  const candidateLower = candidate.toLowerCase();
  const queryLower = query.trim().toLowerCase();

  let score = 0;
  // Token overlap: fraction of query tokens present in the candidate.
  const candidateTokenSet = new Set(candidateTokens);
  const overlap = queryTokens.filter((t) => candidateTokenSet.has(t)).length;
  score += 2.0 * (overlap / queryTokens.length);

  // Whole-query substring bonus (highest signal).
  if (queryLower && candidateLower.includes(queryLower)) score += 1.5;

  // Exact-match bonus: the candidate IS the query.
  if (queryLower && candidateLower.trim() === queryLower) score += 0.75;

  // Word-prefix bonus: candidate words that start with query tokens.
  const prefixHits = queryTokens.filter((t) =>
    candidateTokens.some((word) => word.startsWith(t) && t.length >= 2),
  ).length;
  score += 0.5 * (prefixHits / queryTokens.length);

  // Fuzzy subsequence rescue for typos ("timeshet" still matches "timesheet").
  const fuzzyHits = queryTokens.filter((t) =>
    candidateTokens.some((word) => lcsLength(t, word) / t.length >= 0.75),
  ).length;
  score += 0.75 * (fuzzyHits / queryTokens.length);

  // Slight recency-agnostic length dampener to avoid wall-of-text bias.
  score *= 1 - Math.min(0.15, Math.max(0, candidateTokens.length - 400) / 4000);

  const strength = Math.round(Math.min(1, score / 3) * 100);
  return { score: Number(score.toFixed(4)), strength };
}

export interface FuzzyCandidate {
  text: string;
  category?: string | null;
}

export interface FuzzyMatch<T extends FuzzyCandidate> extends FuzzyScore {
  item: T;
}

/** Returns candidates sorted by fuzzy score, strongest first, zero-score dropped. */
export function fuzzyRank<T extends FuzzyCandidate>(
  query: string,
  candidates: T[],
  limit = 10,
): FuzzyMatch<T>[] {
  return candidates
    .map((item) => {
      const haystack = item.category
        ? `${item.text} ${item.category}`
        : item.text;
      return { item, ...fuzzyScore(query, haystack) };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
