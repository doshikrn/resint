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

  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-card/95 p-4 shadow-sm transition-all duration-150 hover:shadow-md motion-reduce:transition-none md:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide">{t("inventory.progress.title")}</h2>
      </div>

      {sessionProgressLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-40 rounded-xl" />
          <Skeleton className="h-4 w-56 rounded-xl" />
        </div>
      ) : sessionProgress ? (
        <>
          <div className="rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                {t("inventory.progress.items_counted")}:{" "}
                <strong className="font-semibold tabular-nums text-foreground">
                  {enteredCount}
                </strong>
              </span>
              <span>
                {t("inventory.progress.by_you")}:{" "}
                <strong className="font-semibold tabular-nums text-foreground">
                  {enteredByUserCount}
                </strong>
              </span>
              <span className="min-w-0 basis-full truncate sm:basis-auto">
                {t("inventory.progress.last_change")}:{" "}
                {sessionProgress.last_activity_at
                  ? formatDateTime(sessionProgress.last_activity_at)
                  : "—"}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-border/70 bg-background/85 p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>
              {t("inventory.progress.items_counted")}:{" "}
              <strong className="font-semibold tabular-nums text-foreground">0</strong>
            </span>
            <span>
              {t("inventory.progress.by_you")}:{" "}
              <strong className="font-semibold tabular-nums text-foreground">0</strong>
            </span>
            <span className="min-w-0 basis-full truncate sm:basis-auto">
              {t("inventory.progress.last_change")}: —
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Ревизия ещё не начата. После первого сохранения прогресс обновится автоматически.
          </p>
        </div>
      )}
    </section>
  );
}
