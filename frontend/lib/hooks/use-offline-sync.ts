import { useCallback, useEffect, useRef, useState } from "react";
import { type QueryClient } from "@tanstack/react-query";
import type { DictionaryKeys } from "@/lib/i18n";

import { ApiRequestError, saveInventoryEntry } from "@/lib/api/http";
import { probeBackendHealth } from "@/lib/api/request";
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
  t: (key: DictionaryKeys) => string;
  onSyncSuccess?: () => void;
}) {
  const { activeSessionQueryKey, queryClient, setToastMessage, t, onSyncSuccess } = params;

  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueue, setOfflineQueue] = useState<OfflineEntryQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [offlineQueueLoaded, setOfflineQueueLoaded] = useState(false);

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

    // ── Backend connectivity gate ────────────────────────────────────
    // navigator.onLine only means the NIC has a link — it does NOT
    // guarantee the API is reachable.  Probe the backend first;
    // if it's unreachable, skip sync entirely so queued items stay
    // visible and are never removed prematurely.
    console.info("[offline-sync] probing backend…");
    const backendUp = await probeBackendHealth(4000);
    if (!backendUp) {
      console.info("[offline-sync] probe failed — backend not reachable, skipping sync");
      return;
    }
    console.info("[offline-sync] probe OK — backend reachable");

    let snapshot: Awaited<ReturnType<typeof loadOfflineEntryQueue>>;
    try {
      snapshot = await loadOfflineEntryQueue();
    } catch {
      console.warn("[offline-sync] loadOfflineEntryQueue threw, aborting sync");
      return;
    }
    if (snapshot.length === 0) {
      console.info("[offline-sync] storage empty, clearing React queue state");
      setOfflineQueue([]);
      return;
    }

    isSyncingQueueRef.current = true;
    setIsSyncing(true);

    // Cancel any in-flight TanStack Query refetches for recent data.
    // Awaited (not fire-and-forget) so the cancellation completes
    // before we start POSTing entries.
    const qc = queryClientRef.current;
    await Promise.all([
      qc.cancelQueries({ queryKey: ["recent-entries"] }),
      qc.cancelQueries({ queryKey: ["recent-events"] }),
    ]);

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
    const syncedKeys: string[] = [];

    console.info("[offline-sync] sync start", { items: snapshot.length });

    try {
      for (const item of snapshot) {
        if (item.status === "failed_conflict") {
          nextQueue.push(item);
          continue;
        }
        // Items already marked synced (from a previous interrupted cycle)
        // don't need to be re-sent — just carry them forward for
        // confirmation after invalidateQueries.
        if (item.status === "synced") {
          nextQueue.push(item);
          syncedKeys.push(item.idempotency_key);
          sentCount += 1; // count as sent so invalidateQueries runs
          continue;
        }
        if (item.next_retry_at && item.next_retry_at > now) {
          nextQueue.push(item);
          continue;
        }

        try {
          console.info("[offline-sync] sending", { key: item.idempotency_key, item_id: item.item_id });
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
          console.info("[offline-sync] sent OK", { key: item.idempotency_key });
          sentCount += 1;
          syncedKeys.push(item.idempotency_key);
          // Keep in queue as "synced" — will be removed ONLY after
          // invalidateQueries confirms the server data is in the TQ cache.
          // This prevents the entry vanishing if the refetch fails.
          nextQueue.push({ ...item, status: "synced" as const });
        } catch (error) {
          const errInfo = error instanceof ApiRequestError
            ? { status: error.status, body: error.body.slice(0, 200) }
            : { message: String(error) };
          console.warn("[offline-sync] send failed", { key: item.idempotency_key, ...errInfo });

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

      // Persist queue WITH "synced" items — this is the safety net.
      // If the browser refreshes or the component remounts before
      // invalidateQueries finishes, the "synced" items are still in
      // storage and will be carried forward on the next sync cycle.
      await updateOfflineEntryQueue(nextQueue);
      console.info("[offline-sync] persisted queue", { total: nextQueue.length, syncedKeys });

      if (sentCount > 0) {
        console.info("[offline-sync] synced", { sentCount, conflictCount, remaining: nextQueue.length });
        onSyncSuccessRef.current?.();
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

        // Synced items are NOT removed here.  The journal derives
        // its view by deduplicating queue items against server events
        // (matching idempotency_key ↔ request_id).  An auto-purge
        // effect in use-fast-entry removes confirmed items from IDB/LS
        // once the server event is observed, decoupling queue safety
        // from invalidateQueries timing.

        if (conflictCount === 0) {
          setToastMessageRef.current(tRef.current("toast.synced"));
        }
      }

      if (conflictCount > 0) {
        setToastMessageRef.current(tRef.current("toast.conflict"));
      }

      setOfflineQueue(nextQueue);
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
      } finally {
        setOfflineQueueLoaded(true);
      }
      void syncOfflineQueue();
    })();

    const onOnline = () => {
      console.info("[offline-sync] online event — delaying 1.5 s for network to stabilise");
      setIsOnline(true);
      // Small delay: the `online` event fires the instant the NIC has
      // a link, but DNS/TCP/TLS may not be ready yet.  The probe in
      // syncOfflineQueue will still gate on actual reachability, but
      // waiting briefly avoids a wasted probe-fail cycle.
      setTimeout(() => void syncOfflineQueue(), 1500);
    };
    const onOffline = () => {
      console.info("[offline-sync] offline event");
      setIsOnline(false);
    };

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
    offlineQueueLoaded,
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
