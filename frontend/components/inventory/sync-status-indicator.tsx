import { CloudOff, Loader2, RefreshCw, Wifi } from "lucide-react";
import { memo } from "react";

import { useLanguage } from "@/lib/i18n/language-provider";

export type SyncStatus = "online" | "offline" | "syncing" | "error";

type SyncStatusIndicatorProps = {
  status: SyncStatus;
  queueLength: number;
  onRetry?: () => void;
};

export const SyncStatusIndicator = memo(function SyncStatusIndicator({
  status,
  queueLength,
  onRetry,
}: SyncStatusIndicatorProps) {
  const { t } = useLanguage();

  if (status === "online" && queueLength === 0) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-500/30">
        <Wifi className="h-3 w-3" />
        {t("sync.online")}
      </div>
    );
  }

  if (status === "offline") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/30">
        <CloudOff className="h-3 w-3" />
        {t("sync.offline")}
        {queueLength > 0 ? (
          <span className="ml-0.5 tabular-nums">({queueLength})</span>
        ) : null}
      </div>
    );
  }

  if (status === "syncing") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/15 px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-blue-500/30">
        <Loader2 className="h-3 w-3 animate-spin" />
        {t("sync.syncing")}
        {queueLength > 0 ? (
          <span className="ml-0.5 tabular-nums">({queueLength})</span>
        ) : null}
      </div>
    );
  }

  // status === "error"
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-medium text-rose-700 ring-1 ring-rose-500/30 transition-colors hover:bg-rose-500/25"
      onClick={onRetry}
    >
      <RefreshCw className="h-3 w-3" />
      {t("sync.error")}
      {queueLength > 0 ? (
        <span className="ml-0.5 tabular-nums">({queueLength})</span>
      ) : null}
    </button>
  );
});
