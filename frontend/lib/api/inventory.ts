import { API_ROUTES } from "@/lib/api/client";
import { apiRequest, ApiRequestError, apiGetWithResponse, toProxyUrl, parseFilenameFromContentDisposition } from "@/lib/api/request";
import type {
  InventoryCatalogItem,
  InventoryEntry,
  InventoryEntryEvent,
  InventoryEntrySnapshotRow,
  InventoryItemContributors,
  InventoryParticipantsSummary,
  InventoryRecentEvent,
  InventorySession,
  InventorySessionEvent,
  InventorySessionListItem,
  InventorySessionProgress,
  InventoryZoneProgress,
  AuditLogEntry,
} from "@/lib/api/types";

export async function getOrCreateActiveSession(warehouseId: number, createIfMissing = true) {
  return apiRequest<InventorySession>(API_ROUTES.inventory.activeSession, {
    method: "POST",
    body: {
      warehouse_id: warehouseId,
      create_if_missing: createIfMissing,
    },
  });
}

export async function createInventorySession(warehouseId: number) {
  return apiRequest<InventorySession>(API_ROUTES.inventory.createSession, {
    method: "POST",
    body: { warehouse_id: warehouseId },
  });
}

export async function listInventorySessions(params?: {
  warehouseId?: number | null;
  includeDeleted?: boolean;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params?.warehouseId !== null && params?.warehouseId !== undefined) {
    query.set("warehouse_id", String(params.warehouseId));
  }
  if (params?.includeDeleted) {
    query.set("include_deleted", "true");
  }
  query.set("limit", String(params?.limit ?? 100));

  return apiRequest<InventorySessionListItem[]>(
    `${API_ROUTES.inventory.sessions}?${query.toString()}`,
    {
      method: "GET",
    },
  );
}

export async function closeInventorySession(sessionId: number) {
  return apiRequest<InventorySession>(API_ROUTES.inventory.sessionClose(sessionId), {
    method: "POST",
  });
}

export async function reopenInventorySession(sessionId: number) {
  return apiRequest<InventorySession>(API_ROUTES.inventory.sessionReopen(sessionId), {
    method: "POST",
  });
}

export async function deleteInventorySession(sessionId: number, reason?: string | null) {
  const query = new URLSearchParams();
  if (reason) {
    query.set("reason", reason);
  }
  const path =
    query.size > 0
      ? `${API_ROUTES.inventory.sessionDelete(sessionId)}?${query.toString()}`
      : API_ROUTES.inventory.sessionDelete(sessionId);
  return apiRequest<void>(path, {
    method: "DELETE",
  });
}

export async function fetchSessionCatalog(
  sessionId: number,
  validators: { etag?: string | null; lastModified?: string | null } = {},
): Promise<{
  status: 200 | 304;
  items: InventoryCatalogItem[] | null;
  etag: string | null;
  lastModified: string | null;
}> {
  const headers: Record<string, string> = {};
  if (validators.etag) {
    headers["If-None-Match"] = validators.etag;
  }
  if (validators.lastModified) {
    headers["If-Modified-Since"] = validators.lastModified;
  }

  const response = await apiGetWithResponse(`/inventory/sessions/${sessionId}/catalog`, {
    headers,
    timeoutMs: 4500,
  });

  const etag = response.headers.get("etag");
  const lastModified = response.headers.get("last-modified");

  if (response.status === 304) {
    return { status: 304, items: null, etag, lastModified };
  }

  if (!response.ok) {
    const body = await response.text();
    throw new ApiRequestError(response.status, body);
  }

  const data = (await response.json()) as InventoryCatalogItem[];
  return { status: 200, items: data, etag, lastModified };
}

export async function getSessionEntriesSnapshot(
  sessionId: number,
): Promise<InventoryEntrySnapshotRow[]> {
  return apiRequest(`/inventory/sessions/${sessionId}/entries-snapshot`);
}

export async function saveInventoryEntry(params: {
  sessionId: number;
  itemId: number;
  quantity: number;
  mode: "set" | "add";
  stationId?: number | null;
  countedOutsideZone?: boolean;
  outsideZoneNote?: string | null;
  idempotencyKey: string;
  timeoutMs?: number;
  expectedVersion?: number | null;
}) {
  const body: Record<string, unknown> = {
    item_id: params.itemId,
    quantity: params.quantity,
    mode: params.mode,
    station_id: params.stationId ?? null,
    counted_outside_zone: Boolean(params.countedOutsideZone),
    outside_zone_note: params.outsideZoneNote ?? null,
  };
  if (params.expectedVersion != null) {
    body.expected_version = params.expectedVersion;
  }
  return apiRequest<InventoryEntry>(API_ROUTES.inventory.sessionEntries(params.sessionId), {
    method: "POST",
    timeoutMs: params.timeoutMs,
    headers: {
      "Idempotency-Key": params.idempotencyKey,
    },
    body,
  });
}

