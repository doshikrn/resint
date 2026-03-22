import { Check, Loader2, Search, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUnit } from "@/lib/format-quantity";
import { useLanguage } from "@/lib/i18n/language-provider";
import { type ItemSearchResult } from "@/lib/api/http";

type QtyValidationView = {
  wasRounded: boolean;
  roundedFrom: number | null;
  roundedTo: number | null;
  error: string | null;
  softWarning: string | null;
};

type InventoryInputCardProps = {
  canSearch: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  searchTerm: string;
  onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  isDropdownOpen: boolean;
  dropdownContent: React.ReactNode;
  showQuickChips: boolean;
  favoriteItems: ItemSearchResult[];
  frequentItems: ItemSearchResult[];
  favoriteIds: Set<number>;
  onChipPointerDown: (item: ItemSearchResult) => void;
  onChipPointerUp: () => void;
  onChipSelect: (item: ItemSearchResult) => void;
  onToggleFavorite: (item: ItemSearchResult) => void;
  qtyInputRef: React.RefObject<HTMLInputElement>;
  qtyInputMode: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  qty: string;
  onQtyChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmitEntry: () => void;
  selectedItem: ItemSearchResult | null;
  qtyValidation: QtyValidationView;
  hotButtons: string[];
  onHotButtonClick: (value: string) => void;
  savePending: boolean;
  canSave: boolean;
};

