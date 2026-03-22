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
  type InventoryEntry,
  type InventoryEntrySnapshotRow,
  type InventorySessionProgress,
  type ItemSearchResult,
} from "@/lib/api/http";
import { mapApiError } from "@/lib/api/error-mapper";
import { loadEntriesSnapshotCache, saveEntriesSnapshotCache } from "@/lib/inventory-offline-cache";
import { invalidateInventorySessionQueries } from "@/lib/inventory-query-invalidation";
import { updateOfflineEntryQueue } from "@/lib/offline-entry-queue";
import { useLanguage } from "@/lib/i18n/language-provider";
import { useSuccessGlow } from "@/lib/hooks/use-success-glow";
import { useFavorites } from "@/lib/hooks/use-favorites";
import { useOfflineSync } from "@/lib/hooks/use-offline-sync";
import { useCatalogFetch } from "@/lib/hooks/use-catalog-fetch";
import { useDraft } from "@/lib/hooks/use-draft";
import { useEntrySubmit } from "@/lib/hooks/use-entry-submit";
import type {
  CurrentUserLike,
  PendingQtyConfirm,
  RecentJournalEntry,
  RecentJournalGroup,
  UseFastEntryParams,
} from "@/lib/hooks/fast-entry-types";

export type { CurrentUserLike, RecentJournalEntry, RecentJournalGroup, UseFastEntryParams };

