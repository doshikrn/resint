import { API_ROUTES } from "@/lib/api/client";
import { apiRequest } from "@/lib/api/request";
import type { CurrentUserProfile, OnlineUser } from "@/lib/api/types";

export async function getCurrentUser(timeoutMs?: number) {
  return apiRequest<CurrentUserProfile>(API_ROUTES.auth.me, {
    method: "GET",
    timeoutMs,
  });
}

export async function sendHeartbeat() {
  return apiRequest<void>(API_ROUTES.users.heartbeat, { method: "POST" });
}

export async function getOnlineUsers() {
  return apiRequest<OnlineUser[]>(API_ROUTES.users.online, { method: "GET" });
}
