import type { InventoryCatalogItem, InventoryEntrySnapshotRow } from "@/lib/api/http";

import {
  indexedDbSupported,
  OFFLINE_CATALOG_STORE,
  OFFLINE_ENTRIES_SNAPSHOT_STORE,
  openOfflineDatabase,
} from "@/lib/offline-db";

export type CatalogCacheRow = {
  warehouse_id: number;
  etag: string | null;
  last_modified: string | null;
  fetched_at: number;
  items: InventoryCatalogItem[];
};

export type EntriesSnapshotCacheRow = {
  session_id: number;
  fetched_at: number;
  entries: InventoryEntrySnapshotRow[];
};

export async function loadCatalogCache(warehouseId: number): Promise<CatalogCacheRow | null> {
  if (!indexedDbSupported()) {
    return null;
  }

  let db: IDBDatabase;
  try {
    db = await openOfflineDatabase();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(OFFLINE_CATALOG_STORE, "readonly");
    const store = tx.objectStore(OFFLINE_CATALOG_STORE);
    const request = store.get(warehouseId);

    request.onsuccess = () => resolve((request.result as CatalogCacheRow) ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function saveCatalogCache(row: CatalogCacheRow): Promise<void> {
  if (!indexedDbSupported()) {
    return;
  }

  let db: IDBDatabase;
  try {
    db = await openOfflineDatabase();
  } catch {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_CATALOG_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));

    const store = tx.objectStore(OFFLINE_CATALOG_STORE);
    store.put(row);
  });
}

export async function loadEntriesSnapshotCache(
  sessionId: number,
): Promise<EntriesSnapshotCacheRow | null> {
  if (!indexedDbSupported()) {
    return null;
  }

  let db: IDBDatabase;
  try {
    db = await openOfflineDatabase();
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(OFFLINE_ENTRIES_SNAPSHOT_STORE, "readonly");
    const store = tx.objectStore(OFFLINE_ENTRIES_SNAPSHOT_STORE);
    const request = store.get(sessionId);

    request.onsuccess = () => resolve((request.result as EntriesSnapshotCacheRow) ?? null);
    request.onerror = () => resolve(null);
  });
}

export async function saveEntriesSnapshotCache(row: EntriesSnapshotCacheRow): Promise<void> {
  if (!indexedDbSupported()) {
    return;
  }

  let db: IDBDatabase;
  try {
    db = await openOfflineDatabase();
  } catch {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_ENTRIES_SNAPSHOT_STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));

    const store = tx.objectStore(OFFLINE_ENTRIES_SNAPSHOT_STORE);
    store.put(row);
  });
}
