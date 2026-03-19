"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { formatQuantityWithUnit } from "@/lib/format-quantity";
import { useLanguage } from "@/lib/i18n/language-provider";
import type { InventoryEntry, InventorySessionListItem } from "@/lib/api/http";

// ── types ───────────────────────────────────────────────────────────────

export type ReportRow = {
  entry: InventoryEntry;
  actorDisplayName: string | null;
  contributorsCount: number;
  contributorsPreview: string[];
  lastActionAt: string;
};

type SharedProps = {
  rows: ReportRow[];
  selectedReportItemId: number | null;
  onSelectItem: (itemId: number) => void;
  selectedReportSession: InventorySessionListItem;
  canEditClosedRevision: boolean;
  editEntryMutationPending: boolean;
  openEditEntryModal: (entry: InventoryEntry, closedSession?: boolean) => void;
  onDeleteEntry: (entry: InventoryEntry) => void;
  deleteEntryMutationPending: boolean;
};

// ── helpers ─────────────────────────────────────────────────────────────

const dtf = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Almaty",
});

function fmtDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dtf.format(d);
}

// ── desktop table (virtualized) ─────────────────────────────────────────

const ROW_HEIGHT = 49; // px – matches py-3 + text-sm line-height

export function ReportItemsDesktopTable({
  rows,
  selectedReportItemId,
  onSelectItem,
  selectedReportSession,
  canEditClosedRevision,
  editEntryMutationPending,
  openEditEntryModal,
  onDeleteEntry,
  deleteEntryMutationPending,
}: SharedProps) {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  return (
    <div
      ref={scrollRef}
      className="hidden sm:block overflow-auto rounded-xl border border-border/60 max-h-[60dvh] lg:max-h-none lg:flex-1 lg:min-h-0"
    >
      <div className="min-w-[600px]">
        {/* header */}
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(120px,1fr)_80px_140px_130px_160px] gap-0 border-b border-border/60 bg-muted/80 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground backdrop-blur-sm">
          <div className="px-3 py-2.5">{t("inventory.reports.col_item")}</div>
          <div className="px-3 py-2.5">{t("inventory.reports.col_total")}</div>
          <div className="px-3 py-2.5">{t("inventory.reports.col_last_editor")}</div>
          <div className="px-3 py-2.5">{t("inventory.reports.col_when")}</div>
          <div className="px-3 py-2.5">{t("inventory.reports.col_action")}</div>
        </div>
        {/* body */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const { entry, actorDisplayName, lastActionAt } = rows[virtualRow.index];
            const isSelected = selectedReportItemId === entry.item_id;
            return (
              <div
                key={entry.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`grid grid-cols-[minmax(120px,1fr)_80px_140px_130px_160px] gap-0 border-b border-border/40 text-sm transition-colors hover:bg-muted/30 cursor-pointer ${isSelected ? "bg-primary/5" : ""}`}
                onClick={() => onSelectItem(entry.item_id)}
              >
                <div className="px-3 py-2.5 font-medium truncate">{entry.item_name}</div>
                <div className="px-3 py-2.5 tabular-nums">
                  {formatQuantityWithUnit(entry.quantity, entry.unit)}
                </div>
                <div className="px-3 py-2.5 truncate text-muted-foreground">{actorDisplayName ?? "—"}</div>
                <div className="px-3 py-2.5 text-muted-foreground">{fmtDate(lastActionAt)}</div>
                <div className="px-3 py-2.5">
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      className="rounded-lg"
                      disabled={
                        (selectedReportSession.is_closed && !canEditClosedRevision) ||
                        editEntryMutationPending
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditEntryModal(entry, selectedReportSession.is_closed);
                      }}
                    >
                      {t("common.edit")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="rounded-lg text-destructive hover:text-destructive"
                      disabled={
                        (selectedReportSession.is_closed && !canEditClosedRevision) ||
                        deleteEntryMutationPending
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteEntry(entry);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── mobile list (virtualized) ───────────────────────────────────────────

const CARD_HEIGHT = 140; // px estimate for mobile card

export function ReportItemsMobileList({
  rows,
  selectedReportItemId,
  onSelectItem,
  selectedReportSession,
  canEditClosedRevision,
  editEntryMutationPending,
  openEditEntryModal,
  onDeleteEntry,
  deleteEntryMutationPending,
}: SharedProps) {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT,
    overscan: 10,
  });

  return (
    <div
      ref={scrollRef}
      className="max-h-[70dvh] overflow-y-auto overflow-x-hidden sm:hidden"
    >
      <div
        style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const {
            entry,
            actorDisplayName,
            contributorsCount,
            contributorsPreview,
            lastActionAt,
          } = rows[virtualRow.index];
          const isSelected = selectedReportItemId === entry.item_id;
          return (
            <div
              key={`mobile-${entry.id}`}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-1.5"
            >
              <div
                className={`rounded-xl border p-3 transition-colors ${isSelected ? "border-primary/50 bg-primary/5" : "border-border/50 active:bg-muted/30"}`}
                onClick={() => onSelectItem(entry.item_id)}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold truncate">{entry.item_name}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                    {formatQuantityWithUnit(entry.quantity, entry.unit)}
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{actorDisplayName ?? "—"}</span>
                  <span className="text-border">·</span>
                  <span>{fmtDate(lastActionAt)}</span>
                </div>
                {contributorsCount > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    Добавляли: {contributorsPreview.join(", ")}
                    {contributorsCount > contributorsPreview.length
                      ? ` +${contributorsCount - contributorsPreview.length}`
                      : ""}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t("inventory.reports.col_when")}: {fmtDate(lastActionAt)}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 flex-1 rounded-lg text-xs"
                    disabled={
                      (selectedReportSession.is_closed && !canEditClosedRevision) ||
                      editEntryMutationPending
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditEntryModal(entry, selectedReportSession.is_closed);
                    }}
                  >
                    {t("common.edit")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-lg text-destructive hover:text-destructive"
                    disabled={
                      (selectedReportSession.is_closed && !canEditClosedRevision) ||
                      deleteEntryMutationPending
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteEntry(entry);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