function ChipsSection({
  title,
  items,
  favoriteIds,
  onChipPointerDown,
  onChipPointerUp,
  onChipSelect,
  onToggleFavorite,
  emptyText,
}: {
  title: string;
  items: ItemSearchResult[];
  favoriteIds: Set<number>;
  onChipPointerDown: (item: ItemSearchResult) => void;
  onChipPointerUp: () => void;
  onChipSelect: (item: ItemSearchResult) => void;
  onToggleFavorite: (item: ItemSearchResult) => void;
  emptyText: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={`${title}-${item.id}`}
              className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-background px-1 py-0.5 transition-all duration-100 hover:border-primary/30 hover:bg-primary/5 active:bg-primary/10 motion-reduce:transition-none"
            >
              <Button
                type="button"
                variant="secondary"
                className="h-6 rounded-md px-1.5 text-xs font-normal transition-colors duration-100 hover:bg-accent active:bg-accent/80 motion-reduce:transition-none"
                onPointerDown={() => onChipPointerDown(item)}
                onPointerUp={onChipPointerUp}
                onPointerLeave={onChipPointerUp}
                onPointerCancel={onChipPointerUp}
                onClick={() => onChipSelect(item)}
              >
                {item.name}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-6 w-6 rounded-md p-0 transition-colors duration-100 hover:bg-muted active:bg-muted/80 motion-reduce:transition-none"
                onClick={() => onToggleFavorite(item)}
              >
                <Star
                  className={`h-4 w-4 ${favoriteIds.has(item.id) ? "fill-amber-400 text-amber-400" : "text-gray-400"}`}
                />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function InventoryInputCard({
  canSearch,
  searchInputRef,
  searchTerm,
  onSearchChange,
  onSearchFocus,
  onSearchBlur,
  onSearchKeyDown,
  isDropdownOpen,
  dropdownContent,
  showQuickChips,
  favoriteItems,
  frequentItems,
  favoriteIds,
  onChipPointerDown,
  onChipPointerUp,
  onChipSelect,
  onToggleFavorite,
  qtyInputRef,
  qtyInputMode,
  qty,
  onQtyChange,
  onSubmitEntry,
  selectedItem,
  qtyValidation,
  hotButtons,
  onHotButtonClick,
  savePending,
  canSave,
}: InventoryInputCardProps) {
  const { t } = useLanguage();

  return (
    <section className="space-y-4 rounded-2xl border border-border/40 bg-card p-4 sm:p-5 md:p-6">
      <h2 className="text-sm font-medium text-muted-foreground">{t("inventory.input.title")}</h2>

      <div className="grid gap-5 md:grid-cols-[2fr_1.25fr_auto]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              data-testid="inventory-search-input"
              ref={searchInputRef}
              placeholder={t("inventory.input.search_placeholder")}
              className="h-12 rounded-xl border border-border/60 bg-background pl-11 pr-4 text-sm placeholder:text-muted-foreground/50 transition-all duration-150 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
              value={searchTerm}
              disabled={!canSearch}
              onChange={onSearchChange}
              onFocus={onSearchFocus}
              onBlur={onSearchBlur}
              onKeyDown={onSearchKeyDown}
            />

            {isDropdownOpen && canSearch ? (
              <div
                data-testid="inventory-search-dropdown"
                className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-border/60 bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
              >
                {dropdownContent}
              </div>
            ) : null}
          </div>

          {showQuickChips ? (
            <div className="space-y-3">
              <ChipsSection
                title={t("inventory.chips.favorites")}
                items={favoriteItems}
                favoriteIds={favoriteIds}
                onChipPointerDown={onChipPointerDown}
                onChipPointerUp={onChipPointerUp}
                onChipSelect={onChipSelect}
                onToggleFavorite={onToggleFavorite}
                emptyText={t("inventory.chips.favorites_empty")}
              />
              <ChipsSection
                title={t("inventory.chips.frequent")}
                items={frequentItems}
                favoriteIds={favoriteIds}
                onChipPointerDown={onChipPointerDown}
                onChipPointerUp={onChipPointerUp}
                onChipSelect={onChipSelect}
                onToggleFavorite={onToggleFavorite}
                emptyText={t("inventory.chips.frequent_empty")}
              />
            </div>
          ) : null}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitEntry();
          }}
          className="space-y-3"
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                data-testid="inventory-qty-input"
                ref={qtyInputRef}
                type="text"
                inputMode={qtyInputMode}
                enterKeyHint="send"
                placeholder={t("inventory.input.qty_placeholder")}
                className={`h-12 w-full rounded-xl border bg-background pr-20 text-lg font-semibold tabular-nums transition-all duration-150 focus-visible:ring-2 motion-reduce:transition-none ${qtyValidation.error ? "border-rose-400 focus-visible:border-rose-500 focus-visible:ring-rose-200" : "border-border/60 focus-visible:border-primary focus-visible:ring-primary/20"}`}
                value={qty}
                disabled={!canSearch || !selectedItem}
                onChange={onQtyChange}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                {formatUnit(selectedItem?.unit)}
              </span>
            </div>
            <Button
              type="submit"
              className="h-12 w-12 shrink-0 rounded-xl bg-emerald-600 text-white shadow-sm transition-all duration-100 hover:bg-emerald-700 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/40 disabled:shadow-none motion-reduce:transition-none md:hidden"
              disabled={!canSave || savePending}
            >
              {savePending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            </Button>
          </div>

          {qtyValidation.wasRounded &&
          qtyValidation.roundedFrom !== null &&
          qtyValidation.roundedTo !== null ? (
            <p className="rounded-lg bg-amber-500/8 px-2 py-1 text-[11px] text-amber-600/90">
              округлено: {qtyValidation.roundedFrom} → {qtyValidation.roundedTo}
            </p>
          ) : null}
          {qtyValidation.error ? (
            <p className="rounded-lg bg-rose-500/8 px-2 py-1 text-[11px] text-rose-600">
              {qtyValidation.error}
            </p>
          ) : null}
          {qtyValidation.softWarning ? (
            <p className="rounded-lg bg-amber-500/8 px-2 py-1 text-[11px] text-amber-600/90">
              {qtyValidation.softWarning}
            </p>
          ) : null}

          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
              {hotButtons.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  className="h-10 rounded-lg border-border/50 bg-background text-sm font-medium tabular-nums transition-colors duration-100 hover:bg-muted/80 active:bg-muted motion-reduce:transition-none"
                  disabled={!canSearch || !selectedItem}
                  onClick={() => onHotButtonClick(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              {t("inventory.input.hot_buttons_hint")}
            </p>
          </div>

          <Button
            data-testid="inventory-save-btn-desktop"
            type="submit"
            className="hidden h-11 w-full rounded-xl bg-emerald-600 text-sm font-semibold text-white shadow-sm transition-all duration-100 hover:bg-emerald-700 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-emerald-500/40 focus-visible:ring-offset-2 disabled:bg-muted disabled:text-muted-foreground/40 disabled:shadow-none motion-reduce:transition-none md:flex"
            disabled={!canSave || savePending}
          >
            {savePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {savePending ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      </div>

      <div className="flex min-h-[28px] items-center gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-[13px]">
        {selectedItem ? (
          <>
            <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-muted-foreground">{t("inventory.input.selected")}:</span>
            <span className="font-medium text-foreground">{selectedItem.name}</span>
            <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">{formatUnit(selectedItem.unit)}</span>
          </>
        ) : (
          <span className="text-muted-foreground/60">{"\u00A0"}</span>
        )}
      </div>
    </section>
  );
}
