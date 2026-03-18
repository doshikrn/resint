import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";

import {
  ApiRequestError,
  saveInventoryEntry,
  type InventoryEntry,
  type InventoryEntrySnapshotRow,
  type InventoryRecentEvent,
  type ItemSearchResult,
} from "@/lib/api/http";
import { mapApiError } from "@/lib/api/error-mapper";
import { saveEntriesSnapshotCache } from "@/lib/inventory-offline-cache";
import {
  addOfflineEntryQueueItem,
  type OfflineEntryQueueItem,
} from "@/lib/offline-entry-queue";
import { clearDraftByKey } from "@/lib/inventory-draft";
import type { DictionaryKeys } from "@/lib/i18n";

// ─── Types ───────────────────────────────────────────────────────────

// Mirrors CurrentUserLike in use-fast-entry (structural compatibility, no circular import)
type CurrentUserLike = {
  username: string;
  full_name: string | null;
  department: string | null;
  role: string;
  warehouse_id?: number | null;
  default_warehouse_id?: number | null;
};

type PendingQtyConfirm = {
  normalizedQty: number;
  warnings: string[];
};

type QtyValidation = {
  normalizedQty: number | null;
  error: string | null;
  wasRounded: boolean;
  roundedTo: number | null;
  softWarning: string | null;
  confirmWarnings: string[];
};

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Manages the full submission pipeline for fast-entry:
 * - Idempotency-key generation and dedup for rapid offline taps
 * - Online/offline branching (save directly vs. IndexedDB enqueue)
 * - Optimistic snapshot & recent-event cache updates
 * - 409 conflict rollback
 * - Network-error fallback to offline queue
 * - saveEntryMutation lifecycle
 *
 * Extracted from useFastEntry. Single source of truth for all write operations.
 */
