"use client";

import { AlertTriangle, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { memo, useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLanguage } from "@/lib/i18n/language-provider";
import type { DictionaryKeys } from "@/lib/i18n/dictionaries/ru";
import { formatQuantityWithUnit } from "@/lib/format-quantity";
import type { OfflineEntryQueueItem } from "@/lib/offline-entry-queue";

const ERROR_CODE_KEY: Record<string, DictionaryKeys> = {
  network: "queue.error.network",
  conflict: "queue.error.conflict",
  session_closed: "queue.error.session_closed",
  access_denied: "queue.error.access_denied",
};

function errorLabel(
  errorCode: string | null | undefined,
  t: (key: DictionaryKeys) => string,
): string {
  const key = errorCode ? ERROR_CODE_KEY[errorCode] : undefined;
  return t(key ?? "queue.error.unknown");
}

function statusBadgeClass(status: string) {
  if (status === "failed_conflict") {
    return "bg-orange-500/15 text-orange-700 ring-1 ring-orange-500/30";
  }
  return "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30";
}

type QueueRepairSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OfflineEntryQueueItem[];
  onRetryOne: (idempotencyKey: string) => void;
  onDeleteOne: (idempotencyKey: string) => void;
  onRetryAllFailed: () => void;
  formatDateTime: (value: string) => string;
};

export const QueueRepairSheet = memo(function QueueRepairSheet({
  open,
  onOpenChange,
  items,
  onRetryOne,
  onDeleteOne,
  onRetryAllFailed,
  formatDateTime,
}: QueueRepairSheetProps) {
  const { t } = useLanguage();
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  const problemItems = items.filter(
    (i) => i.status === "failed" || i.status === "failed_conflict",
  );
  const retryableFailed = problemItems.filter((i) => i.status === "failed");

  const handleDelete = useCallback(
    (key: string) => {
      if (confirmDeleteKey === key) {
        onDeleteOne(key);
        setConfirmDeleteKey(null);
      } else {
        setConfirmDeleteKey(key);
      }
    },
    [confirmDeleteKey, onDeleteOne],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            {t("queue.title")}
          </SheetTitle>
          <SheetDescription>{t("queue.description")}</SheetDescription>
        </SheetHeader>

        {retryableFailed.length > 0 && (
          <div className="shrink-0 pt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={onRetryAllFailed}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("queue.retry_all")} ({retryableFailed.length} {t("queue.item_count")})
            </Button>
          </div>
        )}

        <div className="mt-3 flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
          {problemItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("queue.empty")}
            </div>
          ) : (
            problemItems.map((item) => (
              <div
                key={item.idempotency_key}
                className="rounded-xl border border-border/70 bg-background/85 px-3 py-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.item_name}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatDateTime(item.created_at)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">
                      {item.mode === "add" ? "+" : ""}
                      {formatQuantityWithUnit(item.qty, item.unit)}
                    </p>
                    <span
                      className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(item.status)}`}
                    >
                      {item.status === "failed_conflict"
                        ? t("inventory.recent.status_conflict")
                        : t("inventory.recent.status_failed")}
                    </span>
                  </div>
                </div>

                {/* Error reason */}
                <div className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" />
                  <span className="flex-1">{errorLabel(item.error_code, t)}</span>
                </div>

                {/* Actions */}
                <div className="mt-2 flex items-center gap-2">
                  {item.status !== "failed_conflict" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => onRetryOne(item.idempotency_key)}
                    >
                      <RefreshCw className="h-3 w-3" />
                      {t("queue.retry")}
                    </Button>
                  )}
                  <Button
                    variant={confirmDeleteKey === item.idempotency_key ? "destructive" : "ghost"}
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => handleDelete(item.idempotency_key)}
                  >
                    <Trash2 className="h-3 w-3" />
                    {confirmDeleteKey === item.idempotency_key
                      ? t("queue.confirm_delete")
                      : t("queue.delete")}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
});
