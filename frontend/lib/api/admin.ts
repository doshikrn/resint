import { API_ROUTES } from "@/lib/api/client";
import { apiRequest, ApiRequestError, toProxyUrl } from "@/lib/api/request";
import type { BackupFile, HealthReadyResponse, RestoreResult } from "@/lib/api/types";

export async function listBackups() {
  return apiRequest<BackupFile[]>(API_ROUTES.admin.backups, { method: "GET" });
}

export async function createBackup() {
  return apiRequest<BackupFile>(API_ROUTES.admin.backupCreate, { method: "POST", timeoutMs: 120_000 });
}

export async function deleteBackup(filename: string) {
  const path = API_ROUTES.admin.backupDelete(filename);
  return apiRequest<{ status: string; deleted: string }>(path, { method: "DELETE" });
}

export async function downloadBackup(filename: string) {
  const path = API_ROUTES.admin.backupDownload(filename);
  const response = await fetch(toProxyUrl(path), {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new ApiRequestError(response.status, text);
  }

  const blob = await response.blob();
  return { blob, filename };
}

export async function restoreBackup(file: string) {
  return apiRequest<RestoreResult>(API_ROUTES.admin.backupRestore, {
    method: "POST",
    body: { file },
  });
}

export async function getBackupStatus() {
  return apiRequest<{ maintenance_mode: boolean }>(API_ROUTES.admin.backupStatus, {
    method: "GET",
  });
}

export async function checkHealthReady(): Promise<HealthReadyResponse> {
  const response = await fetch("/api/backend/health/ready", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const body = await response.json();
  return body as HealthReadyResponse;
}
