"use client";

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InventoryInputCard } from "@/components/inventory/inventory-input-card";
import { InventorySearchDropdown } from "@/components/inventory/inventory-search-dropdown";
import { ProgressCard } from "@/components/inventory/progress-card";
import { RecentEntriesCard } from "@/components/inventory/recent-entries-card";
import { QueueRepairSheet } from "@/components/inventory/queue-repair-sheet";
import { SuccessGlow } from "@/components/inventory/success-glow";
import type { UseFastEntryReturn } from "@/lib/hooks/use-fast-entry";
import { useLanguage } from "@/lib/i18n/language-provider";
import type { InventorySession } from "@/lib/api/http";

// ─── Props ───────────────────────────────────────────────────────────

export type FastEntryContainerProps = {
  session: InventorySession | null;
  isClosed: boolean;
  selectedWarehouseId: number | null;
  canSearch: boolean;
  canManageRevision: boolean;
  activeSessionLoading: boolean;
  fe: UseFastEntryReturn;
  setInventoryView: (view: "revision" | "management" | "reports") => void;
  canExportClosedSession: boolean;
  exportPending: boolean;
  onExport: (sessionId: number) => void;
};

// ─── Component ───────────────────────────────────────────────────────

export function FastEntryContainer(props: FastEntryContainerProps) {
  const {
    session,
    isClosed,
    selectedWarehouseId,
    canSearch,
    canManageRevision,
    activeSessionLoading,
    fe,
    setInventoryView,
    canExportClosedSession,
    exportPending,
    onExport,
  } = props;

  const { t } = useLanguage();

  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [rightPanelHeightPx, setRightPanelHeightPx] = useState<number | null>(null);

  // Height sync: right panel matches left column on desktop
  useEffect(() => {
    if (typeof window === "undefined") {
      setRightPanelHeightPx(null);
      return;
    }

    const updateHeight = () => {
      if (window.innerWidth < 1024) {
        setRightPanelHeightPx(null);
        return;
      }
      const leftHeight = leftColumnRef.current?.offsetHeight ?? 0;
      setRightPanelHeightPx(leftHeight > 0 ? leftHeight : null);
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    if (leftColumnRef.current) {
      observer.observe(leftColumnRef.current);
    }

    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  const showRevisionNotStarted =
    !canManageRevision &&
    selectedWarehouseId !== null &&
    !session &&
    !activeSessionLoading;

  if (showRevisionNotStarted) {
    return (
      <div className="rounded-2xl border border-dashed bg-card px-6 py-16 text-center shadow-sm">
        <p className="text-base font-medium">{t("inventory.session.waiting_start")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("inventory.session.not_started_hint")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid min-w-0 w-full gap-4 md:flex-1 md:min-h-0 lg:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] lg:gap-5 lg:items-stretch">
        <div
          ref={leftColumnRef}
          className="h-full min-h-0 flex flex-col gap-4 lg:gap-5 lg:overflow-y-auto"
        >
          {isClosed ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border/70 bg-card/95 px-4 py-3 shadow-sm">
              <p className="text-sm text-muted-foreground">
                {t("inventory.session.closed_input_blocked")}
              </p>
              {canManageRevision ? (
                <Button
                  type="button"
                  className="rounded-xl"
                  onClick={() => setInventoryView("management")}
                >
                  {t("inventory.session.go_to_management")}
                </Button>
              ) : null}
              {canExportClosedSession && session ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-xl"
                  disabled={exportPending}
                  onClick={() => {
                    onExport(session.id);
                  }}
                >
                  {exportPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {exportPending ? t("common.generating_excel") : t("common.download_excel")}
                </Button>
              ) : null}
              <Button asChild variant="secondary" className="rounded-xl">
                <Link href="/reports">{t("inventory.session.go_to_reports")}</Link>
              </Button>
            </div>
          ) : null}

          {!isClosed && !canSearch ? (
            <div className="rounded-xl border border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-800 shadow-sm">
              {t("inventory.session.not_started_search_hint")}
            </div>
          ) : null}

          <InventoryInputCard
            canSearch={canSearch}
            searchInputRef={fe.searchInputRef}
            searchTerm={fe.searchTerm}
            onSearchChange={fe.handleSearchInputChange}
            onSearchFocus={fe.handleSearchInputFocus}
            onSearchBlur={fe.handleSearchInputBlur}
            onSearchKeyDown={fe.handleSearchKeyDown}
            isDropdownOpen={fe.isDropdownOpen}
            dropdownContent={
              <InventorySearchDropdown
                isLoading={
                  (fe.debouncedSearchTerm.trim().length > 0
                    ? fe.catalogLoading && !fe.catalogItems?.length
                    : false) ||
                  false
                }
                items={fe.itemOptions}
                favoriteIds={fe.favoriteIds}
                entriesByItemId={fe.entriesSnapshotByItemId}
                highlightedIndex={fe.highlightedIndex}
                hasSearchTerm={fe.debouncedSearchTerm.trim().length > 0}
                searchTerm={fe.searchTerm}
                onChoose={fe.chooseItem}
                onToggleFavorite={fe.toggleFavorite}
                onHover={fe.handleDropdownHover}
                onQuickCreate={fe.handleQuickCreateItem}
                createPending={fe.quickCreatePending}
                unitPickerForceOpen={fe.quickCreateUnitPickerOpen}
              />
            }
            showQuickChips={Boolean(canSearch && selectedWarehouseId)}
            favoriteItems={fe.favoriteItems}
            frequentItems={fe.frequentItems}
            favoriteIds={fe.favoriteIds}
            onChipPointerDown={fe.handleChipPointerDown}
            onChipPointerUp={fe.clearLongPress}
            onChipSelect={fe.handleChipSelect}
            onToggleFavorite={fe.toggleFavorite}
            qtyInputRef={fe.qtyInputRef}
            qtyInputMode={fe.qtyInputMode}
            qty={fe.qty}
            onQtyChange={fe.handleQtyInputChange}
            onSubmitEntry={() => {
              void fe.submitEntry();
            }}
            selectedItem={fe.selectedItem}
            qtyValidation={fe.qtyValidation}
            hotButtons={fe.hotButtons}
            onHotButtonClick={fe.applyHotButton}
            savePending={fe.savePending}
            canSave={fe.canSave}
          />

          <ProgressCard
            sessionProgressLoading={fe.sessionProgressLoading}
            sessionProgress={fe.sessionProgress}
            formatDateTime={fe.formatDateTime}
          />
        </div>

        <div
          className="h-full min-h-0"
          style={rightPanelHeightPx ? { height: `${rightPanelHeightPx}px` } : undefined}
        >
          <RecentEntriesCard
            isLoading={fe.recentEventsLoading}
            groups={fe.groupedRecentJournal}
            formatDateTime={fe.formatDateTime}
            filterMine={fe.recentFilterMine}
            onFilterChange={fe.setRecentFilterMine}
            onDismissConflict={fe.handleDismissConflict}
            favoriteIds={fe.favoriteIds}
            onToggleFavorite={fe.toggleFavoriteById}
          />
        </div>
      </div>

      {fe.pendingQtyConfirm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-4 shadow-lg">
            <h3 className="text-base font-semibold">{t("confirm.suspicious_value")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("confirm.check_qty")}
            </p>
            <div className="mt-3 space-y-1 rounded-md border bg-background px-3 py-2 text-sm">
              {fe.pendingQtyConfirm.warnings.map((warning) => (
                <p key={warning} className="text-amber-600">
                  • {warning}
                </p>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fe.setPendingQtyConfirm(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={fe.savePending}
                onClick={() => {
                  const nextQty = fe.pendingQtyConfirm!.normalizedQty;
                  fe.setPendingQtyConfirm(null);
                  void fe.submitEntryWithQuantity(nextQty);
                }}
              >
                {fe.savePending ? t("common.saving") : t("confirm.yes_save")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <SuccessGlow key={fe.saveGlowKey} active={fe.saveGlowActive} />

      <QueueRepairSheet
        open={fe.queueRepairOpen}
        onOpenChange={fe.setQueueRepairOpen}
        items={fe.offlineQueue}
        onRetryOne={fe.handleQueueRetryOne}
        onDeleteOne={fe.handleQueueDeleteOne}
        onRetryAllFailed={fe.handleQueueRetryAllFailed}
        formatDateTime={fe.formatDateTime}
      />
    </>
  );
}
