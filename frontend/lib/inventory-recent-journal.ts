/**
 * Pure recent-journal derivation logic extracted from useFastEntry.
 *
 * Takes plain data, returns journal entries + grouped structure.
 * No React hooks required.
 */

import type { InventoryEntry } from "@/lib/api/http";
import type { OfflineEntryQueueItem } from "@/lib/offline-entry-queue";
import type { RecentJournalEntry, RecentJournalGroup } from "@/lib/hooks/fast-entry-types";

/** A recent event from the server API. */
export type RecentServerEvent = {
  id: number;
  request_id?: string | null;
  item_id: number;
  item_name: string;
  unit: string;
  qty_input: number;
  mode: string;
  created_at: string;
  counted_outside_zone: boolean;
  counted_by_zone: string | null;
  station_id: number | null;
  station_name: string | null;
  station_department: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
};

/**
 * Build a flat list of recent journal entries by merging pending queue items
 * with server-confirmed events, deduplicating by request_id.
 */
export function buildRecentJournalEntries(
  recentEvents: RecentServerEvent[],
  pendingRecent: OfflineEntryQueueItem[],
  entriesByItemId: Map<number, InventoryEntry>,
  currentUsername: string | null,
): RecentJournalEntry[] {
  const serverRequestIds = new Set<string>();
  for (const event of recentEvents) {
    if (event.request_id) serverRequestIds.add(event.request_id);
  }

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
      isOwnEntry: Boolean(
        currentUsername && event.actor_username === currentUsername,
      ),
      savedEntry: entry
        ? { itemId: entry.item_id, version: entry.version, entry }
        : undefined,
    };
  });

  return [...pending, ...saved]
    .sort(
      (left, right) =>
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
    )
    .slice(0, 25);
}

/**
 * Group flat journal entries by a relative-time label.
 */
export function groupJournalEntries(
  entries: RecentJournalEntry[],
  labelFn: (timestamp: string) => string,
): RecentJournalGroup[] {
  const groups: RecentJournalGroup[] = [];
  for (const row of entries) {
    const label = labelFn(row.timestamp);
    const last = groups[groups.length - 1];
    if (!last || last.label !== label) {
      groups.push({ label, items: [row] });
    } else {
      last.items.push(row);
    }
  }
  return groups;
}

/**
 * Return the set of idempotency keys that the server has confirmed
 * (i.e. a server event's request_id matches a queue item's idempotency_key
 * and the queue item was already synced).
 */
export function findConfirmedQueueKeys(
  recentEvents: RecentServerEvent[],
  offlineQueue: OfflineEntryQueueItem[],
): Set<string> {
  if (recentEvents.length === 0 || offlineQueue.length === 0) {
    return new Set();
  }

  const serverRequestIds = new Set<string>();
  for (const event of recentEvents) {
    if (event.request_id) serverRequestIds.add(event.request_id);
  }

  const confirmed = offlineQueue.filter(
    (item) =>
      item.status === "synced" && serverRequestIds.has(item.idempotency_key),
  );
  return new Set(confirmed.map((i) => i.idempotency_key));
}
