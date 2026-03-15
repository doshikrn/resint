import {
  indexedDbSupported,
  openOfflineDatabase,
  OFFLINE_CATALOG_STORE,
  OFFLINE_ENTRIES_SNAPSHOT_STORE,
} from "@/lib/offline-db";

const BUILD_KEY = "resint-build-id";
const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD_TS ?? "dev";

// Keys safe to clear (caches, not user work)
const CLEARABLE_LS_KEYS = [
  "rr_current_user",
  "inventory-fast-entry-draft-v1",
];

/**
 * Runs on every app mount. Detects a new deployment and clears stale
 * client caches that could cause broken UI.
 *
 * Preserves: pending offline entries, language preference, favorites, iOS prompt state.
 * Clears: user profile cache, drafts, IndexedDB catalog/snapshot, SW asset caches.
 */
export async function healStaleClientState(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    const stored = localStorage.getItem(BUILD_KEY);
    if (stored === CURRENT_BUILD) return;

    console.info("[RESINT] Build change detected, clearing stale caches");

    // 1. Clear safe localStorage keys
    for (const key of CLEARABLE_LS_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }

    // 2. Clear IndexedDB catalog + snapshot (NOT pending_entries — user's offline work)
    if (indexedDbSupported()) {
      try {
        const db = await openOfflineDatabase();
        const stores = [OFFLINE_CATALOG_STORE, OFFLINE_ENTRIES_SNAPSHOT_STORE];
        const tx = db.transaction(stores, "readwrite");
        for (const name of stores) {
          tx.objectStore(name).clear();
        }
        await new Promise<void>((resolve) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        });
      } catch {}
    }

    // 3. Purge SW cached assets directly from main thread.
    // Cannot rely on SW message handler — old SW may not support PURGE_CACHES.
    if (typeof caches !== "undefined") {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith("resint-sw-")).map((k) => caches.delete(k)),
        );
        console.info("[RESINT] Purged SW caches:", keys.filter((k) => k.startsWith("resint-sw-")));
      } catch {}
    }

    // 4. Stamp current build ID
    localStorage.setItem(BUILD_KEY, CURRENT_BUILD);
    console.info("[RESINT] Stale state healed, new build:", CURRENT_BUILD);
  } catch (e) {
    console.warn("[RESINT] healStaleClientState:", e);
  }
}

/**
 * Nuclear option: wipe ALL client state except pending offline entries.
 * Uses only raw browser APIs — no app module imports needed at call time.
 * Safe to call from error boundaries when the app is in an unrecoverable state.
 */
export function nuclearReset(): void {
  if (typeof window === "undefined") return;

  // 1. Preserve pending offline entries (user's unsent work)
  let pending: string | null = null;
  try {
    pending = localStorage.getItem("inventory_pending_entries_v1");
  } catch {}

  // 2. Wipe localStorage
  try {
    localStorage.clear();
  } catch {}

  // 3. Restore protected keys
  if (pending) {
    try {
      localStorage.setItem("inventory_pending_entries_v1", pending);
    } catch {}
  }

  // 4. Clear IndexedDB catalog + snapshot stores (preserve pending_entries store)
  try {
    const req = indexedDB.open("inventory-offline-db");
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction(
          ["inventory_catalog", "inventory_entries_snapshot"],
          "readwrite",
        );
        tx.objectStore("inventory_catalog").clear();
        tx.objectStore("inventory_entries_snapshot").clear();
      } catch {}
      db.close();
    };
  } catch {}

  // 5. Purge all SW caches
  try {
    caches
      .keys()
      .then((keys) => keys.forEach((k) => caches.delete(k)))
      .catch(() => {});
  } catch {}

  // 6. Unregister service workers
  try {
    navigator.serviceWorker
      ?.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
  } catch {}

  // 7. Hard reload after async ops settle
  setTimeout(() => window.location.reload(), 500);
}
