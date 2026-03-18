import { indexedDbSupported, OFFLINE_QUEUE_STORE, openOfflineDatabase } from "@/lib/offline-db";

export type OfflineEntryStatus = "pending" | "syncing" | "failed" | "failed_conflict";

export type OfflineEntryQueueItem = {
  idempotency_key: string;
  session_id: number;
  warehouse_id: number;
  item_id: number;
  item_name: string;
  unit: string;
  qty: number;
  mode: "set" | "add";
  station_id?: number | null;
  counted_outside_zone: boolean;
  created_at: string;
  retry_count: number;
  status: OfflineEntryStatus;
  next_retry_at: number | null;
  expected_version?: number | null;
  error_code?: string | null;
};

const STORAGE_KEY = "inventory_pending_entries_v1";

function dedupeByIdempotencyKey(items: OfflineEntryQueueItem[]): OfflineEntryQueueItem[] {
  const seen = new Set<string>();
  const next: OfflineEntryQueueItem[] = [];

  for (const item of items) {
    const key = item?.idempotency_key;
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }

  return next;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function loadFromLocalStorage(): OfflineEntryQueueItem[] {
  if (!isBrowser()) {
    return [];
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as OfflineEntryQueueItem[];
  } catch {
    return [];
  }
}

function saveToLocalStorage(items: OfflineEntryQueueItem[]): void {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

async function loadFromIndexedDb(): Promise<OfflineEntryQueueItem[]> {
  let db: IDBDatabase;
  try {
    db = await openOfflineDatabase();
  } catch {
    return [];
  }

  return new Promise((resolve) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readonly");
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      const rows = (request.result as OfflineEntryQueueItem[]) ?? [];
      rows.sort(
        (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
      );
      resolve(rows);
    };
    request.onerror = () => resolve([]);
  });
}

async function saveToIndexedDb(items: OfflineEntryQueueItem[]): Promise<void> {
  // openOfflineDatabase failure must propagate so callers know IDB was
  // NOT written and can fall back to localStorage correctly.
  const db = await openOfflineDatabase();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_QUEUE_STORE, "readwrite");
    const store = tx.objectStore(OFFLINE_QUEUE_STORE);
    const clearRequest = store.clear();

    clearRequest.onerror = () => reject(clearRequest.error ?? new Error("IndexedDB clear failed"));
    clearRequest.onsuccess = () => {
      for (const item of items) {
        store.put(item);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function loadOfflineEntryQueue(): Promise<OfflineEntryQueueItem[]> {
  if (!indexedDbSupported()) {
    return loadFromLocalStorage();
  }

  try {
    const idbRows = await loadFromIndexedDb();
    const lsRows = loadFromLocalStorage();

    // Merge both sources by idempotency key.  If IDB missed a write
    // (e.g. openOfflineDatabase failed transiently), the entry may only
    // exist in LS.  Blindly overwriting LS with IDB data would destroy it.
    if (idbRows.length === 0 && lsRows.length === 0) {
      return [];
    }

    const merged = new Map<string, OfflineEntryQueueItem>();
    // LS entries first (lower priority)
    for (const item of lsRows) {
      if (item.idempotency_key) merged.set(item.idempotency_key, item);
    }
    // IDB entries overwrite LS entries (higher priority — fresher status)
    for (const item of idbRows) {
      if (item.idempotency_key) merged.set(item.idempotency_key, item);
    }

    const result = Array.from(merged.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    // Keep LS in sync, but only when the merge produced data
    if (result.length > 0) {
      saveToLocalStorage(result);
    }

    return result;
  } catch {
    return loadFromLocalStorage();
  }
}

export async function addOfflineEntryQueueItem(
  item: OfflineEntryQueueItem,
): Promise<OfflineEntryQueueItem[]> {
  const current = await loadOfflineEntryQueue();
  const exists = current.some((existing) => existing.idempotency_key === item.idempotency_key);
  if (exists) {
    console.debug("[offline-queue] duplicate ignored", { idempotency_key: item.idempotency_key });
    return current;
  }

  const next = dedupeByIdempotencyKey([...current, item]);
  console.info("[offline-queue] enqueue", { key: item.idempotency_key, item_id: item.item_id, total: next.length });
  return updateOfflineEntryQueue(next);
}

export async function updateOfflineEntryQueue(
  items: OfflineEntryQueueItem[],
): Promise<OfflineEntryQueueItem[]> {
  const deduped = dedupeByIdempotencyKey(items);
  let idbOk = false;
  if (indexedDbSupported()) {
    try {
      await saveToIndexedDb(deduped);
      idbOk = true;
    } catch {
      console.warn("[offline-queue] IDB write failed, falling back to LS", { count: deduped.length });
      saveToLocalStorage(deduped);
      return deduped;
    }
  }

  saveToLocalStorage(deduped);
  console.debug("[offline-queue] persisted", { count: deduped.length, idb: idbOk });
  return deduped;
}
