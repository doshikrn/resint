"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { AnalyticsChartsPanel } from "@/components/analytics/analytics-charts";
import { AnalyticsDiffTable } from "@/components/analytics/analytics-diff-table";
import { AnalyticsKpiStrip } from "@/components/analytics/analytics-kpi-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getInventoryAnalyticsDiff,
  getInventoryAnalyticsProblemItems,
  getInventoryAnalyticsSummary,
  getInventoryAnalyticsTrends,
} from "@/lib/api/analytics";
import { getItemCategories, getWarehouses } from "@/lib/api/http";
import { ApiRequestError } from "@/lib/api/request";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useLanguage } from "@/lib/i18n/language-provider";
import { canViewInventoryAnalytics } from "@/lib/permissions";

export function InventoryAnalyticsDashboard() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { user: currentUser } = useCurrentUser();
  const hasAccess = currentUser ? canViewInventoryAnalytics(currentUser.role) : false;

  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [sessionPrevId, setSessionPrevId] = useState<number | null>(null);
  const [sessionCurrId, setSessionCurrId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [onlyPf, setOnlyPf] = useState(false);
  const [minAbsDelta, setMinAbsDelta] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(searchInput.trim()), 350);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => getWarehouses(),
    staleTime: 60_000,
    enabled: hasAccess && !!currentUser,
  });

  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);

  useEffect(() => {
    if (!currentUser || warehouseId != null) return;
    const preferred = currentUser.default_warehouse_id ?? currentUser.warehouse_id;
    if (preferred != null) {
      setWarehouseId(preferred);
      return;
    }
    const first = warehouses[0]?.id;
    if (first != null) setWarehouseId(first);
  }, [currentUser, warehouseId, warehouses]);

  const summaryQuery = useQuery({
    queryKey: ["analytics-summary", warehouseId],
    queryFn: () => getInventoryAnalyticsSummary({ warehouseId: warehouseId! }),
    enabled: hasAccess && warehouseId != null,
    staleTime: 30_000,
  });

  const trendsQuery = useQuery({
    queryKey: ["analytics-trends", warehouseId],
    queryFn: () => getInventoryAnalyticsTrends({ warehouseId: warehouseId! }),
    enabled: hasAccess && warehouseId != null,
    staleTime: 30_000,
  });

  const categoriesQuery = useQuery({
    queryKey: ["item-categories"],
    queryFn: () => getItemCategories(),
    enabled: hasAccess,
    staleTime: 120_000,
  });

  const summary = summaryQuery.data;
  const sessionListSig = useMemo(
    () =>
      (summary?.recent_closed_sessions ?? [])
        .map((s) => `${s.id}:${s.revision_no}`)
        .sort()
        .join("|"),
    [summary],
  );

  useEffect(() => {
    const asc = [...(summary?.recent_closed_sessions ?? [])].sort(
      (a, b) => a.revision_no - b.revision_no,
    );
    if (asc.length >= 2) {
      setSessionPrevId(asc[asc.length - 2]!.id);
      setSessionCurrId(asc[asc.length - 1]!.id);
    } else {
      setSessionPrevId(null);
      setSessionCurrId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset A/B when the closed-session set for this warehouse changes (signature), not on every summary object reference
  }, [warehouseId, sessionListSig]);

  const minAbsParsed = useMemo(() => {
    const v = minAbsDelta.trim().replace(",", ".");
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [minAbsDelta]);

  const catParsed = categoryId === "all" ? null : Number(categoryId);

  const diffQuery = useQuery({
    queryKey: [
      "analytics-diff",
      warehouseId,
      sessionPrevId,
      sessionCurrId,
      catParsed,
      onlyPf,
      minAbsParsed,
      searchDebounced,
    ],
    queryFn: () =>
      getInventoryAnalyticsDiff({
        warehouseId: warehouseId!,
        sessionPreviousId: sessionPrevId!,
        sessionCurrentId: sessionCurrId!,
        categoryId: catParsed,
        onlyPf,
        minAbsDelta: minAbsParsed,
        search: searchDebounced || null,
      }),
    enabled:
      hasAccess &&
      warehouseId != null &&
      sessionPrevId != null &&
      sessionCurrId != null &&
      sessionPrevId !== sessionCurrId,
    staleTime: 20_000,
  });

  const problemsQuery = useQuery({
    queryKey: ["analytics-problems", warehouseId, sessionPrevId, sessionCurrId],
    queryFn: () =>
      getInventoryAnalyticsProblemItems({
        warehouseId: warehouseId!,
        sessionPreviousId: sessionPrevId!,
        sessionCurrentId: sessionCurrId!,
      }),
    enabled:
      hasAccess &&
      warehouseId != null &&
      sessionPrevId != null &&
      sessionCurrId != null &&
      sessionPrevId !== sessionCurrId,
    staleTime: 20_000,
  });

  const sessionOptions = useMemo(() => {
    const list = summary?.recent_closed_sessions ?? [];
    return [...list].sort((a, b) => a.revision_no - b.revision_no);
  }, [summary]);

  const summaryError =
    summaryQuery.error instanceof ApiRequestError ? summaryQuery.error : null;
  const diffError = diffQuery.error instanceof ApiRequestError ? diffQuery.error : null;

  async function retryAll() {
    await queryClient.invalidateQueries({ queryKey: ["analytics-summary"] });
    await queryClient.invalidateQueries({ queryKey: ["analytics-trends"] });
    await queryClient.invalidateQueries({ queryKey: ["analytics-diff"] });
    await queryClient.invalidateQueries({ queryKey: ["analytics-problems"] });
  }

  if (!currentUser) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground" data-testid="analytics-access-denied">
          {t("analytics.access_denied")}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-3 py-4 sm:px-4 md:px-6" data-testid="analytics-page-root">
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{t("analytics.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("analytics.subtitle")}</p>
      </div>

      {summaryError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
          data-testid="analytics-error"
        >
          <p className="text-destructive">
            {summaryError.status === 403 ? t("analytics.access_denied") : summaryError.message}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void retryAll()}>
            {t("analytics.retry")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-card/60 p-4 shadow-sm">
        <div className="grid gap-1.5 min-w-[180px]">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("analytics.warehouse")}
          </Label>
          {warehousesQuery.isLoading ? (
            <Skeleton className="h-10 w-[200px]" />
          ) : (
            <Select
              value={warehouseId != null ? String(warehouseId) : ""}
              onValueChange={(v) => setWarehouseId(Number(v))}
            >
              <SelectTrigger className="w-[220px]" data-testid="analytics-warehouse-select">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="grid gap-1.5 min-w-[160px]">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("analytics.revision_a")}
          </Label>
          <Select
            value={sessionPrevId != null ? String(sessionPrevId) : ""}
            onValueChange={(v) => setSessionPrevId(Number(v))}
            disabled={sessionOptions.length < 2}
          >
            <SelectTrigger className="w-[200px]" data-testid="analytics-revision-a">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {sessionOptions.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  №{s.revision_no} · id {s.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5 min-w-[160px]">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("analytics.revision_b")}
          </Label>
          <Select
            value={sessionCurrId != null ? String(sessionCurrId) : ""}
            onValueChange={(v) => setSessionCurrId(Number(v))}
            disabled={sessionOptions.length < 2}
          >
            <SelectTrigger className="w-[200px]" data-testid="analytics-revision-b">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {sessionOptions.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  №{s.revision_no} · id {s.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5 min-w-[160px]">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("analytics.category")}
          </Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="w-[200px]" data-testid="analytics-category-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("analytics.category_all")}</SelectItem>
              {(categoriesQuery.data ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border accent-primary"
            checked={onlyPf}
            onChange={(e) => setOnlyPf(e.target.checked)}
            data-testid="analytics-only-pf"
          />
          <span>{t("analytics.only_pf")}</span>
        </label>

        <div className="grid gap-1.5 min-w-[120px]">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("analytics.min_delta")}
          </Label>
          <Input
            inputMode="decimal"
            className="h-10 w-[120px]"
            value={minAbsDelta}
            onChange={(e) => setMinAbsDelta(e.target.value)}
            data-testid="analytics-min-delta"
          />
        </div>

        <div className="grid min-w-[200px] flex-1 gap-1.5">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("analytics.search")}
          </Label>
          <Input
            className="h-10"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            data-testid="analytics-search"
          />
        </div>
      </div>

      <AnalyticsKpiStrip summary={summary} loading={summaryQuery.isLoading} t={t} />

      {!summaryQuery.isLoading && (summary?.closed_sessions_count ?? 0) === 0 ? (
        <p
          className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
          data-testid="analytics-empty"
        >
          {t("analytics.empty_sessions")}
        </p>
      ) : null}

      {!summaryQuery.isLoading &&
      (summary?.closed_sessions_count ?? 0) > 0 &&
      sessionOptions.length < 2 ? (
        <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          {t("analytics.need_two")}
        </p>
      ) : null}

      <AnalyticsChartsPanel trends={trendsQuery.data} problems={problemsQuery.data} t={t} />

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">{t("analytics.diff_title")}</h2>
        {diffError ? (
          <p className="text-sm text-destructive">
            {diffError.status}: {diffError.message}
          </p>
        ) : null}
        {diffQuery.isLoading ? (
          <Skeleton className="h-48 w-full rounded-xl" data-testid="analytics-diff-skeleton" />
        ) : diffQuery.data?.rows?.length ? (
          <AnalyticsDiffTable rows={diffQuery.data.rows} t={t} />
        ) : sessionOptions.length >= 2 ? (
          <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            —
          </p>
        ) : null}
      </div>
    </div>
  );
}
