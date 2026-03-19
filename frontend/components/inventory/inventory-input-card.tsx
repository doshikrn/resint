import { Check, ClipboardList, Loader2, Search, Star } from "lucide-react";

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
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <div
              key={`${title}-${item.id}`}
              className="flex items-center gap-1 rounded-xl border bg-background px-1.5 py-1 shadow-sm transition-all duration-150 hover:shadow motion-reduce:transition-none"
            >
              <Button
                type="button"
                variant="secondary"
                className="h-7 rounded-lg px-2 text-xs transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
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
                className="h-7 rounded-lg px-2 transition-all duration-150 hover:scale-110 active:scale-95 motion-reduce:transition-none"
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
    <section className="space-y-5 rounded-2xl border border-border/60 bg-card/95 p-4 shadow-sm sm:p-5 md:p-6">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold tracking-tight md:text-lg">
          <ClipboardList className="h-5 w-5 text-primary" /> {t("inventory.input.title")}
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-[2fr_1.25fr_auto]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="inventory-search-input"
              ref={searchInputRef}
              placeholder={t("inventory.input.search_placeholder")}
              className="h-12 rounded-2xl border border-border/60 bg-background/80 pl-11 pr-4 text-sm shadow-sm placeholder:text-muted-foreground/70 transition-colors focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/30"
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
                className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl border border-border/70 bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none"
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
                className={`h-12 w-full rounded-2xl border bg-background/85 pr-20 text-lg font-semibold tabular-nums shadow-sm transition-all duration-150 focus-visible:ring-2 motion-reduce:transition-none ${qtyValidation.error ? "border-rose-500 focus-visible:border-rose-500 focus-visible:ring-rose-300" : "border-border/70 focus-visible:border-primary/40 focus-visible:ring-primary/30"}`}
                value={qty}
                disabled={!canSearch || !selectedItem}
                onChange={onQtyChange}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {formatUnit(selectedItem?.unit)}
              </span>
            </div>
            <Button
              type="submit"
              className="h-12 w-12 shrink-0 rounded-2xl bg-primary text-primary-foreground shadow-md transition-all duration-150 hover:bg-primary/90 active:translate-y-px disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 motion-reduce:transition-none md:hidden"
              disabled={!canSave || savePending}
            >
              {savePending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            </Button>
          </div>

          {qtyValidation.wasRounded &&
          qtyValidation.roundedFrom !== null &&
          qtyValidation.roundedTo !== null ? (
            <p className="rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-700">
              округлено: {qtyValidation.roundedFrom} → {qtyValidation.roundedTo}
            </p>
          ) : null}
          {qtyValidation.error ? (
            <p className="rounded-lg bg-rose-500/10 px-2 py-1 text-xs text-rose-700">
              {qtyValidation.error}
            </p>
          ) : null}
          {qtyValidation.softWarning ? (
            <p className="rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-700">
              {qtyValidation.softWarning}
            </p>
          ) : null}

          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              {hotButtons.map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  className="h-11 rounded-full border border-border/80 bg-background text-sm transition-all duration-150 hover:bg-primary/10 active:scale-95 active:bg-primary active:text-primary-foreground motion-reduce:transition-none"
                  disabled={!canSearch || !selectedItem}
                  onClick={() => onHotButtonClick(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("inventory.input.hot_buttons_hint")}
            </p>
            <div className="h-px w-full bg-border" aria-hidden="true" />
          </div>

          <Button
            data-testid="inventory-save-btn-desktop"
            type="submit"
            className="hidden h-12 min-h-[48px] rounded-2xl bg-primary text-primary-foreground shadow-md transition-all duration-150 hover:bg-primary/90 hover:shadow-lg active:translate-y-px focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 motion-reduce:transition-none md:flex"
            disabled={!canSave || savePending}
          >
            {savePending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {savePending ? t("common.saving") : t("common.save")}
          </Button>
        </form>
      </div>

      <p className="min-h-[20px] text-[13px] text-muted-foreground">
        {selectedItem ? `${t("inventory.input.selected")}: ${selectedItem.name} (${formatUnit(selectedItem.unit)})` : "\u00A0"}
      </p>
    </section>
  );
}
