import { memo, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatQuantityWithUnit, formatUnit } from "@/lib/format-quantity";
import { type InventoryEntrySnapshotRow, type ItemSearchResult } from "@/lib/api/http";
import { Loader2, Plus, Star } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language-provider";

const DROPDOWN_ROW_HEIGHT = 40;
const DROPDOWN_VISIBLE_ROWS = 8;
const DROPDOWN_OVERSCAN = 4;

export const InventorySearchDropdown = memo(function InventorySearchDropdown({
  isLoading,
  items,
  favoriteIds,
  entriesByItemId,
  highlightedIndex,
  hasSearchTerm,
  searchTerm,
  onChoose,
  onToggleFavorite,
  onHover,
  onQuickCreate,
  createPending,
  unitPickerForceOpen,
}: {
  isLoading: boolean;
  items: ItemSearchResult[];
  favoriteIds: Set<number>;
  entriesByItemId: Map<number, InventoryEntrySnapshotRow>;
  highlightedIndex: number;
  hasSearchTerm: boolean;
  searchTerm: string;
  onChoose: (item: ItemSearchResult) => void;
  onToggleFavorite: (item: ItemSearchResult) => void;
  onHover: (index: number) => void;
  onQuickCreate?: (name: string, unit: string) => void;
  createPending?: boolean;
  unitPickerForceOpen?: boolean;
}) {
  const { t } = useLanguage();
  const [scrollTop, setScrollTop] = useState(0);
  const [unitPickerLocalOpen, setUnitPickerLocalOpen] = useState(false);
  const unitPickerOpen = unitPickerLocalOpen || !!unitPickerForceOpen;

  const trimmedSearch = searchTerm.trim();
  const canCreate = !!onQuickCreate && hasSearchTerm && trimmedSearch.length >= 3;

  const formatSnapshotTime = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Almaty",
    }).format(date);
  }, []);

  useEffect(() => {
    setScrollTop(0);
  }, [items]);

  // Reset unit picker when search text changes
  useEffect(() => {
    setUnitPickerLocalOpen(false);
  }, [searchTerm]);

  if (isLoading) {
    return <p className="px-2 py-2 text-sm text-muted-foreground">{t("inventory.input.searching")}</p>;
  }

  const quickCreateRow = canCreate ? (
    unitPickerOpen ? (
      <div className="flex items-center gap-2 px-2 py-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {trimmedSearch}
        </span>
        {createPending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            {(["кг", "л", "шт"] as const).map((u) => (
              <Button
                key={u}
                type="button"
                variant="outline"
                className="h-8 rounded-lg px-3 text-xs font-medium"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onQuickCreate!(trimmedSearch, u);
                }}
              >
                {u}
              </Button>
            ))}
          </>
        )}
      </div>
    ) : (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm text-primary hover:bg-primary/5 transition-colors duration-150"
        onMouseDown={(e) => {
          e.preventDefault();
          setUnitPickerLocalOpen(true);
        }}
      >
        <Plus className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {t("inventory.create_item.add_new")}: <span className="font-medium">{trimmedSearch}</span>
        </span>
      </button>
    )
  ) : hasSearchTerm && trimmedSearch.length > 0 && trimmedSearch.length < 3 ? (
    <p className="px-2 py-1.5 text-xs text-muted-foreground">
      {t("inventory.create_item.min_chars")}
    </p>
  ) : null;

  if (items.length === 0) {
    return (
      <div>
        <p className="px-2 py-2 text-sm text-muted-foreground">
          {hasSearchTerm ? t("inventory.input.nothing_found") : t("inventory.input.search_placeholder")}
        </p>
        {quickCreateRow}
      </div>
    );
  }

  const totalHeight = items.length * DROPDOWN_ROW_HEIGHT;
  const viewportHeight = Math.min(
    256,
    Math.max(
      DROPDOWN_ROW_HEIGHT,
      Math.min(items.length, DROPDOWN_VISIBLE_ROWS) * DROPDOWN_ROW_HEIGHT,
    ),
  );
  const rawStartIndex = Math.floor(scrollTop / DROPDOWN_ROW_HEIGHT);
  const startIndex = Math.max(0, rawStartIndex - DROPDOWN_OVERSCAN);
  const endIndex = Math.min(
    items.length,
    startIndex + DROPDOWN_VISIBLE_ROWS + DROPDOWN_OVERSCAN * 2,
  );
  const virtualItems = items.slice(startIndex, endIndex);

  return (
    <div>
      <div
        className="max-h-64 overflow-auto"
        style={{ height: viewportHeight }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
        }}
      >
      <div className="relative" style={{ height: totalHeight }}>
        {virtualItems.map((item, offset) => {
          const index = startIndex + offset;
          return (
            <div
              key={item.id}
              className={`absolute left-0 right-0 flex h-10 items-center gap-2 rounded-xl px-2 text-left text-sm transition-colors duration-150 ${
                index === highlightedIndex ? "bg-primary/10 text-primary" : "hover:bg-primary/5"
              }`}
              style={{ top: index * DROPDOWN_ROW_HEIGHT }}
              onMouseEnter={() => onHover(index)}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-2 py-1 text-left"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChoose(item);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.name}</span>
                  {(() => {
                    const snapshot = entriesByItemId.get(item.id);
                    if (!snapshot) {
                      return null;
                    }

                    return (
                      <span className="block truncate text-xs text-muted-foreground">
                        Итог: {formatQuantityWithUnit(snapshot.qty, item.unit)} • Последний:{" "}
                        {snapshot.updated_by_user.display_name ?? snapshot.updated_by_user.username}{" "}
                        {formatSnapshotTime(snapshot.updated_at)}
                      </span>
                    );
                  })()}
                </span>
                <span className="ml-3 shrink-0 text-muted-foreground">{formatUnit(item.unit)}</span>
              </button>
              <Button
                type="button"
                variant="ghost"
                className="h-7 w-7 rounded-lg p-0 transition-all duration-150 hover:scale-110 active:scale-95"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFavorite(item);
                }}
              >
                <Star
                  className={`h-4 w-4 ${favoriteIds.has(item.id) ? "fill-amber-400 text-amber-400" : "text-gray-400"}`}
                />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
    {quickCreateRow}
    </div>
  );
});
