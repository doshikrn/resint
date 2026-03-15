import { API_ROUTES } from "@/lib/api/client";
import { apiRequest } from "@/lib/api/request";
import type { CurrentUserProfile, UserListItem } from "@/lib/api/types";

export async function listUsers(params?: {
  search?: string;
  role?: string;
  warehouse_id?: number;
}) {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.role) query.set("role", params.role);
  if (params?.warehouse_id !== undefined) query.set("warehouse_id", String(params.warehouse_id));
  const path =
    query.size > 0 ? `${API_ROUTES.users.list}?${query.toString()}` : API_ROUTES.users.list;
  return apiRequest<UserListItem[]>(path, { method: "GET" });
}

export async function adminCreateUser(data: {
  username: string;
  password: string;
  full_name?: string;
  role?: string;
  warehouse_id?: number | null;
}) {
  return apiRequest<CurrentUserProfile>(API_ROUTES.users.create, {
    method: "POST",
    body: data,
  });
}

export async function adminPatchUser(
  userId: number,
  data: {
    full_name?: string | null;
    role?: string;
    is_active?: boolean;
    warehouse_id?: number | null;
    department?: string | null;
  },
) {
  return apiRequest<CurrentUserProfile>(`${API_ROUTES.users.list}/${userId}`, {
    method: "PATCH",
    body: data,
  });
}

export async function adminResetPassword(userId: number, password: string) {
  return apiRequest<void>(`${API_ROUTES.users.list}/${userId}/reset-password`, {
    method: "POST",
    body: { password },
  });
}

export async function adminDeleteUser(userId: number) {
  return apiRequest<void>(`${API_ROUTES.users.list}/${userId}`, {
    method: "DELETE",
  });
}

export async function updateMyProfile(data: { full_name?: string; preferred_language?: string | null }) {
  return apiRequest<CurrentUserProfile>(API_ROUTES.users.me, {
    method: "PATCH",
    body: data,
  });
}

export async function changeMyPassword(data: { current_password: string; new_password: string }) {
  return apiRequest<void>(`${API_ROUTES.users.me}/password`, {
    method: "POST",
    body: data,
  });
}
