"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";

import type { InventoryDiffRow } from "@/lib/api/analytics";
import type { DictionaryKeys } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type T = (k: DictionaryKeys) => string;

type SortKey =
  | "product_code"
  | "item_name"
  | "unit"
  | "previous_qty"
  | "current_qty"
  | "delta_qty"
  | "delta_percent"
  | "category"
  | "is_pf"
  | "classification";

function classLabel(row: InventoryDiffRow, t: T): string {
  const k = `analytics.class.${row.classification}` as DictionaryKeys;
  return t(k);
}

export function AnalyticsDiffTable({ rows, t }: { rows: InventoryDiffRow[]; t: T }) {
  const [sortKey, setSortKey] = useState<SortKey>("delta_qty");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
      }
      if (typeof va === "boolean" && typeof vb === "boolean") {
        return (Number(va) - Number(vb)) * dir;
      }
      return String(va).localeCompare(String(vb), "ru") * dir;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "item_name" || key === "product_code" || key === "category" ? "asc" : "desc");
    }
  }

  function Th({ k, children }: { k: SortKey; children: React.ReactNode }) {
    const active = sortKey === k;
    return (
      <th className="whitespace-nowrap px-2 py-2 text-left font-semibold text-muted-foreground">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-left hover:bg-muted/80",
            active && "text-foreground",
          )}
          onClick={() => toggle(k)}
        >
          {children}
          {active ? (
            sortDir === "asc" ? (
              <ArrowUp className="h-3 w-3 shrink-0" />
            ) : (
              <ArrowDown className="h-3 w-3 shrink-0" />
            )
          ) : null}
        </button>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card/70 shadow-sm">
      <table className="w-full min-w-[880px] text-sm" data-testid="analytics-diff-table">
        <thead className="border-b border-border/60 bg-muted/30">
          <tr>
            <Th k="product_code">{t("analytics.col_code")}</Th>
            <Th k="item_name">{t("analytics.col_name")}</Th>
            <Th k="unit">{t("analytics.col_unit")}</Th>
            <Th k="previous_qty">{t("analytics.col_prev")}</Th>
            <Th k="current_qty">{t("analytics.col_curr")}</Th>
            <Th k="delta_qty">{t("analytics.col_delta")}</Th>
            <Th k="delta_percent">{t("analytics.col_delta_pct")}</Th>
            <Th k="category">{t("analytics.col_category")}</Th>
            <Th k="is_pf">{t("analytics.col_pf")}</Th>
            <Th k="classification">{t("analytics.col_class")}</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.item_id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
              <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{r.product_code ?? "—"}</td>
              <td className="max-w-[220px] truncate px-2 py-1.5 font-medium">{r.item_name}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{r.unit}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.previous_qty ?? "—"}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.current_qty ?? "—"}</td>
              <td
                className={cn(
                  "px-2 py-1.5 tabular-nums font-medium",
                  r.delta_qty > 0 && "text-emerald-700 dark:text-emerald-400",
                  r.delta_qty < 0 && "text-red-700 dark:text-red-400",
                )}
              >
                {r.delta_qty > 0 ? `+${r.delta_qty}` : r.delta_qty}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                {r.delta_percent == null ? "—" : `${r.delta_percent.toFixed(1)}%`}
              </td>
              <td className="max-w-[120px] truncate px-2 py-1.5 text-muted-foreground">{r.category ?? "—"}</td>
              <td className="px-2 py-1.5">{r.is_pf ? t("analytics.yes") : t("analytics.no")}</td>
              <td className="px-2 py-1.5 text-xs text-muted-foreground">{classLabel(r, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
