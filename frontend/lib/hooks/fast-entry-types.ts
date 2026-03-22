/**
 * Shared types for the fast-entry hook family.
 *
 * Centralises types that were previously duplicated across
 * use-fast-entry.ts and use-entry-submit.ts.
 */

import type {
  InventoryEntry,
  InventorySession,
} from "@/lib/api/http";
import type { OfflineEntryQueueItem } from "@/lib/offline-entry-queue";

// ─── Domain types ────────────────────────────────────────────────────

export type CurrentUserLike = {
  username: string;
  full_name: string | null;
  department: string | null;
  role: string;
  warehouse_id?: number | null;
  default_warehouse_id?: number | null;
};

export type PendingQtyConfirm = {
  normalizedQty: number;
  warnings: string[];
};

export type QtyValidation = {
  normalizedQty: number | null;
  error: string | null;
  wasRounded: boolean;
  roundedTo: number | null;
  softWarning: string | null;
  confirmWarnings: string[];
};

export type RecentJournalEntry = {
  key: string;
  itemId: number;
  status: "saved" | "pending" | "syncing" | "failed" | "failed_conflict";
  itemName: string;
  quantity: number;
  unit: string;
  mode: "add" | "set";
  timestamp: string;
  countedOutsideZone: boolean;
  countedByZone: string | null;
  stationId: number | null;
  stationName: string | null;
  stationDepartment: string | null;
  actorUsername?: string;
  actorRawUsername?: string;
  isOwnEntry?: boolean;
  queueItem?: OfflineEntryQueueItem;
  savedEntry?: {
    itemId: number;
    version: number;
    entry: InventoryEntry;
  };
};

export type RecentJournalGroup = {
  label: string;
  items: RecentJournalEntry[];
};

// ─── Hook params ─────────────────────────────────────────────────────

export type UseFastEntryParams = {
  session: InventorySession | null;
  isClosed: boolean;
  selectedWarehouseId: number | null;
  currentUser: CurrentUserLike | null;
  canSearch: boolean;
  canManageRevision: boolean;
  activeSessionQueryKey: readonly unknown[];
  inventoryView: "revision" | "management" | "reports";
  setToastMessage: (msg: string | null) => void;
  setInlineErrorMessage: (msg: string | null) => void;
  setInlineErrorDebug: (msg: string | null) => void;
};
