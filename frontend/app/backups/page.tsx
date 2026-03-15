"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Download, RotateCcw, AlertTriangle, Cloud, CloudOff, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiRequestError,
  listBackups,
  createBackup,
  deleteBackup,
  downloadBackup,
  restoreBackup,
  type BackupFile,
  type RestoreResult,
} from "@/lib/api/http";
import { useLanguage } from "@/lib/i18n/language-provider";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function BackupsPage() {
  const { t } = useLanguage();

  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Restore dialog state ──
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  // ── Create / Delete state ──
  const [creating, setCreating] = useState(false);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);

  // ── Toast ──
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastError, setToastError] = useState(false);

  useEffect(() => {
    if (!toastMessage) return;
    const id = setTimeout(() => {
      setToastMessage(null);
      setToastError(false);
    }, 5000);
    return () => clearTimeout(id);
  }, [toastMessage]);

  const showToast = useCallback((msg: string, isError = false) => {
    setToastMessage(msg);
    setToastError(isError);
  }, []);

  // ── Load backups ──
  const loadBackups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listBackups();
      setBackups(data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 403) {
        setError("Access denied");
      } else {
        setError(t("backup.error_load"));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  // ── Download handler ──
  async function handleDownload(filename: string) {
    try {
      const { blob } = await downloadBackup(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showToast(t("backup.error"), true);
    }
  }

  // ── Create handler ──
  async function handleCreate() {
    setCreating(true);
    try {
      await createBackup();
      showToast(t("backup.create_success"));
      loadBackups();
    } catch {
      showToast(t("backup.create_error"), true);
    } finally {
      setCreating(false);
    }
  }

  // ── Delete handler ──
  async function handleDelete(filename: string) {
    setDeletingFile(filename);
    try {
      await deleteBackup(filename);
      showToast(t("backup.delete_success"));
      loadBackups();
    } catch {
      showToast(t("backup.delete_error"), true);
    } finally {
      setDeletingFile(null);
    }
  }

  // ── Restore handler ──
  async function handleRestore() {
    if (!restoreTarget || confirmInput !== "RESTORE") return;
    setRestoring(true);
    setRestoreResult(null);
    try {
      const result = await restoreBackup(restoreTarget);
      setRestoreResult(result);
      setRestoreTarget(null);
      setConfirmInput("");
      showToast(t("backup.success"));
      loadBackups();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        showToast(`${t("backup.error")}: ${err.body}`, true);
      } else {
        showToast(t("backup.error"), true);
      }
    } finally {
      setRestoring(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("backup.title")}</h1>
        <div className="h-64 animate-pulse rounded-2xl border border-border/70 bg-card/95" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("backup.title")}</h1>
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center text-destructive">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toastMessage && (
        <div
          className={`fixed right-4 top-4 z-[100] max-w-sm animate-in fade-in slide-in-from-top-2 rounded-lg border px-4 py-3 shadow-lg ${
            toastError
              ? "border-destructive/40 bg-destructive text-destructive-foreground"
              : "border-primary/40 bg-primary text-primary-foreground"
          }`}
        >
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Database className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("backup.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("backup.description")}</p>
          </div>
        </div>
        <Button onClick={handleCreate} disabled={creating} className="gap-2">
          <Plus className="h-4 w-4" />
          {creating ? t("backup.creating") : t("backup.create_button")}
        </Button>
      </div>

      {/* Restore result */}
      {restoreResult && (
        <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-4 text-sm">
          <p className="font-medium text-green-700 dark:text-green-400">
            {t("backup.success")}
          </p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>Restored from: <span className="font-mono text-foreground">{restoreResult.restored_from}</span></li>
            {restoreResult.emergency_backup && (
              <li>Emergency backup: <span className="font-mono text-foreground">{restoreResult.emergency_backup}</span></li>
            )}
            {restoreResult.tables_count != null && (
              <li>Tables: <span className="font-mono text-foreground">{restoreResult.tables_count}</span></li>
            )}
          </ul>
        </div>
      )}

      {/* Table */}
      {backups.length === 0 ? (
        <div className="rounded-2xl border border-border/70 bg-card/95 p-12 text-center text-muted-foreground">
          {t("backup.no_backups")}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("backup.filename")}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("backup.type")}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("backup.size")}</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">S3</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{t("backup.date")}</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t("backup.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.filename} className="border-b border-border/30 last:border-b-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs" title={b.checksum ? `SHA-256: ${b.checksum}` : undefined}>{b.filename}</td>
                  <td className="px-4 py-3">
                    {b.revision_no != null ? (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {t("backup.type_revision").replace("{n}", String(b.revision_no))}
                      </span>
                    ) : b.filename.startsWith("backup_before_restore") ? (
                      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        {t("backup.type_emergency")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t("backup.type_scheduled")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatBytes(b.size_bytes)}</td>
                  <td className="px-4 py-3">
                    {b.uploaded_to_s3 ? (
                      <span title={b.s3_key ?? undefined} className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                        <Cloud className="h-3.5 w-3.5" />
                        <span className="text-xs">{t("backup.s3_uploaded")}</span>
                      </span>
                    ) : b.upload_error ? (
                      <span title={b.upload_error} className="inline-flex items-center gap-1 text-destructive">
                        <CloudOff className="h-3.5 w-3.5" />
                        <span className="text-xs">{t("backup.s3_error")}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(b.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(b.filename)}
                        className="h-8 gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("backup.download")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRestoreTarget(b.filename);
                          setConfirmInput("");
                          setRestoreResult(null);
                        }}
                        disabled={restoring}
                        className="h-8 gap-1.5 border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t("backup.restore")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(b.filename)}
                        disabled={deletingFile === b.filename}
                        className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {deletingFile === b.filename ? "..." : t("backup.delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Restore confirmation dialog */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <h2 className="text-lg font-semibold">{t("backup.confirm_title")}</h2>
            </div>

            <p className="text-sm text-muted-foreground">{t("backup.confirm_text")}</p>

            <p className="text-sm">
              <span className="font-medium">File:</span>{" "}
              <span className="font-mono text-xs">{restoreTarget}</span>
            </p>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("backup.confirm_input_label")}</label>
              <Input
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="RESTORE"
                autoFocus
                disabled={restoring}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRestoreTarget(null);
                  setConfirmInput("");
                }}
                disabled={restoring}
              >
                {t("backup.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRestore}
                disabled={confirmInput !== "RESTORE" || restoring}
              >
                {restoring ? t("backup.restoring") : t("backup.confirm_button")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
