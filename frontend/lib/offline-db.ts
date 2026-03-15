function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function indexedDbSupported(): boolean {
  return isBrowser() && typeof window.indexedDB !== "undefined";
}

export const OFFLINE_DB_NAME = "inventory-offline-db";
export const OFFLINE_DB_VERSION = 2;

export const OFFLINE_QUEUE_STORE = "pending_entries";
export const OFFLINE_CATALOG_STORE = "inventory_catalog";
export const OFFLINE_ENTRIES_SNAPSHOT_STORE = "inventory_entries_snapshot";

const OPEN_TIMEOUT_MS = 3000;

// Reuse a single connection to avoid leaking IDBDatabase handles and
// blocking version-change transactions during HMR reloads.
let _cachedDb: IDBDatabase | null = null;

export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (_cachedDb) {
    try {
      // Quick liveness check — accessing .name on a closed DB throws.
      void _cachedDb.name;
      return Promise.resolve(_cachedDb);
    } catch {
      _cachedDb = null;
    }
  }

  return new Promise((resolve, reject) => {
    if (!indexedDbSupported()) {
      reject(new Error("IndexedDB not supported"));
      return;
    }

    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("IndexedDB open timed out"));
      }
    }, OPEN_TIMEOUT_MS);

    const request = window.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) {
        db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: "idempotency_key" });
      }

      if (!db.objectStoreNames.contains(OFFLINE_CATALOG_STORE)) {
        db.createObjectStore(OFFLINE_CATALOG_STORE, { keyPath: "warehouse_id" });
      }

      if (!db.objectStoreNames.contains(OFFLINE_ENTRIES_SNAPSHOT_STORE)) {
        db.createObjectStore(OFFLINE_ENTRIES_SNAPSHOT_STORE, { keyPath: "session_id" });
      }
    };

    request.onblocked = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error("IndexedDB open blocked by another connection"));
      }
    };

    request.onsuccess = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        const db = request.result;
        // Close cached connection if the browser requests a version change
        // (e.g. another tab opens a newer version).
        db.onversionchange = () => {
          db.close();
          _cachedDb = null;
        };
        _cachedDb = db;
        resolve(db);
      }
    };

    request.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeoutId);
        reject(request.error ?? new Error("IndexedDB open failed"));
      }
    };
  });
}
