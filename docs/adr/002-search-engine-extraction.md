# ADR-002: Search Engine Extraction

**Status:** Accepted  
**Date:** 2026-03-22  
**Decision makers:** Engineering team

## Context

The catalog search algorithm — ~120 lines of pure logic including Unicode normalisation, Cyrillic folding, Levenshtein-based fuzzy matching, and multi-token scoring — lived inside the React hook `use-catalog-fetch.ts`.

Problems:
- **Untestable in isolation** — search logic could only be tested through the React hook, requiring a full QueryClient/rendering setup.
- **Leaky coupling** — pure algorithms had no React dependency but were trapped in a React file.
- **Reuse blocked** — if a future service worker or server-side filter needed the same search, it would have to duplicate the code.

## Decision

Extract all pure search functions into `frontend/lib/search/catalog-search.ts`:

| Export | Purpose |
|--------|---------|
| `normalizeSearchValue(v)` | Lowercase + NFKD + strip diacritics |
| `foldSearchValue(v)` | Cyrillic-specific folding (ё→е, й→и, ъь→∅) |
| `splitSearchWords(v)` | Tokenise into non-empty words |
| `boundedPrefixDistance(a, b, max)` | Levenshtein-like prefix distance, bounded |
| `matchesFuzzyToken(word, token)` | Fuzzy token match with configurable threshold |
| `getSearchScore(params)` | Full scoring pipeline returning numeric relevance |
| `SEARCH_RESULT_LIMIT` | Constant (50) |

`use-catalog-fetch.ts` now imports from this module — zero behaviour change.

## Consequences

- **Positive:** Search logic is unit-testable with plain `expect()` calls. Any future consumer (SW, SSR, CLI tool) can import the same module.
- **Negative:** One additional import per consuming file.
- **Neutral:** Bundle size unchanged (same code, different file path).
