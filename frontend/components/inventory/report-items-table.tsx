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
      className="hidden sm:block overflow-auto rounded-xl border border-border/70 max-h-[60dvh] lg:max-h-none lg:flex-1 lg:min-h-0"
    >
      <div className="min-w-[600px]">
        {/* header */}
        <div className="sticky top-0 z-10 grid grid-cols-[minmax(120px,1fr)_80px_140px_130px_160px] gap-0 border-b border-border/70 bg-muted/95 text-left text-xs font-semibold uppercase tracking-[0.08em] text-foreground/80 backdrop-blur-sm">
          <div className="px-3 py-3">{t("inventory.reports.col_item")}</div>
          <div className="px-3 py-3">{t("inventory.reports.col_total")}</div>
          <div className="px-3 py-3">{t("inventory.reports.col_last_editor")}</div>
          <div className="px-3 py-3">{t("inventory.reports.col_when")}</div>
          <div className="px-3 py-3">{t("inventory.reports.col_action")}</div>
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
                className={`grid grid-cols-[minmax(120px,1fr)_80px_140px_130px_160px] gap-0 border-b border-border/60 text-sm hover:bg-muted/20 ${isSelected ? "bg-primary/5" : ""}`}
                onClick={() => onSelectItem(entry.item_id)}
              >
                <div className="px-3 py-3 font-medium truncate">{entry.item_name}</div>
                <div className="px-3 py-3 tabular-nums">
                  {formatQuantityWithUnit(entry.quantity, entry.unit)}
                </div>
                <div className="px-3 py-3 truncate">{actorDisplayName ?? "—"}</div>
                <div className="px-3 py-3">{fmtDate(lastActionAt)}</div>
                <div className="px-3 py-3">
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
              className="pb-2"
            >
              <div
                className={`rounded-xl border border-border/70 p-3 ${isSelected ? "bg-primary/5" : ""}`}
                onClick={() => onSelectItem(entry.item_id)}
              >
                <p className="text-sm font-semibold">{entry.item_name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatQuantityWithUnit(entry.quantity, entry.unit)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("inventory.reports.col_last_editor")}: {actorDisplayName ?? "—"}
                </p>
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
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 flex-1 rounded-lg"
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
                    className="h-9 w-9 shrink-0 rounded-lg text-destructive hover:text-destructive"
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
