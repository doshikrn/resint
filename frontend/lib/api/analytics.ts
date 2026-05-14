import { API_ROUTES } from "@/lib/api/client";
import { apiRequest } from "@/lib/api/request";

export type ClosedSessionRef = {
  id: number;
  revision_no: number;
  warehouse_id: number;
  updated_at: string | null;
};

export type ProblemItem = {
  item_id: number;
  item_name: string;
  unit: string;
  abs_delta_qty: number;
};

export type InventoryAnalyticsSummary = {
  warehouse_id: number;
  date_from: string | null;
  date_to: string | null;
  closed_sessions_count: number;
  last_session: ClosedSessionRef | null;
  previous_session: ClosedSessionRef | null;
  last_session_items_count: number;
  total_abs_delta_qty: number;
  unchanged_items_count: number;
  sharp_change_items_count: number;
  stagnant_items_count: number;
  top_problem_items: ProblemItem[];
  recent_closed_sessions: ClosedSessionRef[];
};

export type DiffClassification = "increased" | "decreased" | "unchanged" | "new" | "disappeared";

export type InventoryDiffRow = {
  item_id: number;
  product_code: string | null;
  item_name: string;
  unit: string;
  category: string | null;
  is_pf: boolean;
  previous_qty: number | null;
  current_qty: number | null;
  delta_qty: number;
  delta_percent: number | null;
  classification: DiffClassification;
};

export type InventoryDiffResult = {
  warehouse_id: number;
  session_previous_id: number;
  session_current_id: number;
  rows: InventoryDiffRow[];
};

export type TrendSessionPoint = {
  session_id: number;
  revision_no: number;
  updated_at: string | null;
  items_count: number;
  total_qty_sum: number;
  by_category: Record<string, number>;
};

export type InventoryTrendsResult = {
  warehouse_id: number;
  date_from: string | null;
  date_to: string | null;
  sessions: TrendSessionPoint[];
};

export type InventoryProblemItemsResult = {
  warehouse_id: number;
  session_previous_id: number;
  session_current_id: number;
  top_abs_delta: ProblemItem[];
  top_increase: ProblemItem[];
  top_decrease: ProblemItem[];
};

export async function getInventoryAnalyticsSummary(params: {
  warehouseId: number;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const q = new URLSearchParams();
  q.set("warehouse_id", String(params.warehouseId));
  if (params.dateFrom) q.set("date_from", params.dateFrom);
  if (params.dateTo) q.set("date_to", params.dateTo);
  return apiRequest<InventoryAnalyticsSummary>(
    `${API_ROUTES.analytics.inventorySummary}?${q.toString()}`,
    { method: "GET" },
  );
}

export async function getInventoryAnalyticsDiff(params: {
  warehouseId: number;
  sessionPreviousId: number;
  sessionCurrentId: number;
  categoryId?: number | null;
  onlyPf?: boolean;
  minAbsDelta?: number | null;
  search?: string | null;
}) {
  const q = new URLSearchParams();
  q.set("warehouse_id", String(params.warehouseId));
  q.set("session_previous_id", String(params.sessionPreviousId));
  q.set("session_current_id", String(params.sessionCurrentId));
  if (params.categoryId != null) q.set("category_id", String(params.categoryId));
  if (params.onlyPf) q.set("only_pf", "true");
  if (params.minAbsDelta != null && params.minAbsDelta > 0) {
    q.set("min_abs_delta", String(params.minAbsDelta));
  }
  if (params.search?.trim()) q.set("search", params.search.trim());
  return apiRequest<InventoryDiffResult>(
    `${API_ROUTES.analytics.inventoryDiff}?${q.toString()}`,
    { method: "GET" },
  );
}

export async function getInventoryAnalyticsTrends(params: {
  warehouseId: number;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const q = new URLSearchParams();
  q.set("warehouse_id", String(params.warehouseId));
  if (params.dateFrom) q.set("date_from", params.dateFrom);
  if (params.dateTo) q.set("date_to", params.dateTo);
  return apiRequest<InventoryTrendsResult>(
    `${API_ROUTES.analytics.inventoryTrends}?${q.toString()}`,
    { method: "GET" },
  );
}

export async function getInventoryAnalyticsProblemItems(params: {
  warehouseId: number;
  sessionPreviousId: number;
  sessionCurrentId: number;
}) {
  const q = new URLSearchParams();
  q.set("warehouse_id", String(params.warehouseId));
  q.set("session_previous_id", String(params.sessionPreviousId));
  q.set("session_current_id", String(params.sessionCurrentId));
  return apiRequest<InventoryProblemItemsResult>(
    `${API_ROUTES.analytics.inventoryProblemItems}?${q.toString()}`,
    { method: "GET" },
  );
}
