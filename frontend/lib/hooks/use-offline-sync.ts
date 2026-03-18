import { useCallback, useEffect, useRef, useState } from "react";
import { type QueryClient } from "@tanstack/react-query";

import { ApiRequestError, saveInventoryEntry } from "@/lib/api/http";
import {
  loadOfflineEntryQueue,
  updateOfflineEntryQueue,
  type OfflineEntryQueueItem,
} from "@/lib/offline-entry-queue";
import type { SyncStatus } from "@/components/inventory/sync-status-indicator";

// ─── Hook ────────────────────────────────────────────────────────────

/**
 * Manages offline queue state: online/offline detection, periodic sync,
 * conflict/retry queue handlers.
 *
 * Extracted from useFastEntry. No dependency on catalog, favorites, or draft state.
 *
 * @param onSyncSuccess - Called after at least one item is successfully synced.
 *   Use this to increment a snapshot refetch counter in the parent.
 */
export function useOfflineSync(params: {
  activeSessionQueryKey: readonly unknown[];
  queryClient: QueryClient;
  setToastMessage: (msg: string | null) => void;
  t: (key: string) => string;
  onSyncSuccess?: () => void;
}) {
  const { activeSessionQueryKey, queryClient, setToastMessage, t, onSyncSuccess } = params;

  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState<OfflineEntryQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const isSyncingQueueRef = useRef(false);

  // ── Stable refs for props that may change reference between renders ──
  // Without refs, syncOfflineQueue is recreated on every render when callers
  // pass a new array literal or inline function, which causes the main
  // useEffect to re-run, re-attach listeners (missing events in the gap),
  // and restart the periodic sync timer (so it never fires).
  const onSyncSuccessRef = useRef(onSyncSuccess);
  onSyncSuccessRef.current = onSyncSuccess;

  const activeSessionQueryKeyRef = useRef(activeSessionQueryKey);
  activeSessionQueryKeyRef.current = activeSessionQueryKey;

  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const setToastMessageRef = useRef(setToastMessage);
  setToastMessageRef.current = setToastMessage;

  const tRef = useRef(t);
  tRef.current = t;

  // ── Sync callback ──────────────────────────────────────────────────

  const syncOfflineQueue = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine || isSyncingQueueRef.current) return;

    let snapshot: Awaited<ReturnType<typeof loadOfflineEntryQueue>>;
    try {
      snapshot = await loadOfflineEntryQueue();
    } catch {
      return;
    }
    if (snapshot.length === 0) {
      setOfflineQueue([]);
      return;
    }

    isSyncingQueueRef.current = true;
    setIsSyncing(true);

    const now = Date.now();
    setOfflineQueue(
      snapshot.map((item) =>
        item.status === "failed_conflict" || (item.next_retry_at && item.next_retry_at > now)
          ? item
          : { ...item, status: "syncing" as const },
      ),
    );

    const nextQueue: OfflineEntryQueueItem[] = [];
    let sentCount = 0;
    let conflictCount = 0;

    try {
      for (const item of snapshot) {
        if (item.status === "failed_conflict") {
          nextQueue.push(item);
          continue;
        }
        if (item.next_retry_at && item.next_retry_at > now) {
          nextQueue.push(item);
          continue;
        }

        try {
          await saveInventoryEntry({
            sessionId: item.session_id,
            itemId: item.item_id,
            quantity: item.qty,
            mode: item.mode,
            stationId: item.station_id ?? null,
            countedOutsideZone: false,
            idempotencyKey: item.idempotency_key,
            timeoutMs: 8000,
            expectedVersion: item.mode === "set" ? (item.expected_version ?? null) : null,
          });
          sentCount += 1;
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 409) {
            if (error.body.includes("VERSION_CONFLICT")) {
              nextQueue.push({
                ...item,
                status: "failed_conflict",
                next_retry_at: null,
                error_code: "conflict",
              });
              conflictCount += 1;
              continue;
            }

            if (error.body.includes("SESSION_CLOSED")) {
              queryClientRef.current.setQueryData(activeSessionQueryKeyRef.current, null);
              void queryClientRef.current.invalidateQueries({ queryKey: activeSessionQueryKeyRef.current });
              nextQueue.push({
                ...item,
                status: "failed",
                next_retry_at: null,
                error_code: "session_closed",
              });
              conflictCount += 1;
              continue;
            }
            if (error.body.includes("ACCESS_DENIED") || error.body.includes("FORBIDDEN")) {
              nextQueue.push({
                ...item,
                status: "failed",
                next_retry_at: null,
                error_code: "access_denied",
              });
              conflictCount += 1;
              continue;
            }
            // Unknown 409 — keep in queue so the user can review it rather
            // than silently dropping the entry.
            nextQueue.push({
              ...item,
              status: "failed_conflict",
              next_retry_at: null,
              error_code: "conflict_unknown",
            });
            conflictCount += 1;
            continue;
          }

          const isNetwork =
            error instanceof ApiRequestError ? error.status === 0 : !(error instanceof ApiRequestError);
          const errorCode: string = isNetwork
            ? "network"
            : error instanceof ApiRequestError && error.status === 403
              ? "access_denied"
              : "unknown";
          const retryCount = item.retry_count + 1;
          const delayMs = Math.min(120000, Math.pow(2, item.retry_count) * 2000);
          nextQueue.push({
            ...item,
            retry_count: retryCount,
            status: "failed",
            next_retry_at: Date.now() + delayMs,
            error_code: errorCode,
          });
        }
      }

      await updateOfflineEntryQueue(nextQueue);
      setOfflineQueue(nextQueue);

      if (sentCount > 0) {
        onSyncSuccessRef.current?.();
        const qc = queryClientRef.current;
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["recent-entries"] }),
          qc.invalidateQueries({ queryKey: ["recent-events"] }),
          qc.invalidateQueries({ queryKey: ["session-entries"] }),
          qc.invalidateQueries({ queryKey: ["session-audit"] }),
          qc.invalidateQueries({ queryKey: ["session-audit-log"] }),
          qc.invalidateQueries({ queryKey: ["session-progress"] }),
          qc.invalidateQueries({ queryKey: ["items-frequent"] }),
          qc.invalidateQueries({ queryKey: ["items-recent"] }),
        ]);
        if (conflictCount === 0) {
          setToastMessageRef.current(tRef.current("toast.synced"));
        }
      }

      if (conflictCount > 0) {
        setToastMessageRef.current(tRef.current("toast.conflict"));
      }
    } finally {
      isSyncingQueueRef.current = false;
      setIsSyncing(false);
    }
  // All changing deps are read via refs — empty deps keeps the function
  // identity stable so the useEffect below runs exactly once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSyncRetry = useCallback(() => {
    void syncOfflineQueue();
  }, [syncOfflineQueue]);

  // ── Effects ────────────────────────────────────────────────────────

  // Online/offline listeners + initial queue load + immediate sync.
  // syncOfflineQueue is now identity-stable (empty deps) so this effect
  // runs exactly once on mount — no listener gaps, no load/sync races.
  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);

    // Load the persisted queue first, THEN attempt a sync.
    // Sequential execution prevents the old race where a parallel sync
    // could clear IDB while the load was still reading from it.
    void (async () => {
      try {
        setOfflineQueue(await loadOfflineEntryQueue());
      } catch {
        setOfflineQueue([]);
      }
      void syncOfflineQueue();
    })();

    const onOnline = () => {
      setIsOnline(true);
      void syncOfflineQueue();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // syncOfflineQueue is identity-stable (empty useCallback deps + refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic sync while queue is non-empty
  useEffect(() => {
    if (offlineQueue.length === 0) return;
    const interval = window.setInterval(() => {
      void syncOfflineQueue();
    }, 12000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineQueue.length]);

  // ── Derived ────────────────────────────────────────────────────────

  const syncStatus: SyncStatus = !isOnline
    ? "offline"
    : isSyncing
      ? "syncing"
      : offlineQueue.some((item: OfflineEntryQueueItem) => item.status === "failed" || item.status === "failed_conflict")
        ? "error"
        : "online";

  // ── Queue action handlers ──────────────────────────────────────────

  const handleDismissConflict = useCallback(
    async (entryKey: string) => {
      const idempotencyKey = entryKey.replace(/^queue-/, "");
      const next = await updateOfflineEntryQueue(
        offlineQueue.filter((item: OfflineEntryQueueItem) => item.idempotency_key !== idempotencyKey),
      );
      setOfflineQueue(next);
    },
    [offlineQueue],
  );

  const handleQueueRetryOne = useCallback(
    async (idempotencyKey: string) => {
      const next = await updateOfflineEntryQueue(
        offlineQueue.map((item: OfflineEntryQueueItem) =>
          item.idempotency_key === idempotencyKey
            ? {
                ...item,
                status: "pending" as const,
                retry_count: 0,
                next_retry_at: null,
                error_code: null,
              }
            : item,
        ),
      );
      setOfflineQueue(next);
      void syncOfflineQueue();
    },
    [offlineQueue, syncOfflineQueue],
  );

  const handleQueueDeleteOne = useCallback(
    async (idempotencyKey: string) => {
      const next = await updateOfflineEntryQueue(
        offlineQueue.filter((item: OfflineEntryQueueItem) => item.idempotency_key !== idempotencyKey),
      );
      setOfflineQueue(next);
    },
    [offlineQueue],
  );

  const handleQueueRetryAllFailed = useCallback(async () => {
    const next = await updateOfflineEntryQueue(
      offlineQueue.map((item: OfflineEntryQueueItem) =>
        item.status === "failed"
          ? {
              ...item,
              status: "pending" as const,
              retry_count: 0,
              next_retry_at: null,
              error_code: null,
            }
          : item,
      ),
    );
    setOfflineQueue(next);
    void syncOfflineQueue();
  }, [offlineQueue, syncOfflineQueue]);

  return {
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
  };
}
