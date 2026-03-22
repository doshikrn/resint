import { AlertTriangle, Clock3, History, ReceiptText, Star, X } from "lucide-react";
import { memo, useEffect, useRef } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/lib/i18n/language-provider";
import { formatQuantityWithUnit } from "@/lib/format-quantity";

type RecentJournalEntry = {
  key: string;
  itemId: number;
  status: "saved" | "pending" | "syncing" | "failed" | "failed_conflict";
  itemName: string;
  quantity: number;
  unit: string;
  mode: "add" | "set";
  timestamp: string;
  countedOutsideZone: boolean;
  countedByZone: string | null;
  stationId: number | null;
  stationName: string | null;
  stationDepartment: string | null;
  actorUsername?: string;
};

type RecentJournalGroup = {
  label: string;
  items: RecentJournalEntry[];
};

type RecentEntriesCardProps = {
  isLoading: boolean;
  groups: RecentJournalGroup[];
  formatDateTime: (value: string) => string;
  filterMine: boolean;
  onFilterChange: (mine: boolean) => void;
  onDismissConflict?: (key: string) => void;
  favoriteIds?: Set<number>;
  onToggleFavorite?: (itemId: number) => void;
};

function statusClass(status: "saved" | "pending" | "syncing" | "failed" | "failed_conflict") {
  if (status === "saved") {
    return "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30";
  }
  if (status === "failed_conflict") {
    return "bg-orange-500/15 text-orange-700 ring-1 ring-orange-500/30";
  }
  if (status === "failed") {
    return "bg-rose-500/15 text-rose-700 ring-1 ring-rose-500/30";
  }
  if (status === "syncing") {
    return "bg-blue-500/15 text-blue-700 ring-1 ring-blue-500/30";
  }
  return "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30";
}

function formatQty(mode: "add" | "set", quantity: number, unit: string): string {
  const sign = mode === "add" ? "+" : "";
  return `${sign}${formatQuantityWithUnit(quantity, unit)}`;
}

export const RecentEntriesCard = memo(function RecentEntriesCard({
  isLoading,
  groups,
  formatDateTime,
  filterMine,
  onFilterChange,
  onDismissConflict,
  favoriteIds,
  onToggleFavorite,
}: RecentEntriesCardProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevFirstKeyRef = useRef<string | undefined>();
  const { t } = useLanguage();

  useEffect(() => {
    const firstKey = groups[0]?.items[0]?.key;
    if (prevFirstKeyRef.current !== undefined && firstKey !== prevFirstKeyRef.current) {
      if ((scrollContainerRef.current?.scrollTop ?? 0) > 8) {
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" });
      }
    }
    prevFirstKeyRef.current = firstKey;
  }, [groups]);

  return (
    <section
      data-testid="inventory-recent-block"
      className="flex h-full min-h-0 max-h-[60dvh] flex-col rounded-2xl border border-border/50 bg-card/80 shadow-none lg:max-h-none"
    >
      <div className="shrink-0 border-b border-border/40 px-4 py-3 md:px-5 md:py-3.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            {t("inventory.recent.title")}
          </h2>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 rounded-lg border border-border/60 bg-muted/40 p-0.5 text-[11px] font-medium">
              <button
                type="button"
                data-testid="inventory-recent-filter-mine"
                className={`rounded-md px-2.5 transition-all duration-150 ${filterMine ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => onFilterChange(true)}
              >
                {t("inventory.recent.filter_mine")}
              </button>
              <button
                type="button"
                data-testid="inventory-recent-filter-all"
                className={`rounded-md px-2.5 transition-all duration-150 ${!filterMine ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => onFilterChange(false)}
              >
                {t("inventory.recent.filter_all")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            <ReceiptText className="mx-auto mb-2.5 h-6 w-6 text-muted-foreground/40" />
            <p className="font-medium text-foreground/80">{t("inventory.recent.empty_title")}</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{t("inventory.recent.empty_hint")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  <Clock3 className="h-3 w-3" /> {group.label}
                </p>

                <div className="space-y-1.5">
                {group.items.map((row) => (
                  <div
                    key={row.key}
                    data-testid="inventory-recent-row"
                    className={`rounded-xl border px-3 py-2.5 transition-colors hover:bg-muted/20 ${
                      row.status !== "saved" ? "border-dashed border-border/60 bg-muted/10" : "border-border/40 bg-background/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        {onToggleFavorite ? (
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 rounded-md p-1 transition-all duration-150 hover:scale-110 hover:bg-muted/50 active:scale-95"
                            onClick={() => onToggleFavorite(row.itemId)}
                          >
                            <Star className={`h-3.5 w-3.5 ${favoriteIds?.has(row.itemId) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40 hover:text-amber-400"}`} />
                          </button>
                        ) : null}
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium leading-snug">{row.itemName}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                            {formatDateTime(row.timestamp)}
                            {row.actorUsername ? ` · ${row.actorUsername}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[13px] font-semibold tabular-nums leading-snug">
                          {formatQty(row.mode, row.quantity, row.unit)}
                        </p>
                        <span
                          className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${statusClass(row.status)}`}
                        >
                          {row.status === "saved"
                            ? t("inventory.recent.status_saved")
                            : row.status === "pending"
                              ? t("inventory.recent.status_pending")
                              : row.status === "syncing"
                                ? t("inventory.recent.status_syncing")
                                : row.status === "failed_conflict"
                                  ? t("inventory.recent.status_conflict")
                                  : t("inventory.recent.status_failed")}
                        </span>
                      </div>
                    </div>

                    {row.status === "failed_conflict" ? (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-orange-50 px-2.5 py-2 text-[11px] text-orange-800">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="flex-1">{t("inventory.recent.conflict_hint")}</span>
                        {onDismissConflict ? (
                          <button
                            type="button"
                            className="ml-1 shrink-0 rounded p-0.5 hover:bg-orange-200/50"
                            onClick={() => onDismissConflict(row.key)}
                            aria-label={t("common.dismiss")}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
