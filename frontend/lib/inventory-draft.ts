import { type ItemSearchResult } from "@/lib/api/http";

const DRAFT_STORAGE_KEY = "inventory-fast-entry-draft-v1";

export type InventoryDraftPayload = {
  searchTerm: string;
  qty: string;
  selectedItem: ItemSearchResult | null;
  updatedAt: number;
};

export type InventoryDraftIndex = Record<string, InventoryDraftPayload>;

export function loadDraftIndex(): InventoryDraftIndex {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as InventoryDraftIndex;
  } catch {
    return {};
  }
}

export function saveDraftIndex(index: InventoryDraftIndex): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(index));
}

export function clearDraftByKey(key: string | null): void {
  if (typeof window === "undefined" || !key) {
    return;
  }
  const index = loadDraftIndex();
  if (!(key in index)) {
    return;
  }
  delete index[key];
  saveDraftIndex(index);
}

export function isValidDraftSelectedItem(candidate: unknown): candidate is ItemSearchResult {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const typed = candidate as Partial<ItemSearchResult>;
  return (
    typeof typed.id === "number" &&
    typeof typed.name === "string" &&
    typeof typed.unit === "string" &&
    typeof typed.warehouse_id === "number"
  );
}