const SEARCH_DEBOUNCE_MS = 150;
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Almaty",
});

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
  const recentFilterStorageKey = useMemo(
    () =>
      `inventory_recent_filter_mine_v1:${currentUser?.username ?? "anon"}:${selectedWarehouseId ?? "none"}`,
    [currentUser?.username, selectedWarehouseId],
  );

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
  const [recentFilterMine, setRecentFilterMine] = useState(false);

  // ── Refs ───────────────────────────────────────────────────────────
  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

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
    offlineQueue,
    offlineQueueLoaded,
    setOfflineQueue,
    syncStatus,
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
    searchResults,
  } = useCatalogFetch({ session, isClosed, inventoryView, debouncedSearchTerm, warehouseId: selectedWarehouseId, t });

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

  const offlineQueueRef = useRef(offlineQueue);
  offlineQueueRef.current = offlineQueue;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

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

  // ── Draft management ───────────────────────────────────────────────

  const { draftKey } = useDraft({
    currentUsername: currentUser?.username,
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
  });

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
    // Disable automatic refetch on reconnect — the offline-sync hook
    // handles invalidation AFTER queued entries are saved, preventing
    // a race where the server returns data without the queued entry.
    refetchOnReconnect: false,
  });

  const recentEventsQuery = useQuery({
    queryKey: ["recent-events", session?.id],
    queryFn: () => getRecentInventoryEvents(session?.id as number, 25),
    enabled: Boolean(session?.id) && (!Boolean(session?.is_closed) || canManageRevision),
    staleTime: 10_000,
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  // ── Mutations ──────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const undoMutation = useMutation({
    mutationFn: patchInventoryEntry,
    onSuccess: async (_, variables) => {
      setInlineErrorMessage(null);
      setInlineErrorDebug(null);
      setToastMessage(t("toast.undo_done"));
      setSnapshotRefetchCounter((c) => c + 1);
      await invalidateInventorySessionQueries({
        queryClient,
        sessionId: variables.sessionId,
        activeSessionQueryKey,
      });
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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.localStorage.getItem(recentFilterStorageKey);
    if (raw === "mine") {
      setRecentFilterMine(true);
      return;
    }
    if (raw === "all") {
      setRecentFilterMine(false);
      return;
    }

    setRecentFilterMine(false);
  }, [recentFilterStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(recentFilterStorageKey, recentFilterMine ? "mine" : "all");
  }, [recentFilterMine, recentFilterStorageKey]);

  // Debounce search
  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, SEARCH_DEBOUNCE_MS);
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

  const mergePendingQueueIntoSnapshot = useCallback(
    (baseRows: InventoryEntrySnapshotRow[]) => {
      const activeSessionId = session?.id;
      if (!activeSessionId) {
        return baseRows;
      }

      const rowsByItemId = new Map<number, InventoryEntrySnapshotRow>();
      for (const row of baseRows) {
        rowsByItemId.set(row.item_id, row);
      }

      const queueForSession = offlineQueueRef.current
        .filter((item) => item.session_id === activeSessionId)
        .sort(
          (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
        );

      for (const item of queueForSession) {
        const previous = rowsByItemId.get(item.item_id);
        const nextQty = item.mode === "add" ? (previous?.qty ?? 0) + item.qty : item.qty;
        rowsByItemId.set(item.item_id, {
          item_id: item.item_id,
          qty: nextQty,
          unit: item.unit,
          updated_at: item.created_at,
          updated_by_user: previous?.updated_by_user ?? {
            id: -1,
            username: currentUserRef.current?.username ?? "offline",
            display_name:
              currentUserRef.current?.full_name ?? currentUserRef.current?.username ?? "offline",
          },
        });
      }

      return Array.from(rowsByItemId.values()).sort(
        (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
      );
    },
    [session?.id],
  );

  const refetchEntriesSnapshot = useCallback(
    async (options?: { hydrateFromCache?: boolean }) => {
      if (!session?.id || isClosed || !offlineQueueLoaded) {
        setEntriesSnapshot([]);
        return;
      }

      const sessionId = session.id;
      const hydrateFromCache = options?.hydrateFromCache ?? false;

      if (hydrateFromCache) {
        const cached = await loadEntriesSnapshotCache(sessionId).catch(() => null);
        if (cached?.entries) {
          setEntriesSnapshot(mergePendingQueueIntoSnapshot(cached.entries));
        }
      }

      try {
        const fresh = await getSessionEntriesSnapshot(sessionId);
        const merged = mergePendingQueueIntoSnapshot(fresh);
        setEntriesSnapshot(merged);
        await saveEntriesSnapshotCache({
          session_id: sessionId,
          fetched_at: Date.now(),
          entries: merged,
        }).catch(() => {});
      } catch {
        // Keep last snapshot/cache on transient failures.
      }
    },
    [isClosed, mergePendingQueueIntoSnapshot, offlineQueueLoaded, session?.id],
  );

  useEffect(() => {
    if (!session?.id || isClosed) {
      setEntriesSnapshot([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      if (cancelled) return;
      await refetchEntriesSnapshot({ hydrateFromCache: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [isClosed, refetchEntriesSnapshot, session?.id, snapshotRefetchCounter]);

  useEffect(() => {
    if (!session?.id || isClosed || !offlineQueueLoaded || typeof window === "undefined") {
      return;
    }

    const handleRefresh = () => {
      void invalidateInventorySessionQueries({
        queryClient,
        sessionId: session.id,
        activeSessionQueryKey,
      });
      void refetchEntriesSnapshot();
    };

    const intervalId = window.setInterval(handleRefresh, 10_000);
    window.addEventListener("focus", handleRefresh);
    window.addEventListener("online", handleRefresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleRefresh);
      window.removeEventListener("online", handleRefresh);
    };
  }, [activeSessionQueryKey, isClosed, offlineQueueLoaded, queryClient, refetchEntriesSnapshot, session?.id]);

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

  const frequentItems = useMemo(() => (frequentItemsQuery.data ?? []).slice(0, 7), [frequentItemsQuery.data]);
  const recentItems = useMemo(() => (recentItemsQuery.data ?? []).slice(0, 7), [recentItemsQuery.data]);

  const selectedUnit = (selectedItem?.unit ?? "").toLowerCase();
  const isWeightUnit = selectedUnit === "kg" || selectedUnit === "l" || selectedUnit === "кг" || selectedUnit === "л";
  const isPiecesUnit = selectedUnit === "pcs" || selectedUnit === "шт";
  const qtyInputMode: React.HTMLAttributes<HTMLInputElement>["inputMode"] = isWeightUnit ? "decimal" : "numeric";
  const hotButtons = useMemo(
    () => (isWeightUnit ? ["+0.1", "+0.5", "+1", "+2"] : ["+0.1", "+1", "+2", "+5"]),
    [isWeightUnit],
  );
  const sessionProgress: InventorySessionProgress | undefined = sessionProgressQuery.data;
  const displayedSessionProgress = useMemo(() => {
    let myLocalCount = 0;
    let latestLocalActivity: string | null = null;
    for (const row of entriesSnapshot) {
      if (row.updated_by_user.username === currentUser?.username) {
        myLocalCount += 1;
      }
      if (latestLocalActivity === null || row.updated_at > latestLocalActivity) {
        latestLocalActivity = row.updated_at;
      }
    }

    const totalCountedItems = Math.max(sessionProgress?.total_counted_items ?? 0, entriesSnapshot.length);
    const myCountedItems = Math.max(sessionProgress?.my_counted_items ?? 0, myLocalCount);
    const lastActivityAt = latestLocalActivity ?? sessionProgress?.last_activity_at ?? null;

    if (!session?.id) {
      return sessionProgress;
    }

    return {
      session_id: session.id,
      warehouse_id: session.warehouse_id,
      status: sessionProgress?.status ?? session.status,
      is_session_closed: sessionProgress?.is_session_closed ?? session.is_closed,
      total_counted_items: totalCountedItems,
      my_counted_items: myCountedItems,
      last_activity_at: lastActivityAt,
    } satisfies InventorySessionProgress;
  }, [currentUser?.username, entriesSnapshot, session?.id, session?.is_closed, session?.status, session?.warehouse_id, sessionProgress]);

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

  const entriesByItemId = useMemo(() => {
    const map = new Map<number, InventoryEntry>();
    for (const entry of recentEntriesQuery.data ?? []) {
      map.set(entry.item_id, entry);
    }
    return map;
  }, [recentEntriesQuery.data]);

  // ── Submission pipeline ────────────────────────────────────────────

  const { submitEntryWithQuantity, submitEntry, savePending } = useEntrySubmit({
    session,
    isClosed,
    selectedItem,
    draftKey,
    qtyValidation,
    clearSearchAfterSave,
    activeSessionQueryKey,
    entriesSnapshotByItemId,
    entriesByItemId,
    setOfflineQueue,
    focusInputReliably,
    searchInputRef,
    setSearchTerm,
    setDebouncedSearchTerm,
    setQty,
    setSelectedItem,
    setIsDropdownOpen,
    setHighlightedIndex,
    setPendingQtyConfirm,
    setEntriesSnapshot,
    currentUser,
    queryClient,
    setToastMessage,
    setInlineErrorMessage,
    setInlineErrorDebug,
    t,
    onSaveSuccess: () => {
      triggerSaveGlow();
      setSnapshotRefetchCounter((c) => c + 1);
    },
  });

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
    [chooseItem, longPressHandledRef],
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
    return DATE_TIME_FORMATTER.format(date);
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
    // Build a set of server-confirmed request IDs so we can dedup
    // queue items whose server event has already arrived.
    const serverRequestIds = new Set<string>();
    for (const event of recentEvents) {
      if (event.request_id) serverRequestIds.add(event.request_id);
    }

    // Only show queue items the server hasn't confirmed yet.
    const pending = pendingRecent
      .filter((entry) => !serverRequestIds.has(entry.idempotency_key))
      .map<RecentJournalEntry>((entry) => ({
        key: `queue-${entry.idempotency_key}`,
        itemId: entry.item_id,
        status: entry.status === "synced" ? "syncing" : entry.status,
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

  // ── Auto-purge confirmed queue items ───────────────────────────────
  // When server events arrive with a request_id matching a queue item's
  // idempotency_key, that item is confirmed server-side.  Remove it
  // from IDB/LS so the queue stays clean.  The journal dedup above
  // already hides these items visually, so this is purely a storage
  // cleanup — no entry ever disappears from the journal.
  useEffect(() => {
    if (recentEvents.length === 0 || offlineQueue.length === 0) return;

    const serverRequestIds = new Set<string>();
    for (const event of recentEvents) {
      if (event.request_id) serverRequestIds.add(event.request_id);
    }

    const confirmed = offlineQueue.filter(
      (item) => item.status === "synced" && serverRequestIds.has(item.idempotency_key),
    );
    if (confirmed.length === 0) return;

    const confirmedKeys = new Set(confirmed.map((i) => i.idempotency_key));
    const cleaned = offlineQueue.filter((i) => !confirmedKeys.has(i.idempotency_key));

    console.info("[fast-entry] auto-purge confirmed queue items", {
      removed: Array.from(confirmedKeys),
      remaining: cleaned.length,
    });
    setOfflineQueue(cleaned);
    void updateOfflineEntryQueue(cleaned);
  }, [recentEvents, offlineQueue, setOfflineQueue]);

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
    sessionProgress: displayedSessionProgress,
    sessionProgressLoading: sessionProgressQuery.isLoading,

    // Recent journal
    recentFilterMine,
    setRecentFilterMine,
    recentEventsLoading: recentEventsQuery.isLoading,
    groupedRecentJournal,

    // Save state
    savePending,

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
