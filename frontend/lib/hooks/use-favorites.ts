import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ItemSearchResult } from "@/lib/api/http";

// ─── Constants ───────────────────────────────────────────────────────

export const FAVORITES_STORAGE_KEY = "inventory-favorites-v1";

// ─── Types ───────────────────────────────────────────────────────────

type FavoritesByWarehouse = Record<string, ItemSearchResult[]>;

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Manages per-warehouse favorites persisted in localStorage.
 * Handles long-press-to-favorite on chip items.
 *
 * Extracted from useFastEntry — no dependency on session or network state.
 */
export function useFavorites(params: {
  selectedWarehouseId: number | null;
  setToastMessage: (msg: string | null) => void;
  t: (key: string) => string;
}) {
  const { selectedWarehouseId, setToastMessage, t } = params;

  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [favoritesByWarehouse, setFavoritesByWarehouse] = useState<FavoritesByWarehouse>({} as FavoritesByWarehouse);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressHandledRef = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) {
        setFavoritesByWarehouse({});
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") {
        setFavoritesByWarehouse({});
        return;
      }

      const normalized: FavoritesByWarehouse = {};
      for (const [warehouseKey, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        normalized[warehouseKey] = value
          .flatMap((candidate): ItemSearchResult[] => {
            if (!candidate || typeof candidate !== "object") return [];
            const typed = candidate as {
              id?: unknown;
              product_code?: unknown;
              name?: unknown;
              unit?: unknown;
              warehouse_id?: unknown;
              step?: unknown;
              min_qty?: unknown;
              max_qty?: unknown;
              is_favorite?: unknown;
            };
            if (
              typeof typed.id !== "number" ||
              typeof typed.name !== "string" ||
              typeof typed.unit !== "string" ||
              typeof typed.warehouse_id !== "number"
            )
              return [];
            return [
              {
                id: typed.id,
                product_code: typeof typed.product_code === "string" ? typed.product_code : "",
                name: typed.name,
                unit: typed.unit,
                warehouse_id: typed.warehouse_id,
                step: typeof typed.step === "number" && typed.step > 0 ? typed.step : 1,
                min_qty: typeof typed.min_qty === "number" ? typed.min_qty : null,
                max_qty: typeof typed.max_qty === "number" ? typed.max_qty : null,
                is_favorite: typeof typed.is_favorite === "boolean" ? typed.is_favorite : false,
              },
            ];
          })
          .slice(0, 30);
      }

      setFavoritesByWarehouse(normalized);
    } catch {
      setFavoritesByWarehouse({});
    } finally {
      setFavoritesLoaded(true);
    }
  }, []);

  // Persist to localStorage whenever favorites change
  useEffect(() => {
    if (!favoritesLoaded || typeof window === "undefined") return;
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoritesByWarehouse));
  }, [favoritesLoaded, favoritesByWarehouse]);

  // Cleanup long-press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // ── Derived ────────────────────────────────────────────────────────

  const favoriteItems = useMemo(() => {
    if (!selectedWarehouseId) return [] as ItemSearchResult[];
    return (favoritesByWarehouse[String(selectedWarehouseId)] ?? []).slice(0, 7);
  }, [favoritesByWarehouse, selectedWarehouseId]);

  const favoriteIds = useMemo(
    () => new Set(favoriteItems.map((item: ItemSearchResult) => item.id)),
    [favoriteItems],
  );

  // ── Handlers ────────────────────────────────────────────────────────

  const toggleFavorite = useCallback(
    (item: ItemSearchResult) => {
      if (!selectedWarehouseId) return;

      const warehouseKey = String(selectedWarehouseId);
      const existing = favoritesByWarehouse[warehouseKey] ?? [];
      const isAlreadyFavorite = existing.some((entry: ItemSearchResult) => entry.id === item.id);
      const nextFavorites = isAlreadyFavorite
        ? existing.filter((entry: ItemSearchResult) => entry.id !== item.id)
        : [item, ...existing.filter((entry: ItemSearchResult) => entry.id !== item.id)].slice(0, 30);

      setFavoritesByWarehouse((previous: FavoritesByWarehouse) => ({
        ...previous,
        [warehouseKey]: nextFavorites,
      }));
      setToastMessage(
        isAlreadyFavorite ? t("toast.removed_from_favorites") : t("toast.added_to_favorites"),
      );
    },
    [favoritesByWarehouse, selectedWarehouseId, setToastMessage, t],
  );

  const toggleFavoriteById = useCallback(
    (itemId: number, catalogItems: { id: number }[] | null) => {
      const item = (catalogItems ?? []).find((c) => c.id === itemId);
      if (item) toggleFavorite(item as ItemSearchResult);
    },
    [toggleFavorite],
  );

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleChipPointerDown = useCallback(
    (item: ItemSearchResult) => {
      clearLongPress();
      longPressHandledRef.current = false;
      longPressTimerRef.current = window.setTimeout(() => {
        toggleFavorite(item);
        longPressHandledRef.current = true;
      }, 550);
    },
    [clearLongPress, toggleFavorite],
  );

  const handleChipSelect = useCallback(
    (item: ItemSearchResult, chooseItem: (item: ItemSearchResult) => void) => {
      if (longPressHandledRef.current) {
        longPressHandledRef.current = false;
        return;
      }
      chooseItem(item);
    },
    [],
  );

  return {
    favoriteItems,
    favoriteIds,
    toggleFavorite,
    toggleFavoriteById,
    clearLongPress,
    handleChipPointerDown,
    handleChipSelect,
    /** Exposed for direct long-press state tracking by parent if needed */
    longPressHandledRef,
  };
}
