import { BarChart3, Clock, Hash, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLanguage } from "@/lib/i18n/language-provider";
import { type InventorySessionProgress } from "@/lib/api/http";

type ProgressCardProps = {
  sessionProgressLoading: boolean;
  sessionProgress: InventorySessionProgress | undefined;
  formatDateTime: (value: string) => string;
};

export function ProgressCard({
  sessionProgressLoading,
  sessionProgress,
  formatDateTime,
}: ProgressCardProps) {
  const enteredCount = sessionProgress?.total_counted_items ?? 0;
  const enteredByUserCount = sessionProgress?.my_counted_items ?? 0;
  const { t } = useLanguage();

  const lastActivity = sessionProgress?.last_activity_at
    ? formatDateTime(sessionProgress.last_activity_at)
    : "—";

  return (
    <section
      data-testid="inventory-progress-card"
      className="rounded-2xl border border-border/50 bg-card/80 p-4 md:p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-semibold tracking-wide">{t("inventory.progress.title")}</h2>
      </div>

      {sessionProgressLoading ? (
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/40 bg-background/50 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Hash className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{t("inventory.progress.items_counted")}</span>
              </div>
              <p data-testid="inventory-progress-total" className="text-3xl font-extrabold tabular-nums tracking-tighter text-foreground">
                {enteredCount}
              </p>
            </div>
            <div className="rounded-xl border border-border/40 bg-background/50 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <User className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{t("inventory.progress.by_you")}</span>
              </div>
              <p data-testid="inventory-progress-mine" className="text-3xl font-extrabold tabular-nums tracking-tighter text-foreground">
                {enteredByUserCount}
              </p>
            </div>
          </div>

          <div data-testid="inventory-progress-last-change" className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">{t("inventory.progress.last_change")}: {lastActivity}</span>
          </div>

          {!sessionProgress ? (
            <p className="mt-2 text-[11px] text-muted-foreground/80">
              Ревизия ещё не начата. После первого сохранения прогресс обновится автоматически.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
