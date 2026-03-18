import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ApiRequestError,
  createItem,
  getFrequentItems,
  getRecentInventoryEntries,
  getRecentInventoryEvents,
  getRecentItems,
  getSessionEntriesSnapshot,
  getSessionInventoryAudit,
  getSessionInventoryProgress,
  patchInventoryEntry,
  saveInventoryEntry,
  type InventoryEntry,
  type InventoryEntrySnapshotRow,
  type InventoryRecentEvent,
  type InventorySession,
  type InventorySessionProgress,
  type ItemSearchResult,
} from "@/lib/api/http";
import { mapApiError } from "@/lib/api/error-mapper";
import {
  loadEntriesSnapshotCache,
  saveEntriesSnapshotCache,
} from "@/lib/inventory-offline-cache";
import {
  addOfflineEntryQueueItem,
  type OfflineEntryQueueItem,
} from "@/lib/offline-entry-queue";
import { useLanguage } from "@/lib/i18n/language-provider";
import { useSuccessGlow } from "@/lib/hooks/use-success-glow";
import {
  clearDraftByKey,
  isValidDraftSelectedItem,
  loadDraftIndex,
  saveDraftIndex,
} from "@/lib/inventory-draft";
import { useFavorites } from "@/lib/hooks/use-favorites";
import { useOfflineSync } from "@/lib/hooks/use-offline-sync";
import { useCatalogFetch } from "@/lib/hooks/use-catalog-fetch";

// ─── Types ───────────────────────────────────────────────────────────