export async function patchInventoryEntry(params: {
  sessionId: number;
  itemId: number;
  quantity: number;
  version: number;
  stationId?: number | null;
  reason?: string;
  countedOutsideZone?: boolean;
  outsideZoneNote?: string | null;
}) {
  return apiRequest<InventoryEntry>(
    API_ROUTES.inventory.sessionEntryPatch(params.sessionId, params.itemId),
    {
      method: "PATCH",
      body: {
        quantity: params.quantity,
        version: params.version,
        station_id: params.stationId ?? null,
        reason: params.reason,
        counted_outside_zone: Boolean(params.countedOutsideZone),
        outside_zone_note: params.outsideZoneNote ?? null,
      },
    },
  );
}

export async function deleteInventoryEntry(params: {
  sessionId: number;
  itemId: number;
}) {
  return apiRequest<void>(
    API_ROUTES.inventory.sessionEntryDelete(params.sessionId, params.itemId),
    {
      method: "DELETE",
    },
  );
}

export async function getRecentInventoryEntries(sessionId: number, limit = 10) {
  return apiRequest<InventoryEntry[]>(
    `${API_ROUTES.inventory.sessionEntriesRecent(sessionId)}?limit=${limit}`,
    {
      method: "GET",
    },
  );
}

export async function getRecentInventoryEvents(sessionId: number, limit = 20) {
  return apiRequest<InventoryRecentEvent[]>(
    `${API_ROUTES.inventory.sessionEntriesRecentEvents(sessionId)}?limit=${limit}`,
    {
      method: "GET",
    },
  );
}

export async function getSessionInventoryEntries(sessionId: number) {
  return apiRequest<InventoryEntry[]>(API_ROUTES.inventory.sessionEntries(sessionId), {
    method: "GET",
  });
}

export async function getSessionInventoryAudit(sessionId: number, limit = 200) {
  return apiRequest<InventoryEntryEvent[]>(
    `${API_ROUTES.inventory.sessionAudit(sessionId)}?limit=${limit}`,
    {
      method: "GET",
    },
  );
}

export async function getSessionAuditLog(sessionId: number, limit = 50) {
  return apiRequest<AuditLogEntry[]>(
    `${API_ROUTES.inventory.sessionAuditLog(sessionId)}?limit=${limit}`,
    {
      method: "GET",
    },
  );
}

export async function getSessionItemContributors(sessionId: number, itemId: number) {
  return apiRequest<InventoryItemContributors>(
    API_ROUTES.inventory.sessionItemContributors(sessionId, itemId),
    {
      method: "GET",
    },
  );
}

export async function getSessionParticipants(sessionId: number) {
  return apiRequest<InventoryParticipantsSummary>(
    API_ROUTES.inventory.sessionParticipants(sessionId),
    {
      method: "GET",
    },
  );
}

export async function getSessionEvents(sessionId: number, limit = 100) {
  return apiRequest<InventorySessionEvent[]>(
    `${API_ROUTES.inventory.sessionEvents(sessionId)}?limit=${limit}`,
    {
      method: "GET",
    },
  );
}

export async function getSessionInventoryProgress(sessionId: number) {
  return apiRequest<InventorySessionProgress>(API_ROUTES.inventory.sessionProgress(sessionId), {
    method: "GET",
  });
}

export async function completeSessionZone(sessionId: number) {
  return apiRequest<InventoryZoneProgress>(API_ROUTES.inventory.sessionZoneComplete(sessionId), {
    method: "POST",
  });
}

export async function getInventoryProgress(params?: {
  zoneId?: number | null;
  warehouseId?: number | null;
  includeClosed?: boolean;
}) {
  const query = new URLSearchParams();
  if (params?.zoneId !== null && params?.zoneId !== undefined) {
    query.set("zone_id", String(params.zoneId));
  }
  if (params?.warehouseId !== null && params?.warehouseId !== undefined) {
    query.set("warehouse_id", String(params.warehouseId));
  }
  if (params?.includeClosed) {
    query.set("include_closed", "true");
  }
  const path =
    query.size > 0
      ? `${API_ROUTES.inventory.progress}?${query.toString()}`
      : API_ROUTES.inventory.progress;
  return apiRequest<InventoryZoneProgress[]>(path, {
    method: "GET",
  });
}

export async function exportInventorySessionXlsx(sessionId: number) {
  const exportPath = `${API_ROUTES.inventory.sessionExport(sessionId)}?format=xlsx`;
  const response = await fetch(toProxyUrl(exportPath), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition");
  const filename =
    parseFilenameFromContentDisposition(contentDisposition) ??
    `inventory-session-${sessionId}.xlsx`;

  return { blob, filename };
}
