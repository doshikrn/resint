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
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
    prevFirstKeyRef.current = firstKey;
  }, [groups]);

  return (
    <section
      data-testid="inventory-recent-block"
      className="flex h-full min-h-0 max-h-[60dvh] flex-col rounded-2xl border border-border/60 bg-card/95 p-3 shadow-sm md:p-4 lg:max-h-none"
    >
      <div className="shrink-0 sticky top-0 z-10 -mx-3 -mt-3 border-b border-border/60 bg-card/95 px-3 pb-2 pt-3 backdrop-blur md:-mx-4 md:-mt-4 md:px-4 md:pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide">
            <History className="h-4 w-4" /> {t("inventory.recent.title")}
          </h2>
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 rounded-lg border border-border/70 bg-muted/50 p-0.5 text-[11px] font-medium">
              <button
                type="button"
                data-testid="inventory-recent-filter-mine"
                className={`rounded-md px-2 transition-all duration-150 ${filterMine ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => onFilterChange(true)}
              >
                {t("inventory.recent.filter_mine")}
              </button>
              <button
                type="button"
                data-testid="inventory-recent-filter-all"
                className={`rounded-md px-2 transition-all duration-150 ${!filterMine ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => onFilterChange(false)}
              >
                {t("inventory.recent.filter_all")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto pt-2 pr-1">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 bg-background/70 px-4 py-4 text-center text-sm text-muted-foreground">
            <ReceiptText className="mx-auto mb-2 h-5 w-5 text-primary/60" />
            <p className="font-medium text-foreground">{t("inventory.recent.empty_title")}</p>
            <p className="mt-1 text-xs">{t("inventory.recent.empty_hint")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.label} className="space-y-1.5">
                <p className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" /> {group.label}
                </p>

                {group.items.map((row, index) => (
                  <div
                    key={row.key}
                    data-testid="inventory-recent-row"
                    className={`rounded-xl border bg-background/80 px-2.5 py-2 transition-colors hover:bg-muted/30 ${
                      row.status !== "saved" ? "border-dashed border-border/60" : "border-border/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-1.5 min-w-0">
                        {onToggleFavorite ? (
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 rounded p-0.5 transition-all duration-150 hover:scale-110 active:scale-95"
                            onClick={() => onToggleFavorite(row.itemId)}
                          >
                            <Star className={`h-3.5 w-3.5 ${favoriteIds?.has(row.itemId) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50 hover:text-amber-400"}`} />
                          </button>
                        ) : null}
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-tight">{row.itemName}</p>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {formatDateTime(row.timestamp)}
                            {row.actorUsername ? ` · ${row.actorUsername}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums leading-tight">
                          {formatQty(row.mode, row.quantity, row.unit)}
                        </p>
                        <span
                          className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${statusClass(row.status)}`}
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
                      <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-orange-50 px-2 py-1.5 text-[11px] text-orange-800">
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

                    {index < group.items.length - 1 ? (
                      <div className="mt-2 border-t border-border/60" />
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
