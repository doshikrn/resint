import { useEffect, useMemo, useRef, useState } from "react";

import {
  ApiRequestError,
  fetchSessionCatalog,
  type InventoryCatalogItem,
  type InventorySession,
  type ItemSearchResult,
} from "@/lib/api/http";
import { loadCatalogCache, saveCatalogCache } from "@/lib/inventory-offline-cache";
import type { DictionaryKeys } from "@/lib/i18n";

const SEARCH_RESULT_LIMIT = 20;
const FUZZY_PREFIX_MAX_DISTANCE = 1;

function normalizeSearchValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function foldSearchValue(value: string): string {
  return normalizeSearchValue(value)
    .replace(/[ёэ]/g, "е")
    .replace(/й/g, "и")
    .replace(/[ъь]/g, "");
}

function splitSearchWords(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

function boundedPrefixDistance(query: string, target: string, maxDistance: number): number {
  if (!query || !target) {
    return query === target ? 0 : maxDistance + 1;
  }

  const prefix = target.slice(0, Math.max(query.length, Math.min(target.length, query.length + maxDistance)));
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

function matchesFuzzyToken(token: string, words: string[]): boolean {
  if (!token) {
    return true;
  }

  for (const word of words) {
    if (word.includes(token)) {
      return true;
    }

    if (Math.abs(word.length - token.length) > FUZZY_PREFIX_MAX_DISTANCE && word.length < token.length) {
      continue;
    }

    if (boundedPrefixDistance(token, word, FUZZY_PREFIX_MAX_DISTANCE) <= FUZZY_PREFIX_MAX_DISTANCE) {
      return true;
    }
  }

  return false;
}

function getSearchScore(params: {
  normalizedQuery: string;
  normalizedTokens: string[];
  foldedQuery: string;
  foldedTokens: string[];
  normalizedName: string;
  normalizedHaystack: string;
  foldedName: string;
  foldedHaystack: string;
  foldedWords: string[];
}): number | null {
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

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Fetches and caches the full catalog for the active session.
 * Uses ETag/304 for efficient periodic refreshes.
 * Builds an in-memory search index.
 *
 * Extracted from useFastEntry. No dependency on offline queue, favorites, or draft state.
 */
export function useCatalogFetch(params: {
  session: InventorySession | null;
  isClosed: boolean;
  inventoryView: "revision" | "management" | "reports";
  debouncedSearchTerm: string;
  warehouseId: number | null;
  t: (key: DictionaryKeys) => string;
}) {
  const { session, isClosed, inventoryView, debouncedSearchTerm, warehouseId, t } = params;

  const [catalogItems, setCatalogItems] = useState<InventoryCatalogItem[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const [catalogRefreshTick, setCatalogRefreshTick] = useState(0);

  // Track which warehouse the cache was restored for
  const cacheRestoredForRef = useRef<number | null>(null);

  // ── Early cache restore (no session needed) ────────────────────────
  // Fires as soon as warehouseId is known (before the session query
  // resolves), so search is usable from cached catalog immediately.

  useEffect(() => {
    if (inventoryView !== "revision" || !warehouseId) return;
    if (cacheRestoredForRef.current === warehouseId) return;

    let cancelled = false;

    void (async () => {
      try {
        const cached = await loadCatalogCache(warehouseId).catch(() => null);
        if (cancelled) return;
        cacheRestoredForRef.current = warehouseId;
        if (cached?.items?.length) {
          setCatalogItems(cached.items);
        }
      } catch {
        // Ignore cache errors; network fetch will supply items
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inventoryView, warehouseId]);

  // ── Clear items on warehouse change ────────────────────────────────

  const prevWarehouseRef = useRef<number | null>(null);
  useEffect(() => {
    if (warehouseId === prevWarehouseRef.current) return;
    if (prevWarehouseRef.current !== null) {
      setCatalogItems(null);
      setCatalogLoadError(null);
      cacheRestoredForRef.current = null;
    }
    prevWarehouseRef.current = warehouseId;
  }, [warehouseId]);

  // ── Network fetch (needs session) ──────────────────────────────────

  useEffect(() => {
    if (inventoryView !== "revision") {
      setCatalogLoading(false);
      return;
    }

    if (isClosed) {
      setCatalogItems(null);
      setCatalogLoadError(null);
      setCatalogLoading(false);
      return;
    }

    if (!session?.id || !session.warehouse_id) {
      setCatalogLoadError(null);
      setCatalogLoading(false);
      return;
    }

    let cancelled = false;
    const sessionId = session.id;
    const warehouseId = session.warehouse_id;

    void (async () => {
      setCatalogLoading(true);
      setCatalogLoadError(null);

      try {
        const cached = await loadCatalogCache(warehouseId).catch(() => null);
        if (cancelled) return;

        if (cached?.items?.length) {
          setCatalogItems(cached.items);
        }

        let response = await fetchSessionCatalog(sessionId, {
          etag: cached?.etag ?? null,
          lastModified: cached?.last_modified ?? null,
        });
        if (cancelled) return;

        // If 304 but cached items are missing, force a full re-fetch
        if (response.status === 304 && !cached?.items?.length) {
          response = await fetchSessionCatalog(sessionId, {});
          if (cancelled) return;
        }

        if (response.status === 200 && response.items) {
          setCatalogItems(response.items);
          await saveCatalogCache({
            warehouse_id: warehouseId,
            etag: response.etag,
            last_modified: response.lastModified,
            fetched_at: Date.now(),
            items: response.items,
          }).catch(() => {});
          return;
        }

        if (response.status === 304) {
          const nextEtag = response.etag ?? cached?.etag ?? null;
          const nextLastModified = response.lastModified ?? cached?.last_modified ?? null;
          if (cached) {
            await saveCatalogCache({
              ...cached,
              etag: nextEtag,
              last_modified: nextLastModified,
              fetched_at: Date.now(),
            }).catch(() => {});
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof ApiRequestError
              ? t("error.catalog_load")
              : t("error.catalog_offline");
          setCatalogLoadError(message);
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inventoryView, isClosed, session?.id, session?.warehouse_id, t, catalogRefreshTick]);

  // Periodic catalog re-fetch (ETag means 304 is returned if unchanged)
  useEffect(() => {
    if (inventoryView !== "revision" || !session?.id || isClosed) return;
    const timer = setInterval(() => setCatalogRefreshTick((n: number) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [inventoryView, session?.id, isClosed]);

  // ── Search index ───────────────────────────────────────────────────

  const catalogSearchIndex = useMemo(() => {
    const items = (catalogItems ?? []).filter((item: InventoryCatalogItem) => item.is_active);
    return items.map((item: InventoryCatalogItem) => {
      const aliases = Array.isArray(item.aliases) ? item.aliases : [];
      const haystackSource = `${item.name} ${item.product_code ?? ""} ${aliases.join(" ")}`;
      const normalizedName = normalizeSearchValue(item.name);
      const normalizedHaystack = normalizeSearchValue(haystackSource);
      const foldedName = foldSearchValue(item.name);
      const foldedHaystack = foldSearchValue(haystackSource);

      return {
        item,
        normalizedName,
        normalizedHaystack,
        foldedName,
        foldedHaystack,
        foldedWords: splitSearchWords(foldedHaystack),
      };
    });
  }, [catalogItems]);

  const searchResults = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(debouncedSearchTerm);
    if (!normalizedQuery) return [] as ItemSearchResult[];

    const normalizedTokens = splitSearchWords(normalizedQuery);
    if (normalizedTokens.length === 0) return [] as ItemSearchResult[];

    const foldedQuery = foldSearchValue(debouncedSearchTerm);
    const foldedTokens = splitSearchWords(foldedQuery);
    const rankedResults: Array<{ item: ItemSearchResult; score: number }> = [];

    for (const row of catalogSearchIndex) {
      const score = getSearchScore({
        normalizedQuery,
        normalizedTokens,
        foldedQuery,
        foldedTokens,
        normalizedName: row.normalizedName,
        normalizedHaystack: row.normalizedHaystack,
        foldedName: row.foldedName,
        foldedHaystack: row.foldedHaystack,
        foldedWords: row.foldedWords,
      });

      if (score !== null) {
        rankedResults.push({ item: row.item, score });
      }
    }

    rankedResults.sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      return left.item.name.localeCompare(right.item.name, "ru");
    });

    return rankedResults.slice(0, SEARCH_RESULT_LIMIT).map((entry) => entry.item);
  }, [catalogSearchIndex, debouncedSearchTerm]);

  return {
    catalogItems,
    setCatalogItems,
    catalogLoading,
    catalogLoadError,
    catalogSearchIndex,
    searchResults,
  };
}