type PendingQtyConfirm = {
  normalizedQty: number;
  warnings: string[];
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

export type CurrentUserLike = {
  username: string;
  full_name: string | null;
  department: string | null;
  role: string;
  warehouse_id?: number | null;
  default_warehouse_id?: number | null;
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

// ─── Hook ────────────────────────────────────────────────────────────

export function useFastEntry(params: UseFastEntryParams) {
  const {
    session,
    isClosed,
    selectedWarehouseId,
    currentUser,
    canSearch,
    canManageRevision,
    activeSessionQueryKey,
    inventoryView,
    setToastMessage,
    setInlineErrorMessage,
    setInlineErrorDebug,
  } = params;

  const { t } = useLanguage();
  const queryClient = useQueryClient();

  // ── Success glow ───────────────────────────────────────────────────
  const { glowing: saveGlowActive, glowKey: saveGlowKey, trigger: triggerSaveGlow } = useSuccessGlow();

  // ── Search state ───────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [selectedItem, setSelectedItem] = useState<ItemSearchResult | null>(null);
  const [quickCreateUnitPickerOpen, setQuickCreateUnitPickerOpen] = useState(false);

  // ── Qty state ──────────────────────────────────────────────────────
  const [qty, setQty] = useState("");
  const [clearSearchAfterSave] = useState(true);
  const [pendingQtyConfirm, setPendingQtyConfirm] = useState<PendingQtyConfirm | null>(null);

  // ── Entries snapshot ───────────────────────────────────────────────
  const [entriesSnapshot, setEntriesSnapshot] = useState<InventoryEntrySnapshotRow[]>([]);
  const [snapshotRefetchCounter, setSnapshotRefetchCounter] = useState(0);

  // ── Misc state ─────────────────────────────────────────────────────
  const [queueRepairOpen, setQueueRepairOpen] = useState(false);
  const [recentFilterMine, setRecentFilterMine] = useState(true);

  // ── Refs ───────────────────────────────────────────────────────────
  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const lastOfflineEnqueueRef = useRef<{
    signature: string;
    idempotencyKey: string;
    createdAtMs: number;
  } | null>(null);
  const submitLockRef = useRef(false);
  const restoredDraftKeyRef = useRef<string | null>(null);

  // ── Sub-hooks ──────────────────────────────────────────────────────

  const {
    favoriteItems,
    favoriteIds,
    toggleFavorite,
    toggleFavoriteById: toggleFavoriteByIdBase,
    clearLongPress,
    handleChipPointerDown,
    longPressHandledRef,
  } = useFavorites({ selectedWarehouseId, setToastMessage, t });

  const {
    isOnline,
    isSyncing,
    offlineQueue,
    setOfflineQueue,
    syncStatus,
    isSyncingQueueRef,
    syncOfflineQueue,
    handleSyncRetry,
    handleDismissConflict,
    handleQueueRetryOne,
    handleQueueDeleteOne,
    handleQueueRetryAllFailed,
  } = useOfflineSync({
    activeSessionQueryKey,
    queryClient,
    setToastMessage,
    t,
    onSyncSuccess: () => setSnapshotRefetchCounter((c) => c + 1),
  });

  const {
    catalogItems,
    setCatalogItems,
    catalogLoading,
    catalogLoadError,
    catalogSearchIndex,
    searchResults,
  } = useCatalogFetch({ session, isClosed, inventoryView, debouncedSearchTerm, t });

  // Adapt toggleFavoriteById to pass local catalogItems
  const toggleFavoriteById = useCallback(
    (itemId: number) => toggleFavoriteByIdBase(itemId, catalogItems),
    [catalogItems, toggleFavoriteByIdBase],
  );

  // ── Derived ────────────────────────────────────────────────────────

  const entriesSnapshotByItemId = useMemo(() => {
    const map = new Map<number, InventoryEntrySnapshotRow>();
    for (const row of entriesSnapshot) {
      map.set(row.item_id, row);
    }
    return map;
  }, [entriesSnapshot]);

  const draftKey = useMemo(() => {
    if (!currentUser?.username) return null;
    if (!selectedWarehouseId) return null;
    return `${currentUser.username}:${selectedWarehouseId}`;
  }, [currentUser?.username, selectedWarehouseId]);

  // ── Helpers ────────────────────────────────────────────────────────

  const shouldAutoFocus = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px) and (pointer: fine)").matches;
  }, []);

  const focusInputReliably = useCallback(
    (ref: React.RefObject<HTMLInputElement>, options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      if (!force && !shouldAutoFocus()) return;

      const target = ref.current;
      if (!target) return;

      target.focus({ preventScroll: true });

      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          ref.current?.focus({ preventScroll: true });
        });
      }

      setTimeout(() => {
        const el = ref.current;
        if (el) {
          el.focus({ preventScroll: true });
          el.select();
        }
      }, 0);
    },
    [shouldAutoFocus],
  );

  // ── Queries ────────────────────────────────────────────────────────

  const frequentItemsQuery = useQuery({
    queryKey: [
      "items-frequent",
      currentUser?.username ?? null,
      selectedWarehouseId,
      session?.id ?? null,
    ],
    queryFn: () =>
      getFrequentItems({
        warehouseId: selectedWarehouseId as number,
        sessionId: session?.id ?? null,
        limit: 12,
      }),
    enabled: Boolean(selectedWarehouseId) && Boolean(session) && !Boolean(session?.is_closed),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const recentItemsQuery = useQuery({
    queryKey: [
      "items-recent",
      currentUser?.username ?? null,
      selectedWarehouseId,
      session?.id ?? null,
    ],
    queryFn: () =>
      getRecentItems({
        warehouseId: selectedWarehouseId as number,
        sessionId: session?.id ?? null,
        limit: 12,
      }),
    enabled: Boolean(selectedWarehouseId) && Boolean(session) && !Boolean(session?.is_closed),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const recentEntriesQuery = useQuery({
    queryKey: ["recent-entries", session?.id],
    queryFn: () => getRecentInventoryEntries(session?.id as number, 20),
    enabled: Boolean(session?.id) && (!Boolean(session?.is_closed) || canManageRevision),
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
  });

  const recentEventsQuery = useQuery({
    queryKey: ["recent-events", session?.id],
    queryFn: () => getRecentInventoryEvents(session?.id as number, 25),
    enabled: Boolean(session?.id) && (!Boolean(session?.is_closed) || canManageRevision),
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
  });

  const sessionAuditQuery = useQuery({
    queryKey: ["session-audit", session?.id],
    queryFn: () => getSessionInventoryAudit(session?.id as number, 80),
    enabled: Boolean(session?.id) && Boolean(currentUser),
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const sessionProgressQuery = useQuery({
    queryKey: ["session-progress", session?.id],
    queryFn: () => getSessionInventoryProgress(session?.id as number),
    enabled: Boolean(session?.id),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  // ── Mutations ──────────────────────────────────────────────────────

  const saveEntryMutation = useMutation({
    mutationFn: saveInventoryEntry,
    onSuccess: async (_, variables) => {
      setInlineErrorMessage(null);
      setInlineErrorDebug(null);
      setToastMessage(t("toast.saved"));
      triggerSaveGlow();
      setQty("");
      if (clearSearchAfterSave) {
        setSearchTerm("");
        setDebouncedSearchTerm("");
      }
      setSelectedItem(null);
      setIsDropdownOpen(!clearSearchAfterSave);
      setHighlightedIndex(-1);
      focusInputReliably(searchInputRef);
      clearDraftByKey(draftKey);
      setSnapshotRefetchCounter((c) => c + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recent-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["recent-events", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit-log", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-progress", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["items-frequent"] }),
        queryClient.invalidateQueries({ queryKey: ["items-recent"] }),
      ]);
    },
    onError: (error) => {
      const mapped = mapApiError(error, {
        defaultMessage: t("error.save_failed"),
      });
      setToastMessage(mapped.message);
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const undoMutation = useMutation({
    mutationFn: patchInventoryEntry,
    onSuccess: async (_, variables) => {
      setInlineErrorMessage(null);
      setInlineErrorDebug(null);
      setToastMessage(t("toast.undo_done"));
      setSnapshotRefetchCounter((c) => c + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recent-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["recent-events", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit-log", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-progress", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["items-frequent"] }),
        queryClient.invalidateQueries({ queryKey: ["items-recent"] }),
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.body.includes("SESSION_CLOSED")) {
        queryClient.setQueryData(activeSessionQueryKey, null);
        void queryClient.invalidateQueries({ queryKey: activeSessionQueryKey });
      }
      const mapped = mapApiError(error, {
        defaultMessage: t("error.undo_failed"),
      });
      setToastMessage(mapped.message);
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
    },
  });

  // ── Effects ────────────────────────────────────────────────────────

  // Debounce search
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 150);
    return () => clearTimeout(timeout);
  }, [searchTerm]);

  // Reset search state when warehouse changes
  useEffect(() => {
    if (selectedWarehouseId === null) {
      setSearchTerm("");
      setDebouncedSearchTerm("");
      setSelectedItem(null);
      setQty("");
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
    }
  }, [selectedWarehouseId]);

  // Clear draft on session close
  useEffect(() => {
    if (isClosed) {
      clearDraftByKey(draftKey);
    }
  }, [draftKey, isClosed]);

  // Entries snapshot fetch
  useEffect(() => {
    if (!session?.id || isClosed) {
      setEntriesSnapshot([]);
      return;
    }

    let cancelled = false;
    const sessionId = session.id;

    void (async () => {
      try {
        const cached = await loadEntriesSnapshotCache(sessionId).catch(() => null);
        if (cancelled) return;
        if (cached?.entries) {
          setEntriesSnapshot(cached.entries);
        }

        const fresh = await getSessionEntriesSnapshot(sessionId);
        if (cancelled) return;
        setEntriesSnapshot(fresh);
        await saveEntriesSnapshotCache({
          session_id: sessionId,
          fetched_at: Date.now(),
          entries: fresh,
        }).catch(() => {});
      } catch {
        // Silently fall back to cache
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClosed, session?.id, snapshotRefetchCounter]);

  // Draft restore
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
  }, [draftKey, focusInputReliably, qty, searchTerm, selectedItem, selectedWarehouseId]);

  // Draft persist
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

  // ── Computed from queries ──────────────────────────────────────────

  const frequentOrRecentSuggestions = useMemo(() => {
    const frequentSuggestions = frequentItemsQuery.data ?? [];
    const recentSuggestions = recentItemsQuery.data ?? [];
    const deduped = new Map<number, ItemSearchResult>();
    for (const item of [...frequentSuggestions, ...recentSuggestions]) {
      if (!deduped.has(item.id)) {
        deduped.set(item.id, item);
      }
    }
    return Array.from(deduped.values()).slice(0, 20);
  }, [frequentItemsQuery.data, recentItemsQuery.data]);

  const itemOptions =
    debouncedSearchTerm.trim().length > 0 ? searchResults : frequentOrRecentSuggestions;

  // Sync dropdown highlight with item list
  useEffect(() => {
    if (!isDropdownOpen || itemOptions.length === 0) {
      setHighlightedIndex(-1);
      return;
    }
    if (highlightedIndex >= itemOptions.length) {
      setHighlightedIndex(0);
    }
  }, [itemOptions?.length, isDropdownOpen, highlightedIndex]);

  const frequentItems = (frequentItemsQuery.data ?? []).slice(0, 7);
  const recentItems = (recentItemsQuery.data ?? []).slice(0, 7);

  const selectedUnit = (selectedItem?.unit ?? "").toLowerCase();
  const isWeightUnit = selectedUnit === "kg" || selectedUnit === "l" || selectedUnit === "кг" || selectedUnit === "л";
  const isPiecesUnit = selectedUnit === "pcs" || selectedUnit === "шт";
  const qtyInputMode: React.HTMLAttributes<HTMLInputElement>["inputMode"] = isWeightUnit ? "decimal" : "numeric";
  const hotButtons = isWeightUnit ? ["+0.1", "+0.5", "+1", "+2"] : ["+0.1", "+1", "+2", "+5"];
  const sessionProgress: InventorySessionProgress | undefined = sessionProgressQuery.data;

  // ── Qty validation ─────────────────────────────────────────────────

  const averageQtyForSelectedItem = useMemo(() => {
    if (!selectedItem) return null;

    const events = (sessionAuditQuery.data ?? []).filter(
      (event) => event.item_id === selectedItem.id,
    );
    if (events.length === 0) return null;

    const values = events
      .map((event) => event.after_quantity)
      .filter((value) => Number.isFinite(value) && value > 0);

    if (values.length === 0) return null;

    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
  }, [selectedItem, sessionAuditQuery.data]);

  const qtyValidation = useMemo(() => {
    const minQty = 0.01;
    if (!selectedItem) {
      return {
        normalizedQty: null as number | null,
        error: null as string | null,
        wasRounded: false,
        roundedFrom: null as number | null,
        roundedTo: null as number | null,
        softWarning: null as string | null,
        confirmWarnings: [] as string[],
      };
    }

    const raw = qty.trim();
    if (!raw) {
      return {
        normalizedQty: null,
        error: null,
        wasRounded: false,
        roundedFrom: null,
        roundedTo: null,
        softWarning: null,
        confirmWarnings: [],
      };
    }

    const parsedQty = Number.parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(parsedQty)) {
      return {
        normalizedQty: null,
        error: t("inventory.qty.error_not_number"),
        wasRounded: false,
        roundedFrom: null,
        roundedTo: null,
        softWarning: null,
        confirmWarnings: [],
      };
    }

    if (parsedQty < 0) {
      return {
        normalizedQty: null,
        error: t("inventory.qty.error_negative"),
        wasRounded: false,
        roundedFrom: null,
        roundedTo: null,
        softWarning: null,
        confirmWarnings: [],
      };
    }

    if (parsedQty <= minQty) {
      return {
        normalizedQty: null,
        error: t("inventory.qty.error_positive"),
        wasRounded: false,
        roundedFrom: null,
        roundedTo: null,
        softWarning: null,
        confirmWarnings: [],
      };
    }

    if (isPiecesUnit && !Number.isInteger(parsedQty)) {
      return {
        normalizedQty: null,
        error: t("inventory.qty.error_integer_pcs"),
        wasRounded: false,
        roundedFrom: null,
        roundedTo: null,
        softWarning: null,
        confirmWarnings: [],
      };
    }

    const hardMax = isPiecesUnit ? 99999 : 99999.999;
    if (parsedQty > hardMax) {
      return {
        normalizedQty: null,
        error: t("inventory.qty.error_too_large"),
        wasRounded: false,
        roundedFrom: null,
        roundedTo: null,
        softWarning: null,
        confirmWarnings: [],
      };
    }

    const normalizedQty = parsedQty;
    const wasRounded = false;
    const roundedFrom: number | null = null;
    const roundedTo: number | null = null;

    const confirmWarnings: string[] = [];
    if (selectedItem.max_qty !== null && normalizedQty > selectedItem.max_qty) {
      confirmWarnings.push(`Количество ${normalizedQty} больше max_qty (${selectedItem.max_qty})`);
    }

    const ratio =
      averageQtyForSelectedItem && averageQtyForSelectedItem > 0
        ? normalizedQty / averageQtyForSelectedItem
        : null;
    let softWarning: string | null = null;
    if (ratio !== null && ratio >= 10) {
      confirmWarnings.push(
        `Количество в ${ratio.toFixed(1)} раз выше среднего по товару за сессию`,
      );
    } else if (ratio !== null && ratio >= 5) {
      softWarning = `Необычно: в ${ratio.toFixed(1)} раз выше среднего по товару`;
    }

    return {
      normalizedQty,
      error: null,
      wasRounded,
      roundedFrom,
      roundedTo,
      softWarning,
      confirmWarnings,
    };
  }, [averageQtyForSelectedItem, isPiecesUnit, qty, selectedItem, t]);

  const canSave = Boolean(canSearch && selectedItem && qty.trim().length > 0 && !qtyValidation.error);

  // ── Handlers ───────────────────────────────────────────────────────

  const chooseItem = useCallback(
    (item: ItemSearchResult) => {
      setSelectedItem(item);
      setSearchTerm(item.name);
      setDebouncedSearchTerm(item.name);
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
      focusInputReliably(qtyInputRef, { force: true });
    },
    [focusInputReliably],
  );

  // ── Quick create item from search ──────────────────────────────────

  const quickCreateMutation = useMutation({
    mutationFn: (params: { name: string; unit: string }) =>
      createItem({
        product_code: null,
        name: params.name,
        unit: params.unit,
        warehouse_id: selectedWarehouseId!,
      }),
    onSuccess: (created) => {
      const asSearchResult: ItemSearchResult = {
        id: created.id,
        product_code: created.product_code,
        name: created.name,
        unit: created.unit,
        step: created.step,
        min_qty: created.min_qty,
        max_qty: created.max_qty,
        is_favorite: created.is_favorite,
        warehouse_id: created.warehouse_id,
        station_id: created.station_id,
      };
      // Append to local catalog so it appears in search immediately
      setCatalogItems((prev) =>
        prev
          ? [
              ...prev,
              {
                ...asSearchResult,
                aliases: [],
                updated_at: new Date().toISOString(),
                is_active: true,
              },
            ]
          : prev,
      );
      chooseItem(asSearchResult);
    },
  });

  const handleQuickCreateItem = useCallback(
    (name: string, unit: string) => {
      if (!selectedWarehouseId || quickCreateMutation.isPending) return;
      quickCreateMutation.mutate({ name, unit });
    },
    [selectedWarehouseId, quickCreateMutation],
  );

  const applyHotButton = useCallback((value: string) => {
    const normalized = value.trim().replace(",", ".");
    const deltaText = normalized.startsWith("+") ? normalized.slice(1) : normalized;
    const delta = Number.parseFloat(deltaText);
    if (!Number.isFinite(delta) || delta <= 0) return;

    setQty((previousQty) => {
      const parsed = Number.parseFloat(previousQty.replace(",", "."));
      const next = Number.isFinite(parsed) ? parsed + delta : delta;
      const formatted = Number.isInteger(next) ? String(next) : String(Number(next.toFixed(4)));
      return formatted;
    });
  }, []);

  const prefetchSuggestions = useCallback(async () => {
    if (!selectedWarehouseId || !canSearch || !session?.id || session.is_closed) return;
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ["items-frequent", currentUser?.username ?? null, selectedWarehouseId, session.id],
        queryFn: () =>
          getFrequentItems({ warehouseId: selectedWarehouseId, sessionId: session.id, limit: 12 }),
      }),
      queryClient.prefetchQuery({
        queryKey: ["items-recent", currentUser?.username ?? null, selectedWarehouseId, session.id],
        queryFn: () =>
          getRecentItems({ warehouseId: selectedWarehouseId, sessionId: session.id, limit: 12 }),
      }),
    ]);
  }, [selectedWarehouseId, canSearch, session?.id, session?.is_closed, currentUser?.username, queryClient]);

  const upsertEntriesSnapshotOptimistic = useCallback(
    (snapshotParams: {
      sessionId: number;
      itemId: number;
      qty: number;
      unit: string;
      updatedAt?: string;
    }) => {
      if (!currentUser) return;

      const updatedAt = snapshotParams.updatedAt ?? new Date().toISOString();
      const nextRow: InventoryEntrySnapshotRow = {
        item_id: snapshotParams.itemId,
        qty: snapshotParams.qty,
        unit: snapshotParams.unit,
        updated_at: updatedAt,
        updated_by_user: {
          id: -1,
          username: currentUser.username,
          display_name: currentUser.full_name ?? currentUser.username,
        },
      };

      setEntriesSnapshot((previous) => {
        const idx = previous.findIndex((row) => row.item_id === snapshotParams.itemId);
        const next =
          idx >= 0
            ? previous.map((row, i) => (i === idx ? nextRow : row))
            : [nextRow, ...previous];

        void saveEntriesSnapshotCache({
          session_id: snapshotParams.sessionId,
          fetched_at: Date.now(),
          entries: next,
        }).catch(() => {});

        return next;
      });
    },
    [currentUser],
  );

  const applyOptimisticRecentEvent = useCallback(
    (eventParams: {
      sessionId: number;
      itemId: number;
      itemName: string;
      unit: string;
      quantity: number;
      mode: "add" | "set";
    }) => {
      const actorUsername = currentUser?.username ?? "unknown";
      const actorDisplayName = currentUser?.full_name ?? actorUsername;
      const nowIso = new Date().toISOString();
      const optimisticId = -Date.now();
      queryClient.setQueryData<InventoryEntry[]>(
        ["recent-entries", eventParams.sessionId],
        (previous) => {
          const rows = previous ?? [];
          const idx = rows.findIndex((row) => row.item_id === eventParams.itemId);
          const current = idx >= 0 ? rows[idx] : null;
          const nextQuantity =
            eventParams.mode === "add" ? (current?.quantity ?? 0) + eventParams.quantity : eventParams.quantity;
          const nextRow: InventoryEntry = {
            id: current?.id ?? optimisticId,
            session_id: eventParams.sessionId,
            item_id: eventParams.itemId,
            item_name: eventParams.itemName,
            unit: eventParams.unit,
            quantity: nextQuantity,
            version: current?.version ?? 1,
            updated_at: nowIso,
            station_id: null,
            station_name: null,
            station_department: null,
            counted_outside_zone: false,
            counted_by_zone_id: null,
            counted_by_zone: null,
            outside_zone_note: null,
          };
          if (idx >= 0) {
            return rows.map((row, i) => (i === idx ? nextRow : row));
          }
          return [nextRow, ...rows].slice(0, 20);
        },
      );

      queryClient.setQueryData(
        ["recent-events", eventParams.sessionId],
        (previous: InventoryRecentEvent[] | undefined) => {
          const rows = previous ?? [];
          const beforeQuantity = entriesSnapshotByItemId.get(eventParams.itemId)?.qty ?? 0;
          const afterQuantity =
            eventParams.mode === "add" ? beforeQuantity + eventParams.quantity : eventParams.quantity;
          const optimisticEvent: InventoryRecentEvent = {
            id: optimisticId,
            session_id: eventParams.sessionId,
            item_id: eventParams.itemId,
            item_name: eventParams.itemName,
            unit: eventParams.unit,
            mode: eventParams.mode,
            qty_input: eventParams.quantity,
            qty_delta: afterQuantity - beforeQuantity,
            actor_user_id: -1,
            actor_username: actorUsername,
            actor_display_name: actorDisplayName,
            station_id: null,
            station_name: null,
            station_department: null,
            counted_outside_zone: false,
            counted_by_zone_id: null,
            counted_by_zone: null,
            outside_zone_note: null,
            request_id: null,
            before_quantity: beforeQuantity,
            after_quantity: afterQuantity,
            created_at: nowIso,
          };
          return [optimisticEvent, ...rows].slice(0, 25);
        },
      );
    },
    [currentUser?.full_name, currentUser?.username, entriesSnapshotByItemId, queryClient],
  );

  // ── enqueueEntry ───────────────────────────────────────────────────

  const entriesByItemId = useMemo(() => {
    const map = new Map<number, InventoryEntry>();
    for (const entry of recentEntriesQuery.data ?? []) {
      map.set(entry.item_id, entry);
    }
    return map;
  }, [recentEntriesQuery.data]);

  const enqueueEntry = useCallback(async (enqueueParams: {
    idempotencyKey: string;
    sessionId: number;
    warehouseId: number;
    itemId: number;
    itemName: string;
    unit: string;
    quantity: number;
    mode: "set" | "add";
    stationId: number | null;
  }) => {
    if (isClosed) return;
    const next = await addOfflineEntryQueueItem({
      idempotency_key: enqueueParams.idempotencyKey,
      session_id: enqueueParams.sessionId,
      warehouse_id: enqueueParams.warehouseId,
      item_id: enqueueParams.itemId,
      item_name: enqueueParams.itemName,
      unit: enqueueParams.unit,
      qty: enqueueParams.quantity,
      mode: enqueueParams.mode,
      station_id: enqueueParams.stationId,
      counted_outside_zone: false,
      created_at: new Date().toISOString(),
      retry_count: 0,
      status: "pending",
      next_retry_at: null,
      expected_version:
        enqueueParams.mode === "set"
          ? (entriesByItemId.get(enqueueParams.itemId)?.version ?? null)
          : null,
    });

    const currentQty = entriesSnapshotByItemId.get(enqueueParams.itemId)?.qty ?? 0;
    const nextQty = enqueueParams.mode === "add" ? currentQty + enqueueParams.quantity : enqueueParams.quantity;
    upsertEntriesSnapshotOptimistic({
      sessionId: enqueueParams.sessionId,
      itemId: enqueueParams.itemId,
      qty: nextQty,
      unit: enqueueParams.unit,
    });

    setOfflineQueue(next);
    clearDraftByKey(draftKey);
    setToastMessage(t("toast.queued"));
    setQty("");
    if (clearSearchAfterSave) {
      setSearchTerm("");
      setDebouncedSearchTerm("");
    }
    setSelectedItem(null);
    setIsDropdownOpen(!clearSearchAfterSave);
    setHighlightedIndex(-1);
    focusInputReliably(searchInputRef);
  }, [isClosed, entriesByItemId, entriesSnapshotByItemId, upsertEntriesSnapshotOptimistic, draftKey, clearSearchAfterSave, focusInputReliably, setToastMessage, t]);

  // ── Submit entry (main save handler) ───────────────────────────────

  const submitEntryWithQuantity = useCallback(async (parsedQty: number) => {
    if (!session || !selectedItem || isClosed || saveEntryMutation.isPending) return;
    if (submitLockRef.current) return;

    submitLockRef.current = true;
    try {
      const mode: "set" | "add" = "add";
      const stationId: number | null = null;

      const signature = `${session.id}:${session.warehouse_id}:${selectedItem.id}:${selectedItem.unit}:${mode}:${stationId ?? "null"}:${parsedQty}`;
      const nowMs = Date.now();
      const generateIdempotencyKey = () =>
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      let idempotencyKey = generateIdempotencyKey();
      if (!navigator.onLine) {
        const previous = lastOfflineEnqueueRef.current;
        if (previous && previous.signature === signature && nowMs - previous.createdAtMs < 1500) {
          idempotencyKey = previous.idempotencyKey;
        } else {
          lastOfflineEnqueueRef.current = {
            signature,
            idempotencyKey,
            createdAtMs: nowMs,
          };
        }
      }

      if (!navigator.onLine) {
        await enqueueEntry({
          idempotencyKey,
          sessionId: session.id,
          warehouseId: session.warehouse_id,
          itemId: selectedItem.id,
          itemName: selectedItem.name,
          unit: selectedItem.unit,
          quantity: parsedQty,
          mode,
          stationId,
        });
        const mapped = mapApiError(new ApiRequestError(0, "Network error"));
        setToastMessage(mapped.message);
        setInlineErrorMessage(mapped.inlineMessage);
        setInlineErrorDebug(mapped.debug ?? null);
        return;
      }

      const previousSnapshot = entriesSnapshotByItemId.get(selectedItem.id) ?? null;
      try {
        const currentQty = entriesSnapshotByItemId.get(selectedItem.id)?.qty ?? 0;
        const nextQty = mode === "add" ? currentQty + parsedQty : parsedQty;
        upsertEntriesSnapshotOptimistic({
          sessionId: session.id,
          itemId: selectedItem.id,
          qty: nextQty,
          unit: selectedItem.unit,
        });
        applyOptimisticRecentEvent({
          sessionId: session.id,
          itemId: selectedItem.id,
          itemName: selectedItem.name,
          unit: selectedItem.unit,
          quantity: parsedQty,
          mode,
        });
        setQty("");
        if (clearSearchAfterSave) {
          setSearchTerm("");
          setDebouncedSearchTerm("");
        }
        setSelectedItem(null);
        setIsDropdownOpen(!clearSearchAfterSave);
        setHighlightedIndex(-1);
        focusInputReliably(searchInputRef);
        clearDraftByKey(draftKey);

        await saveEntryMutation.mutateAsync({
          sessionId: session.id,
          itemId: selectedItem.id,
          quantity: parsedQty,
          mode,
          stationId,
          countedOutsideZone: false,
          idempotencyKey,
          timeoutMs: 8000,
        });
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 409) {
          setEntriesSnapshot((prev) => {
            if (!previousSnapshot) {
              return prev.filter((row) => row.item_id !== selectedItem.id);
            }
            const idx = prev.findIndex((row) => row.item_id === selectedItem.id);
            if (idx >= 0) {
              return prev.map((row, i) => (i === idx ? previousSnapshot : row));
            }
            return [previousSnapshot, ...prev];
          });

          const isSessionClosed = error.body.includes("SESSION_CLOSED");
          if (isSessionClosed) {
            queryClient.setQueryData(activeSessionQueryKey, null);
            void queryClient.invalidateQueries({ queryKey: activeSessionQueryKey });
            setToastMessage(t("error.session_closed_save"));
            setInlineErrorMessage(t("error.session_closed_save"));
            setInlineErrorDebug(null);
            return;
          }

          const mapped = mapApiError(error, {
            defaultMessage: "Конфликт: кто-то уже изменил",
          });
          setToastMessage(mapped.message);
          setInlineErrorMessage(mapped.inlineMessage);
          setInlineErrorDebug(mapped.debug ?? null);
          return;
        }

        const shouldQueue =
          !(error instanceof ApiRequestError) ||
          error.status === 0 ||
          error.status === 502 ||
          error.status === 503 ||
          error.status === 504;

        if (!shouldQueue) {
          const mapped = mapApiError(error, {
            defaultMessage: t("error.save_failed"),
          });
          setToastMessage(mapped.message);
          setInlineErrorMessage(mapped.inlineMessage);
          setInlineErrorDebug(mapped.debug ?? null);
          return;
        }

        await enqueueEntry({
          idempotencyKey,
          sessionId: session.id,
          warehouseId: session.warehouse_id,
          itemId: selectedItem.id,
          itemName: selectedItem.name,
          unit: selectedItem.unit,
          quantity: parsedQty,
          mode,
          stationId,
        });
        const mapped = mapApiError(error, {
          defaultMessage: "Нет сети — сохранили в очередь",
          queuedOfflineMessage: "Нет сети — сохранили в очередь",
        });
        setToastMessage(mapped.message);
        setInlineErrorMessage(mapped.inlineMessage);
        setInlineErrorDebug(mapped.debug ?? null);
        saveEntryMutation.reset();
      }
    } finally {
      submitLockRef.current = false;
    }
  }, [
    session, selectedItem, isClosed, saveEntryMutation, enqueueEntry,
    entriesSnapshotByItemId, upsertEntriesSnapshotOptimistic,
    applyOptimisticRecentEvent, clearSearchAfterSave, focusInputReliably,
    draftKey, activeSessionQueryKey, queryClient, setToastMessage,
    setInlineErrorMessage, setInlineErrorDebug, t,
  ]);

  const submitEntry = useCallback(async () => {
    if (!selectedItem) return;
    if (qtyValidation.error || qtyValidation.normalizedQty === null) return;

    if (qtyValidation.confirmWarnings.length > 0) {
      setPendingQtyConfirm({
        normalizedQty: qtyValidation.normalizedQty,
        warnings: qtyValidation.confirmWarnings,
      });
      return;
    }

    if (qtyValidation.wasRounded && qtyValidation.roundedTo !== null) {
      setQty(String(qtyValidation.roundedTo));
      setToastMessage(t("toast.rounded"));
    }

    await submitEntryWithQuantity(qtyValidation.normalizedQty);
  }, [selectedItem, qtyValidation, submitEntryWithQuantity, setToastMessage, t]);

  // ── Search input handlers ──────────────────────────────────────────

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isDropdownOpen || itemOptions.length === 0) {
        if (event.key === "Escape") {
          setIsDropdownOpen(false);
        }
        // Enter with no results and search >= 3 chars: open unit picker for quick create
        if (event.key === "Enter" && searchTerm.trim().length >= 3 && selectedWarehouseId) {
          event.preventDefault();
          setIsDropdownOpen(true);
          setQuickCreateUnitPickerOpen(true);
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) => {
          const next = prev + 1;
          return next >= itemOptions.length ? 0 : next;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => {
          if (prev <= 0) return itemOptions.length - 1;
          return prev - 1;
        });
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const indexToPick = highlightedIndex >= 0 ? highlightedIndex : 0;
        const option = itemOptions[indexToPick];
        if (option) {
          chooseItem(option);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setIsDropdownOpen(false);
        setHighlightedIndex(-1);
      }
    },
    [chooseItem, highlightedIndex, isDropdownOpen, itemOptions, searchTerm, selectedWarehouseId],
  );

  const handleDropdownHover = useCallback((index: number) => {
    setHighlightedIndex(index);
  }, []);

  const handleSearchInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    setSearchTerm(nextValue);
    setSelectedItem(null);
    setIsDropdownOpen(true);
    setQuickCreateUnitPickerOpen(false);
  }, []);

  const handleSearchInputFocus = useCallback(() => {
    void prefetchSuggestions();
    setIsDropdownOpen(true);
  }, [prefetchSuggestions]);

  const handleSearchInputBlur = useCallback(() => {
    setTimeout(() => {
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
    }, 100);
  }, []);

  const handleQtyInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQty(event.target.value);
  }, []);

  const handleChipSelect = useCallback(
    (item: ItemSearchResult) => {
      if (longPressHandledRef.current) {
        longPressHandledRef.current = false;
        return;
      }
      chooseItem(item);
    },
    [chooseItem],
  );

  // ── Recent journal ─────────────────────────────────────────────────

  const recentEvents = useMemo(() => recentEventsQuery.data ?? [], [recentEventsQuery.data]);

  const pendingRecent = useMemo(() => {
    if (!session) return [];
    return offlineQueue
      .filter((entry) => entry.session_id === session.id)
      .sort(
        (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      );
  }, [offlineQueue, session]);

  const formatDateTime = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Almaty",
    }).format(date);
  }, []);

  const formatRelativeGroupLabel = useCallback(
    (value: string) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Недавно";

      const diffMs = Date.now() - date.getTime();
      if (diffMs < 60_000) return "Только что";

      const diffMinutes = Math.floor(diffMs / 60_000);
      if (diffMinutes < 60) {
        const rounded = diffMinutes < 5 ? diffMinutes : Math.floor(diffMinutes / 5) * 5;
        const valueMinutes = Math.max(1, rounded);
        return `${valueMinutes} мин назад`;
      }

      const diffHours = Math.floor(diffMs / 3_600_000);
      if (diffHours < 24) return `${diffHours} ч назад`;

      return formatDateTime(value);
    },
    [formatDateTime],
  );

  const recentJournalEntries = useMemo(() => {
    const pending = pendingRecent.map<RecentJournalEntry>((entry) => ({
      key: `queue-${entry.idempotency_key}`,
      itemId: entry.item_id,
      status: entry.status,
      itemName: entry.item_name,
      quantity: entry.qty,
      unit: entry.unit,
      mode: entry.mode,
      timestamp: entry.created_at,
      countedOutsideZone: entry.counted_outside_zone,
      countedByZone: null,
      stationId: entry.station_id ?? null,
      stationName: null,
      stationDepartment: null,
      isOwnEntry: true,
      queueItem: entry,
    }));

    const saved = recentEvents.map<RecentJournalEntry>((event) => {
      const entry = entriesByItemId.get(event.item_id);
      return {
        key: `saved-event-${event.id}`,
        itemId: event.item_id,
        status: "saved",
        itemName: event.item_name,
        quantity: event.qty_input,
        unit: event.unit,
        mode: event.mode === "add" ? "add" : "set",
        timestamp: event.created_at,
        countedOutsideZone: event.counted_outside_zone,
        countedByZone: event.counted_by_zone,
        stationId: event.station_id,
        stationName: event.station_name,
        stationDepartment: event.station_department,
        actorUsername: event.actor_display_name ?? event.actor_username ?? undefined,
        actorRawUsername: event.actor_username ?? undefined,
        isOwnEntry: Boolean(currentUser?.username && event.actor_username === currentUser.username),
        savedEntry: entry ? { itemId: entry.item_id, version: entry.version, entry } : undefined,
      };
    });

    return [...pending, ...saved]
      .sort(
        (left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
      )
      .slice(0, 25);
  }, [currentUser?.username, entriesByItemId, pendingRecent, recentEvents]);

  const filteredRecentJournalEntries = useMemo(() => {
    if (!recentFilterMine) return recentJournalEntries;
    return recentJournalEntries.filter((row) => row.isOwnEntry);
  }, [recentFilterMine, recentJournalEntries]);

  const groupedRecentJournal = useMemo(() => {
    const groups: RecentJournalGroup[] = [];
    for (const row of filteredRecentJournalEntries) {
      const label = formatRelativeGroupLabel(row.timestamp);
      const last = groups[groups.length - 1];
      if (!last || last.label !== label) {
        groups.push({ label, items: [row] });
      } else {
        last.items.push(row);
      }
    }
    return groups;
  }, [formatRelativeGroupLabel, filteredRecentJournalEntries]);

  // ── Return ─────────────────────────────────────────────────────────

  return {
    // Glow
    saveGlowActive,
    saveGlowKey,

    // Search
    searchTerm,
    debouncedSearchTerm,
    isDropdownOpen,
    highlightedIndex,
    selectedItem,
    itemOptions,
    searchInputRef,

    // Qty
    qty,
    qtyInputRef,
    qtyInputMode,
    qtyValidation,
    hotButtons,
    canSave,
    pendingQtyConfirm,
    setPendingQtyConfirm,

    // Favorites
    favoriteItems,
    frequentItems,
    recentItems,
    favoriteIds,

    // Catalog
    catalogItems,
    catalogLoading,
    catalogLoadError,

    // Entries snapshot
    entriesSnapshotByItemId,

    // Offline / sync
    isOnline,
    syncStatus,
    offlineQueue,
    queueRepairOpen,
    setQueueRepairOpen,

    // Session progress
    sessionProgress,
    sessionProgressLoading: sessionProgressQuery.isLoading,

    // Recent journal
    recentFilterMine,
    setRecentFilterMine,
    recentEventsLoading: recentEventsQuery.isLoading,
    groupedRecentJournal,

    // Save state
    savePending: saveEntryMutation.isPending,

    // Format helpers
    formatDateTime,

    // Handlers
    handleSearchInputChange,
    handleSearchInputFocus,
    handleSearchInputBlur,
    handleSearchKeyDown,
    handleDropdownHover,
    handleQtyInputChange,
    handleChipPointerDown,
    handleChipSelect,
    clearLongPress,
    toggleFavorite,
    toggleFavoriteById,
    chooseItem,
    handleQuickCreateItem,
    quickCreatePending: quickCreateMutation.isPending,
    quickCreateUnitPickerOpen,
    applyHotButton,
    submitEntry,
    submitEntryWithQuantity,
    handleSyncRetry,
    handleDismissConflict,
    handleQueueRetryOne,
    handleQueueDeleteOne,
    handleQueueRetryAllFailed,
  };
}

export type UseFastEntryReturn = ReturnType<typeof useFastEntry>;
