"use client";

import { Skeleton } from "@/components/ui/skeleton";
import type { InventoryAnalyticsSummary } from "@/lib/api/analytics";
import type { DictionaryKeys } from "@/lib/i18n";

type T = (k: DictionaryKeys) => string;

export function AnalyticsKpiStrip({
  summary,
  loading,
  t,
}: {
  summary: InventoryAnalyticsSummary | undefined;
  loading: boolean;
  t: T;
}) {
  if (loading) {
    return (
      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="analytics-kpi-skeleton"
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-xl" />
        ))}
      </div>
    );
  }

  const last = summary?.last_session;
  const lastLabel = last ? `№${last.revision_no}` : "—";

  const cards = [
    {
      testId: "analytics-kpi-sessions",
      label: t("analytics.kpi_sessions"),
      value: String(summary?.closed_sessions_count ?? 0),
    },
    {
      testId: "analytics-kpi-last",
      label: t("analytics.kpi_last"),
      value: lastLabel,
      hint: last?.updated_at
        ? new Date(last.updated_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
        : undefined,
    },
    {
      testId: "analytics-kpi-items",
      label: t("analytics.kpi_items"),
      value: String(summary?.last_session_items_count ?? 0),
    },
    {
      testId: "analytics-kpi-abs-delta",
      label: t("analytics.kpi_abs_delta"),
      value: (summary?.total_abs_delta_qty ?? 0).toLocaleString("ru-RU", {
        maximumFractionDigits: 2,
      }),
    },
    {
      testId: "analytics-kpi-stagnant",
      label: t("analytics.kpi_stagnant"),
      value: String(summary?.stagnant_items_count ?? 0),
    },
    {
      testId: "analytics-kpi-sharp",
      label: t("analytics.kpi_sharp"),
      value: String(summary?.sharp_change_items_count ?? 0),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.testId}
          data-testid={c.testId}
          className="rounded-xl border border-border/60 bg-card/80 p-4 shadow-sm backdrop-blur-sm"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {c.label}
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-foreground">{c.value}</p>
          {c.hint ? <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
