import { API_ROUTES } from "@/lib/api/client";
import { apiRequest } from "@/lib/api/request";
import type { Station, Warehouse, Zone } from "@/lib/api/types";

export async function getStations(params?: {
  department?: "kitchen" | "bar" | null;
  isActive?: boolean;
}) {
  const query = new URLSearchParams();
  if (params?.department) {
    query.set("department", params.department);
  }
  if (params?.isActive !== undefined) {
    query.set("is_active", String(params.isActive));
  }
  const path =
    query.size > 0 ? `${API_ROUTES.stations.list}?${query.toString()}` : API_ROUTES.stations.list;
  return apiRequest<Station[]>(path, { method: "GET" });
}

export async function getZones() {
  return apiRequest<Zone[]>(API_ROUTES.zones.list, { method: "GET" });
}

export async function getWarehouses(zoneId?: number | null) {
  const path =
    zoneId !== null && zoneId !== undefined
      ? `${API_ROUTES.warehouses.list}?zone_id=${zoneId}`
      : API_ROUTES.warehouses.list;
  return apiRequest<Warehouse[]>(path, {
    method: "GET",
  });
}
