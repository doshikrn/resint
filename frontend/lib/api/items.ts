import { API_ROUTES } from "@/lib/api/client";
import { apiRequest } from "@/lib/api/request";
import type { ItemBulkUpsertResult, ItemBulkUpsertRow, ItemCatalog, ItemSearchResult } from "@/lib/api/types";

export async function getItems(params?: {
  warehouseId?: number | null;
  categoryId?: number | null;
  q?: string;
}) {
  const query = new URLSearchParams();
  if (params?.warehouseId !== null && params?.warehouseId !== undefined) {
    query.set("warehouse_id", String(params.warehouseId));
  }
  if (params?.categoryId !== null && params?.categoryId !== undefined) {
    query.set("category_id", String(params.categoryId));
  }
  if (params?.q?.trim()) {
    query.set("q", params.q.trim());
  }

  const path =
    query.size > 0 ? `${API_ROUTES.items.list}?${query.toString()}` : API_ROUTES.items.list;
  return apiRequest<ItemCatalog[]>(path, { method: "GET" });
}

export async function createItem(payload: {
  product_code: string | null;
  name: string;
  unit: string;
  warehouse_id: number;
  step?: number;
  min_qty?: number | null;
  max_qty?: number | null;
  is_favorite?: boolean;
  category_id?: number | null;
  station_id?: number | null;
}) {
  return apiRequest<ItemCatalog>(API_ROUTES.items.create, {
    method: "POST",
    body: payload,
  });
}

export async function patchItem(
  itemId: number,
  payload: Partial<{
    product_code: string;
    name: string;
    unit: string;
    step: number;
    min_qty: number | null;
    max_qty: number | null;
    is_active: boolean;
    is_favorite: boolean;
    category_id: number | null;
    station_id: number | null;
  }>,
) {
  return apiRequest<ItemCatalog>(API_ROUTES.items.patch(itemId), {
    method: "PATCH",
    body: payload,
  });
}

export async function getItemUnits() {
  return apiRequest<Array<{ code: string; label: string }>>(API_ROUTES.items.units, {
    method: "GET",
  });
}

export async function bulkUpsertItems(payload: {
  rows: ItemBulkUpsertRow[];
  dry_run?: boolean;
  default_warehouse_id?: number;
}) {
  return apiRequest<ItemBulkUpsertResult>(`${API_ROUTES.items.list}/bulk-upsert`, {
    method: "POST",
    body: payload,
  });
}

export async function searchItems(params: {
  q: string;
  warehouseId?: number | null;
  zoneId?: number | null;
  limit?: number;
}) {
  const query = new URLSearchParams();
  query.set("q", params.q);
  query.set("limit", String(params.limit ?? 20));

  if (params.warehouseId !== null && params.warehouseId !== undefined) {
    query.set("warehouse_id", String(params.warehouseId));
  } else if (params.zoneId !== null && params.zoneId !== undefined) {
    query.set("zone_id", String(params.zoneId));
  }

  return apiRequest<ItemSearchResult[]>(`${API_ROUTES.items.search}?${query.toString()}`, {
    method: "GET",
  });
}

export async function getFrequentItems(params: {
  warehouseId: number;
  sessionId?: number | null;
  limit?: number;
  period?: string;
}) {
  const query = new URLSearchParams();
  query.set("warehouse_id", String(params.warehouseId));
  if (params.sessionId !== null && params.sessionId !== undefined) {
    query.set("session_id", String(params.sessionId));
  }
  query.set("limit", String(params.limit ?? 12));
  if (params.period) {
    query.set("period", params.period);
  }

  const items = await apiRequest<
    Array<{
      id: number;
      product_code: string;
      name: string;
      unit: string;
      step: number;
      min_qty: number | null;
      max_qty: number | null;
      is_favorite: boolean;
      warehouse_id: number;
    }>
  >(`${API_ROUTES.items.frequent}?${query.toString()}`, { method: "GET" });

  return items.map((item) => ({
    id: item.id,
    product_code: item.product_code,
    name: item.name,
    unit: item.unit,
    step: item.step,
    min_qty: item.min_qty,
    max_qty: item.max_qty,
    is_favorite: item.is_favorite,
    warehouse_id: item.warehouse_id,
  })) as ItemSearchResult[];
}

export async function getRecentItems(params: {
  warehouseId: number;
  sessionId?: number | null;
  limit?: number;
}) {
  const query = new URLSearchParams();
  query.set("warehouse_id", String(params.warehouseId));
  if (params.sessionId !== null && params.sessionId !== undefined) {
    query.set("session_id", String(params.sessionId));
  }
  query.set("limit", String(params.limit ?? 12));

  const items = await apiRequest<
    Array<{
      id: number;
      product_code: string;
      name: string;
      unit: string;
      step: number;
      min_qty: number | null;
      max_qty: number | null;
      is_favorite: boolean;
      warehouse_id: number;
    }>
  >(`${API_ROUTES.items.recent}?${query.toString()}`, { method: "GET" });

  return items.map((item) => ({
    id: item.id,
    product_code: item.product_code,
    name: item.name,
    unit: item.unit,
    step: item.step,
    min_qty: item.min_qty,
    max_qty: item.max_qty,
    is_favorite: item.is_favorite,
    warehouse_id: item.warehouse_id,
  })) as ItemSearchResult[];
}
