"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { InventoryProblemItemsResult, InventoryTrendsResult } from "@/lib/api/analytics";
import type { DictionaryKeys } from "@/lib/i18n";

type T = (k: DictionaryKeys) => string;

const INCREASE = "hsl(142 76% 36%)";
const DECREASE = "hsl(0 72% 51%)";
const PRIMARY = "hsl(var(--primary))";

function chartTooltipStyle() {
  return {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border) / 0.6)",
    borderRadius: 8,
    fontSize: 12,
  };
}

export function AnalyticsChartsPanel({
  trends,
  problems,
  t,
}: {
  trends: InventoryTrendsResult | undefined;
  problems: InventoryProblemItemsResult | undefined;
  t: T;
}) {
  const lineData =
    trends?.sessions.map((s) => ({
      rev: `№${s.revision_no}`,
      items: s.items_count,
    })) ?? [];

  const last = trends?.sessions?.[trends.sessions.length - 1];
  const catEntries = Object.entries(last?.by_category ?? {})
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const topInc = (problems?.top_increase ?? []).map((p) => ({
    name: p.item_name.length > 28 ? `${p.item_name.slice(0, 28)}…` : p.item_name,
    v: p.abs_delta_qty,
  }));
  const topDec = (problems?.top_decrease ?? []).map((p) => ({
    name: p.item_name.length > 28 ? `${p.item_name.slice(0, 28)}…` : p.item_name,
    v: p.abs_delta_qty,
  }));

  const emptyLine = lineData.length === 0;
  const emptyCat = catEntries.length === 0;
  const emptyProb = topInc.length === 0 && topDec.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-foreground">{t("analytics.chart_positions")}</p>
        {emptyLine ? (
          <p className="py-12 text-center text-sm text-muted-foreground">—</p>
        ) : (
          <div className="h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="rev" tick={{ fontSize: 11 }} />
                <YAxis width={36} tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle()} />
                <Line type="monotone" dataKey="items" stroke={PRIMARY} strokeWidth={2} dot name="" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm">
        <p className="mb-3 text-sm font-semibold text-foreground">{t("analytics.chart_category")}</p>
        {emptyCat ? (
          <p className="py-12 text-center text-sm text-muted-foreground">—</p>
        ) : (
          <div className="h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={catEntries} layout="vertical" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={chartTooltipStyle()} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={PRIMARY} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm lg:col-span-2">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">{t("analytics.chart_top_inc")}</p>
            {emptyProb || topInc.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">—</p>
            ) : (
              <div className="h-[260px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topInc} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Bar dataKey="v" radius={[0, 4, 4, 0]}>
                      {topInc.map((_, i) => (
                        <Cell key={i} fill={INCREASE} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div>
            <p className="mb-3 text-sm font-semibold text-foreground">{t("analytics.chart_top_dec")}</p>
            {emptyProb || topDec.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">—</p>
            ) : (
              <div className="h-[260px] w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topDec} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={chartTooltipStyle()} />
                    <Bar dataKey="v" radius={[0, 4, 4, 0]}>
                      {topDec.map((_, i) => (
                        <Cell key={i} fill={DECREASE} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
