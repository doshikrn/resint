import { useEffect, useMemo, useRef, type RefObject } from "react";
import type { ItemSearchResult } from "@/lib/api/http";
import {
  clearDraftByKey,
  isValidDraftSelectedItem,
  loadDraftIndex,
  saveDraftIndex,
} from "@/lib/inventory-draft";

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Manages draft persistence (localStorage) for the fast-entry form.
 * Handles: draft key derivation, restore on mount, persist on change, clear on session close.
 *
 * Extracted from useFastEntry. No dependency on network or catalog state.
 */
export function useDraft(params: {
  currentUsername: string | null | undefined;
  selectedWarehouseId: number | null;
  isClosed: boolean;
  searchTerm: string;
  qty: string;
  selectedItem: ItemSearchResult | null;
  setSearchTerm: (v: string) => void;
  setQty: (v: string) => void;
  setSelectedItem: (item: ItemSearchResult | null) => void;
  setDebouncedSearchTerm: (v: string) => void;
  setIsDropdownOpen: (v: boolean) => void;
  setHighlightedIndex: (v: number) => void;
  focusInputReliably: (ref: RefObject<HTMLInputElement>, options?: { force?: boolean }) => void;
  qtyInputRef: RefObject<HTMLInputElement>;
  searchInputRef: RefObject<HTMLInputElement>;
}) {
  const {
    currentUsername,
    selectedWarehouseId,
    isClosed,
    searchTerm,
    qty,
    selectedItem,
    setSearchTerm,
    setQty,
    setSelectedItem,
    setDebouncedSearchTerm,
    setIsDropdownOpen,
    setHighlightedIndex,
    focusInputReliably,
    qtyInputRef,
    searchInputRef,
  } = params;

  const restoredDraftKeyRef = useRef<string | null>(null);

  const draftKey = useMemo(() => {
    if (!currentUsername) return null;
    if (!selectedWarehouseId) return null;
    return `${currentUsername}:${selectedWarehouseId}`;
  }, [currentUsername, selectedWarehouseId]);

  // ── Clear draft on session close ───────────────────────────────────

  useEffect(() => {
    if (isClosed) {
      clearDraftByKey(draftKey);
    }
  }, [draftKey, isClosed]);

  // ── Draft restore on mount / draftKey change ───────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!draftKey) return;
    if (restoredDraftKeyRef.current === draftKey) return;

    restoredDraftKeyRef.current = draftKey;
    const index = loadDraftIndex();
    const draft = index[draftKey];
    if (!draft) return;

    if (searchTerm.trim() || qty.trim() || selectedItem) return;

    const updatedAt = typeof draft.updatedAt === "number" ? draft.updatedAt : 0;
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (updatedAt > 0 && Date.now() - updatedAt > maxAgeMs) {
      clearDraftByKey(draftKey);
      return;
    }

    const nextSearchTerm = typeof draft.searchTerm === "string" ? draft.searchTerm : "";
    const nextQty = typeof draft.qty === "string" ? draft.qty : "";
    const nextSelectedItem = isValidDraftSelectedItem(draft.selectedItem) ? draft.selectedItem : null;

    if (nextSelectedItem && selectedWarehouseId && nextSelectedItem.warehouse_id !== selectedWarehouseId) {
      clearDraftByKey(draftKey);
      return;
    }

    setSearchTerm(nextSearchTerm);
    setQty(nextQty);
    if (nextSelectedItem) {
      setSelectedItem(nextSelectedItem);
      setDebouncedSearchTerm(nextSelectedItem.name);
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
      setTimeout(() => {
        focusInputReliably(qtyInputRef);
      }, 0);
    } else {
      setDebouncedSearchTerm(nextSearchTerm);
      setTimeout(() => {
        focusInputReliably(searchInputRef);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, focusInputReliably, qty, searchTerm, selectedItem, selectedWarehouseId]);

  // ── Draft persist on state change ──────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!draftKey) return;
    if (isClosed) return;

    const timeout = window.setTimeout(() => {
      const isEmpty = !searchTerm.trim() && !qty.trim() && !selectedItem;
      const index = loadDraftIndex();

      if (isEmpty) {
        if (draftKey in index) {
          delete index[draftKey];
          saveDraftIndex(index);
        }
        return;
      }

      index[draftKey] = {
        searchTerm,
        qty,
        selectedItem,
        updatedAt: Date.now(),
      };
      saveDraftIndex(index);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [draftKey, isClosed, qty, searchTerm, selectedItem]);

  return { draftKey };
}