export function useEntrySubmit(params: {
  session: { id: number; warehouse_id: number } | null;
  isClosed: boolean;
  selectedItem: ItemSearchResult | null;
  draftKey: string | null;
  qtyValidation: QtyValidation;
  clearSearchAfterSave: boolean;
  activeSessionQueryKey: readonly unknown[];
  entriesSnapshotByItemId: Map<number, InventoryEntrySnapshotRow>;
  entriesByItemId: Map<number, InventoryEntry>;
  setOfflineQueue: (queue: OfflineEntryQueueItem[]) => void;
  focusInputReliably: (ref: RefObject<HTMLInputElement>, options?: { force?: boolean }) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  setSearchTerm: (v: string) => void;
  setDebouncedSearchTerm: (v: string) => void;
  setQty: (v: string) => void;
  setSelectedItem: (item: ItemSearchResult | null) => void;
  setIsDropdownOpen: (v: boolean) => void;
  setHighlightedIndex: (v: number) => void;
  setPendingQtyConfirm: (v: PendingQtyConfirm | null) => void;
  setEntriesSnapshot: Dispatch<SetStateAction<InventoryEntrySnapshotRow[]>>;
  currentUser: CurrentUserLike | null;
  queryClient: QueryClient;
  setToastMessage: (msg: string | null) => void;
  setInlineErrorMessage: (msg: string | null) => void;
  setInlineErrorDebug: (msg: string | null) => void;
  t: (key: DictionaryKeys) => string;
  /** Called after a successful online save — use to trigger glow and increment snapshot counter. */
  onSaveSuccess: () => void;
}) {
  const {
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
    onSaveSuccess,
  } = params;

  const submitLockRef = useRef(false);
  const lastOfflineEnqueueRef = useRef<{
    signature: string;
    idempotencyKey: string;
    createdAtMs: number;
  } | null>(null);

  // ── Optimistic helpers ─────────────────────────────────────────────

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

      setEntriesSnapshot((previous: InventoryEntrySnapshotRow[]) => {
        const idx = previous.findIndex((row: InventoryEntrySnapshotRow) => row.item_id === snapshotParams.itemId);
        const next =
          idx >= 0
            ? previous.map((row: InventoryEntrySnapshotRow, i: number) => (i === idx ? nextRow : row))
            : [nextRow, ...previous];

        void saveEntriesSnapshotCache({
          session_id: snapshotParams.sessionId,
          fetched_at: Date.now(),
          entries: next,
        }).catch(() => {});

        return next;
      });
    },
    [currentUser, setEntriesSnapshot],
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
        (previous: InventoryEntry[] | undefined) => {
          const rows = previous ?? [];
          const idx = rows.findIndex((row: InventoryEntry) => row.item_id === eventParams.itemId);
          const current = idx >= 0 ? rows[idx] : null;
          const nextQuantity =
            eventParams.mode === "add"
              ? (current?.quantity ?? 0) + eventParams.quantity
              : eventParams.quantity;
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
            return rows.map((row: InventoryEntry, i: number) => (i === idx ? nextRow : row));
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
            eventParams.mode === "add"
              ? beforeQuantity + eventParams.quantity
              : eventParams.quantity;
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

  // ── Save mutation ──────────────────────────────────────────────────

  const saveEntryMutation = useMutation({
    mutationFn: saveInventoryEntry,
    onSuccess: async (_data: InventoryEntry, variables: Parameters<typeof saveInventoryEntry>[0]) => {
      setInlineErrorMessage(null);
      setInlineErrorDebug(null);
      setToastMessage(t("toast.saved"));
      onSaveSuccess();
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
    onError: (error: Error) => {
      const mapped = mapApiError(error, {
        defaultMessage: t("error.save_failed"),
      });
      setToastMessage(mapped.message);
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
    },
  });

  // ── enqueueEntry ───────────────────────────────────────────────────

  const enqueueEntry = useCallback(
    async (enqueueParams: {
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
      const nextQty =
        enqueueParams.mode === "add"
          ? currentQty + enqueueParams.quantity
          : enqueueParams.quantity;
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
    },
    [
      isClosed,
      entriesByItemId,
      entriesSnapshotByItemId,
      upsertEntriesSnapshotOptimistic,
      draftKey,
      clearSearchAfterSave,
      focusInputReliably,
      searchInputRef,
      setOfflineQueue,
      setToastMessage,
      t,
      setQty,
      setSearchTerm,
      setDebouncedSearchTerm,
      setSelectedItem,
      setIsDropdownOpen,
      setHighlightedIndex,
    ],
  );

  // ── submitEntryWithQuantity ────────────────────────────────────────

  const submitEntryWithQuantity = useCallback(
    async (parsedQty: number) => {
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
          console.info("[entry-submit] navigator offline, enqueuing", { key: idempotencyKey, item_id: selectedItem.id });
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
          // enqueueEntry already sets toast ("queued") and resets input state.
          // Don't overwrite with a generic network-error message.
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
            setEntriesSnapshot((prev: InventoryEntrySnapshotRow[]) => {
              if (!previousSnapshot) {
                return prev.filter((row: InventoryEntrySnapshotRow) => row.item_id !== selectedItem.id);
              }
              const idx = prev.findIndex((row: InventoryEntrySnapshotRow) => row.item_id === selectedItem.id);
              if (idx >= 0) {
                return prev.map((row: InventoryEntrySnapshotRow, i: number) => (i === idx ? previousSnapshot : row));
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

          const errInfo = error instanceof ApiRequestError
            ? { status: error.status, body: error.body.slice(0, 120) }
            : { message: String(error) };
          console.warn("[entry-submit] online save failed, enqueuing", { key: idempotencyKey, ...errInfo });

          try {
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
          } catch (enqueueError) {
            // If enqueue itself fails (e.g. IndexedDB/localStorage full),
            // keep the optimistic data in the UI and show a clear error.
            console.error("[entry-submit] enqueue failed!", enqueueError);
            const mapped = mapApiError(error, {
              defaultMessage: "Нет сети — сохранили в очередь",
            });
            setToastMessage(mapped.message);
            setInlineErrorMessage(mapped.inlineMessage);
            setInlineErrorDebug(mapped.debug ?? null);
            saveEntryMutation.reset();
            return;
          }
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
    },
    [
      session,
      selectedItem,
      isClosed,
      saveEntryMutation,
      enqueueEntry,
      entriesSnapshotByItemId,
      upsertEntriesSnapshotOptimistic,
      applyOptimisticRecentEvent,
      clearSearchAfterSave,
      focusInputReliably,
      searchInputRef,
      draftKey,
      activeSessionQueryKey,
      queryClient,
      setToastMessage,
      setInlineErrorMessage,
      setInlineErrorDebug,
      t,
      setQty,
      setSearchTerm,
      setDebouncedSearchTerm,
      setSelectedItem,
      setIsDropdownOpen,
      setHighlightedIndex,
      setEntriesSnapshot,
    ],
  );

  // ── submitEntry ────────────────────────────────────────────────────

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
  }, [selectedItem, qtyValidation, submitEntryWithQuantity, setPendingQtyConfirm, setQty, setToastMessage, t]);

  return {
    enqueueEntry,
    submitEntryWithQuantity,
    submitEntry,
    savePending: saveEntryMutation.isPending,
  };
}
