/**
 * Pure catalog search engine — zero React dependencies.
 *
 * Provides normalised, folded, ranked in-memory search over
 * an item catalog with Cyrillic-aware fuzzy matching.
 *
 * Ranking tiers (lower = better match):
 *   0: normalised name startsWith query
 *   1: normalised haystack (name + code + aliases) startsWith query
 *   2: normalised name includes query
 *   3: all query tokens found in normalised haystack
 *   4–7: folded (ё→е, й→и, remove ъь) equivalents of 0–3
 *   8: fuzzy prefix-distance ≤ 1 on folded tokens
 *   null: no match
 */

// ─── Constants ─────────────────────────────────────────────────────

export const SEARCH_RESULT_LIMIT = 20;

const FUZZY_PREFIX_MAX_DISTANCE = 1;

// ─── Normalisation helpers ──────────────────────────────────────────

export function normalizeSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function foldSearchValue(value: string): string {
  return normalizeSearchValue(value)
    .replace(/[ёэ]/g, "е")
    .replace(/й/g, "и")
    .replace(/[ъь]/g, "");
}

export function splitSearchWords(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

// ─── Edit-distance ──────────────────────────────────────────────────

/**
 * Bounded Levenshtein prefix distance.
 * Returns actual distance if ≤ maxDistance, else maxDistance + 1.
 */
export function boundedPrefixDistance(
  query: string,
  target: string,
  maxDistance: number,
): number {
  if (!query || !target) {
    return query === target ? 0 : maxDistance + 1;
  }

  const prefix = target.slice(
    0,
    Math.max(query.length, Math.min(target.length, query.length + maxDistance)),
  );
  const previous = Array.from({ length: prefix.length + 1 }, (_, index) => index);

  for (let row = 1; row <= query.length; row += 1) {
    const current = [row];
    let rowMin = current[0];

    for (let column = 1; column <= prefix.length; column += 1) {
      const substitutionCost = query[row - 1] === prefix[column - 1] ? 0 : 1;
      const next = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + substitutionCost,
      );
      current.push(next);
      rowMin = Math.min(rowMin, next);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let column = 0; column < current.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return Math.min(...previous);
}

// ─── Token-level fuzzy matching ─────────────────────────────────────

export function matchesFuzzyToken(token: string, words: string[]): boolean {
  if (!token) {
    return true;
  }

  for (const word of words) {
    if (word.includes(token)) {
      return true;
    }

    if (
      Math.abs(word.length - token.length) > FUZZY_PREFIX_MAX_DISTANCE &&
      word.length < token.length
    ) {
      continue;
    }

    if (boundedPrefixDistance(token, word, FUZZY_PREFIX_MAX_DISTANCE) <= FUZZY_PREFIX_MAX_DISTANCE) {
      return true;
    }
  }

  return false;
}

// ─── Composite scoring ──────────────────────────────────────────────

export interface SearchScoreParams {
  normalizedQuery: string;
  normalizedTokens: string[];
  foldedQuery: string;
  foldedTokens: string[];
  normalizedName: string;
  normalizedHaystack: string;
  foldedName: string;
  foldedHaystack: string;
  foldedWords: string[];
}

/**
 * Return integer rank (lower = better) or null if no match.
 */
export function getSearchScore(params: SearchScoreParams): number | null {
  const {
    normalizedQuery,
    normalizedTokens,
    foldedQuery,
    foldedTokens,
    normalizedName,
    normalizedHaystack,
    foldedName,
    foldedHaystack,
    foldedWords,
  } = params;

  if (normalizedName.startsWith(normalizedQuery)) return 0;
  if (normalizedHaystack.startsWith(normalizedQuery)) return 1;
  if (normalizedName.includes(normalizedQuery)) return 2;
  if (normalizedTokens.every((token) => normalizedHaystack.includes(token))) return 3;

  if (foldedName.startsWith(foldedQuery)) return 4;
  if (foldedHaystack.startsWith(foldedQuery)) return 5;
  if (foldedName.includes(foldedQuery)) return 6;
  if (foldedTokens.every((token) => foldedHaystack.includes(token))) return 7;
  if (foldedTokens.every((token) => matchesFuzzyToken(token, foldedWords))) return 8;

  return null;
}
