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
      const haystack = `${item.name} ${item.product_code ?? ""} ${aliases.join(" ")}`.toLowerCase();
      return { item, haystack };
    });
  }, [catalogItems]);

  const searchResults = useMemo(() => {
    const raw = debouncedSearchTerm.trim().toLowerCase();
    if (!raw) return [] as ItemSearchResult[];

    const tokens = raw.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [] as ItemSearchResult[];

    const results: ItemSearchResult[] = [];
    for (const row of catalogSearchIndex) {
      if (tokens.every((token) => row.haystack.includes(token))) {
        results.push(row.item);
        if (results.length >= 20) break;
      }
    }
    return results;
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
