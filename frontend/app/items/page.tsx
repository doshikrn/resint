"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Pencil } from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ApiRequestError,
  bulkUpsertItems,
  createItem,
  getItems,
  getItemUnits,
  getWarehouses,
  getZones,
  patchItem,
  type ItemBulkUpsertResult,
  type ItemCatalog,
} from "@/lib/api/http";
import { parseBulkLines } from "@/lib/items/bulk-parser";
import { cn } from "@/lib/utils";
import { canManageCatalog } from "@/lib/permissions";
import { useLanguage } from "@/lib/i18n/language-provider";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import type { DictionaryKeys } from "@/lib/i18n/dictionaries/ru";

type ItemDraft = {
  product_code?: string;
  name: string;
  unit: string;
  is_active: boolean;
};

type ZoneCode = "kitchen" | "bar";

type MenuOption = {
  value: string;
  label: string;
  group?: string;
};

type CatalogIssueField = "product_code" | "name" | "unit";

type CatalogIssue = {
  id: string;
  itemId: number | null;
  itemLabel: string;
  field?: CatalogIssueField;
  message: string;
  source: "save" | "bulk";
  severity: "error" | "warning";
};

const BULK_UPSERT_CHUNK_SIZE = 100;


function parseCreateItemError(error: unknown, t: (key: DictionaryKeys) => string): { message: string; field?: "product_code" | "name" } {
  if (error instanceof ApiRequestError) {
    const body = error.body;
    try {
      const json = JSON.parse(body) as { detail?: string };
      const detail = (json.detail ?? "").toLowerCase();
      if (detail.includes("product_code") && (detail.includes("already") || detail.includes("exists") || detail.includes("duplicate"))) {
        return { message: t("items.err_duplicate_code"), field: "product_code" };
      }
      if (detail.includes("name") && (detail.includes("already") || detail.includes("exists") || detail.includes("duplicate"))) {
        return { message: t("items.err_duplicate_name"), field: "name" };
      }
      if (detail.includes("product_code") && detail.includes("5 digits")) {
        return { message: t("items.err_code_format"), field: "product_code" };
      }
      if (json.detail) {
        return { message: json.detail };
      }
    } catch {
      // not JSON
    }
    if (error.status === 409) {
      return { message: t("items.err_duplicate_item"), field: "product_code" };
    }
    return { message: body || `${t("items.err_server")} (${error.status})` };
  }
  return { message: error instanceof Error ? error.message : t("items.err_create_fallback") };
}

function normalizeBulkText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\u00A0/g, " ");
}

async function bulkUpsertInChunks(payload: {
  rows: Array<{ product_code?: string; name: string; unit: string }>;
  dry_run?: boolean;
  default_warehouse_id?: number;
}): Promise<ItemBulkUpsertResult> {
  const rows = payload.rows;
  if (rows.length === 0) {
    return {
      dry_run: payload.dry_run ?? true,
      total: 0,
      created: 0,
      updated: 0,
      skipped_existing: 0,
      errors: [],
    };
  }

  if (rows.length <= BULK_UPSERT_CHUNK_SIZE) {
    return bulkUpsertItems(payload);
  }

  let total = 0;
  let created = 0;
  let updated = 0;
  let skipped_existing = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (let offset = 0; offset < rows.length; offset += BULK_UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + BULK_UPSERT_CHUNK_SIZE);
    const result = await bulkUpsertItems({
      ...payload,
      rows: chunk,
    });
    total += result.total;
    created += result.created;
    updated += result.updated;
    skipped_existing += result.skipped_existing;
    errors.push(
      ...result.errors.map((entry) => ({
        row: entry.row + offset,
        message: entry.message,
      })),
    );
  }

  return {
    dry_run: payload.dry_run ?? true,
    total,
    created,
    updated,
    skipped_existing,
    errors,
  };
}

function zoneMatchesCode(zoneName: string, zoneCode: ZoneCode): boolean {
  const normalized = zoneName.trim().toLowerCase();
  if (zoneCode === "kitchen") {
    return normalized.includes("kitchen") || normalized.includes("кух");
  }
  return normalized.includes("bar") || normalized.includes("бар");
}

function hasCatalogManagerAccess(
  profile: { role?: string | null; role_label?: string | null } | null | undefined,
): boolean {
  return canManageCatalog(profile?.role ?? "");
}

function MenuSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  testId,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  options: MenuOption[];
  placeholder: string;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;
  const grouped = options.reduce<Array<{ group: string; options: MenuOption[] }>>((acc, option) => {
    const group = option.group ?? "";
    const existing = acc.find((entry) => entry.group === group);
    if (existing) {
      existing.options.push(option);
      return acc;
    }
    acc.push({ group, options: [option] });
    return acc;
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-testid={testId}
          disabled={disabled || options.length === 0}
          className={cn(
            "h-10 w-full justify-between rounded-xl border-input bg-background px-3 text-sm font-normal shadow-sm",
            className,
          )}
        >
          <span className="truncate text-left">{selectedLabel}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 sm:min-w-[18rem] max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("items.menu_current")}
        </DropdownMenuLabel>
        <div className="px-2 pb-2 text-sm font-medium">{selectedLabel}</div>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t("items.menu_select")}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {grouped.map((entry, index) => (
            <div key={`${entry.group}-${index}`}>
              {entry.group ? (
                <DropdownMenuLabel className="pb-0 pt-1 text-xs font-medium text-muted-foreground">
                  {entry.group}
                </DropdownMenuLabel>
              ) : null}
              {entry.options.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
              {index < grouped.length - 1 ? <DropdownMenuSeparator /> : null}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ─── Memoized table row — local input state prevents parent re-renders ───── */
const ItemRow = memo(function ItemRow({
  item,
  index,
  isHighlighted,
  isCatalogManager,
  unitOptions,
  status,
  isDeletePending,
  onSave,
  onDelete,
  rowRefsMap,
  t,
}: {
  item: ItemCatalog;
  index: number;
  isHighlighted: boolean;
  isCatalogManager: boolean;
  unitOptions: MenuOption[];
  status: "saving" | "saved" | "error" | undefined;
  isDeletePending: boolean;
  onSave: (itemId: number, payload: ItemDraft) => void;
  onDelete: (itemId: number) => void;
  rowRefsMap: React.MutableRefObject<Map<number, HTMLTableRowElement>>;
  t: (key: DictionaryKeys) => string;
}) {
  const [code, setCode] = useState(item.product_code ?? "");
  const [name, setName] = useState(item.name);
  const [unit, setUnit] = useState(item.unit);
  const [isActive, setIsActive] = useState(item.is_active);

  useEffect(() => {
    if (saveTimerRef.current) return;
    if (status === "saving") return;
    setCode(item.product_code ?? "");
    setName(item.name);
    setUnit(item.unit);
    setIsActive(item.is_active);
  }, [item.product_code, item.name, item.unit, item.is_active, status]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const queueSave = useCallback(
    (draft: ItemDraft) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = undefined;
        onSaveRef.current(item.id, draft);
      }, 400);
    },
    [item.id],
  );

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  const trRef = useCallback(
    (el: HTMLTableRowElement | null) => {
      if (el) rowRefsMap.current.set(item.id, el);
      else rowRefsMap.current.delete(item.id);
    },
    [item.id, rowRefsMap],
  );

  return (
    <tr
      ref={trRef}
      data-item-id={item.id}
      className={cn(
        "border-b border-border/60 align-top transition-colors duration-300",
        isHighlighted ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/20",
      )}
    >
      <td className="px-2 py-2 text-muted-foreground">{index + 1}</td>
      <td className="px-2 py-2">
        {isCatalogManager ? (
          <Input
            data-item-field="product_code"
            value={code}
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setCode(v);
              queueSave({ product_code: v, name, unit, is_active: isActive });
            }}
          />
        ) : (
          <span className="text-muted-foreground">
            {item.product_code?.trim() ? item.product_code : "—"}
          </span>
        )}
      </td>
      <td className="px-2 py-2">
        <Input
          data-item-field="name"
          value={name}
          disabled={!isCatalogManager}
          onChange={(e) => {
            const v = e.target.value;
            setName(v);
            queueSave({ product_code: code, name: v, unit, is_active: isActive });
          }}
        />
      </td>
      <td className="px-2 py-2">
        <MenuSelect
          value={unit}
          onChange={(next) => {
            setUnit(next);
            queueSave({ product_code: code, name, unit: next, is_active: isActive });
          }}
          options={unitOptions}
          placeholder={t("items.unit_placeholder")}
          disabled={!isCatalogManager}
          className="h-10"
        />
      </td>
      <td className="px-2 py-2">
        <label className="flex h-10 items-center gap-2">
          <input
            type="checkbox"
            disabled={!isCatalogManager}
            checked={isActive}
            onChange={(e) => {
              const v = e.target.checked;
              setIsActive(v);
              queueSave({ product_code: code, name, unit, is_active: v });
            }}
          />
          <span>{isActive ? t("items.active_yes") : t("items.active_no")}</span>
        </label>
      </td>
      <td className="px-2 py-2">
        <span className="text-xs text-muted-foreground">
          {status === "saving" ? t("items.status_saving") : null}
          {status === "saved" ? t("items.status_saved") : null}
          {status === "error" ? t("items.status_error") : null}
          {!status ? "—" : null}
        </span>
      </td>
      <td className="px-2 py-2">
        <Button
          type="button"
          variant="outline"
          disabled={!isCatalogManager || isDeletePending}
          onClick={() => onDelete(item.id)}
        >
          {t("items.delete_button")}
        </Button>
      </td>
    </tr>
  );
});

export default function ItemsPage() {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [selectedZone, setSelectedZone] = useState<ZoneCode>("kitchen");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = t("items.page_title");
  }, [t]);

  const [newProductCode, setNewProductCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("pcs");

  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState<ItemBulkUpsertResult | null>(null);
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<{ message: string; field?: "product_code" | "name" } | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<number, "saving" | "saved" | "error">>({});
  const bulkTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [bulkEditorHeight, setBulkEditorHeight] = useState(220);
  const [catalogIssues, setCatalogIssues] = useState<CatalogIssue[]>([]);

  // Mobile edit sheet state
  const [editingItem, setEditingItem] = useState<ItemCatalog | null>(null);
  const [sheetCode, setSheetCode] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sheetUnit, setSheetUnit] = useState("pcs");
  const [sheetActive, setSheetActive] = useState(true);

  const { user: effectiveUser } = useCurrentUser();
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: getZones,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const warehousesQuery = useQuery({
    queryKey: ["warehouses-by-zone", selectedZone],
    queryFn: async () => {
      const matchingZone = (zonesQuery.data ?? []).find((zone) =>
        zoneMatchesCode(zone.name, selectedZone),
      );
      if (!matchingZone) {
        return [];
      }
      return getWarehouses(matchingZone.id);
    },
    enabled: zonesQuery.isSuccess,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const unitsQuery = useQuery({
    queryKey: ["item-units"],
    queryFn: getItemUnits,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const isCatalogManager = hasCatalogManagerAccess(effectiveUser);
  const isCurrentUserLoaded = effectiveUser !== null;
  const showCatalogRoleWarning = isCurrentUserLoaded && !isCatalogManager;
  const resolvedWarehouseId = selectedWarehouseId;
  const showWarehouseWarning =
    isCurrentUserLoaded && warehousesQuery.isSuccess && !resolvedWarehouseId;

  const itemsQuery = useQuery({
    queryKey: ["items-catalog", resolvedWarehouseId],
    queryFn: () =>
      getItems({
        warehouseId: resolvedWarehouseId,
      }),
    enabled: resolvedWarehouseId !== null,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
  });

  // --- Local search: dropdown with all matches ---
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefsMap = useRef<Map<number, HTMLTableRowElement>>(new Map());
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const deferredSearch = useDeferredValue(search);

  const searchResults = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q || !itemsQuery.data) return [];
    return itemsQuery.data.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.product_code ?? "").toLowerCase().includes(q),
    );
  }, [deferredSearch, itemsQuery.data]);

  useEffect(() => {
    setSearchOpen(searchResults.length > 0 && search.trim().length > 0);
  }, [searchResults, search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const scrollToItem = useCallback(
    (itemId: number, field?: CatalogIssueField) => {
      setHighlightedItemId(itemId);
      setSearchOpen(false);
      requestAnimationFrame(() => {
        let row: Element | null = rowRefsMap.current.get(itemId) ?? null;
        // Fallback: ref may point to a hidden element (responsive breakpoint)
        if (!row || !(row as HTMLElement).offsetParent) {
          const candidates = document.querySelectorAll<HTMLElement>(`[data-item-id="${itemId}"]`);
          row = Array.from(candidates).find((el) => el.offsetParent !== null) ?? null;
        }
        if (!row) return;
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        if (field) {
          requestAnimationFrame(() => {
            const input = row.querySelector<HTMLInputElement>(`[data-item-field="${field}"]`);
            input?.focus();
          });
        }
      });
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightedItemId(null), 3000);
    },
    [],
  );

  const scrollToFirstMatch = useCallback(() => {
    if (searchResults.length > 0) scrollToItem(searchResults[0].id);
  }, [searchResults, scrollToItem]);

  const warehouseOptions = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);

  const zoneOptions = useMemo<MenuOption[]>(
    () =>
      isCatalogManager
        ? [
            { value: "kitchen", label: t("items.zone_kitchen") },
            { value: "bar", label: t("items.zone_bar") },
          ]
        : [{ value: "kitchen", label: t("items.zone_kitchen") }],
    [isCatalogManager, t],
  );

  useEffect(() => {
    if (!isCatalogManager && selectedZone !== "kitchen") {
      setSelectedZone("kitchen");
    }
  }, [isCatalogManager, selectedZone]);

  useEffect(() => {
    if (warehousesQuery.isLoading && warehouseOptions.length === 0) {
      return;
    }

    if (
      selectedWarehouseId !== null &&
      warehouseOptions.some((warehouse) => warehouse.id === selectedWarehouseId)
    ) {
      return;
    }

    const defaultWarehouseId = effectiveUser?.default_warehouse_id ?? null;
    if (
      defaultWarehouseId &&
      warehouseOptions.some((warehouse) => warehouse.id === defaultWarehouseId)
    ) {
      if (selectedWarehouseId !== defaultWarehouseId) {
        setSelectedWarehouseId(defaultWarehouseId);
      }
      return;
    }

    setSelectedWarehouseId(warehouseOptions[0]?.id ?? null);
  }, [
    effectiveUser?.default_warehouse_id,
    selectedWarehouseId,
    warehouseOptions,
    warehousesQuery.isLoading,
  ]);

  const createMutation = useMutation({
    mutationFn: createItem,
    onSuccess: async () => {
      setCreateError(null);
      setInlineMessage(t("items.msg_created"));
      setNewProductCode("");
      setNewName("");
      await queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
    },
    onError: (error) => {
      const parsed = parseCreateItemError(error, t);
      setCreateError(parsed);
      setInlineMessage(null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ itemId, payload }: { itemId: number; payload: Partial<ItemDraft> }) =>
      patchItem(itemId, payload),
    onSuccess: (result, variables) => {
      setRowStatus((prev) => ({ ...prev, [variables.itemId]: "saved" }));
      setCatalogIssues((prev) => prev.filter((issue) => !(issue.source === "save" && issue.itemId === variables.itemId)));
      queryClient.setQueryData<ItemCatalog[]>(
        ["items-catalog", resolvedWarehouseId],
        (old) => old?.map((item) => (item.id === variables.itemId ? result : item)),
      );
    },
    onError: (error, variables) => {
      setRowStatus((prev) => ({ ...prev, [variables.itemId]: "error" }));
      const msg = error instanceof Error ? error.message : t("items.msg_save_error");
      setInlineMessage(msg);
      const item = (itemsQuery.data ?? []).find((i) => i.id === variables.itemId);
      const issue: CatalogIssue = {
        id: `save-${variables.itemId}`,
        itemId: variables.itemId,
        itemLabel: item?.name ?? `#${variables.itemId}`,
        message: msg,
        source: "save",
        severity: "error",
      };
      setCatalogIssues((prev) => [
        ...prev.filter((i) => i.id !== issue.id),
        issue,
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: number) => patchItem(itemId, { is_active: false }),
    onSuccess: async () => {
      setInlineMessage(t("items.msg_deleted"));
      await queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
    },
    onError: (error) => {
      setInlineMessage(error instanceof Error ? error.message : t("items.msg_delete_error"));
    },
  });

  const bulkMutation = useMutation({
    mutationFn: bulkUpsertInChunks,
    onSuccess: async (result) => {
      setBulkResult(result);
      if (result.dry_run) {
        setInlineMessage(t("items.msg_bulk_check_done"));
      } else if (result.errors.length > 0) {
        setInlineMessage(t("items.msg_bulk_partial"));
      } else {
        setInlineMessage(t("items.msg_bulk_done"));
      }
      // Build issues from bulk API errors (non-dry-run only)
      if (!result.dry_run && result.errors.length > 0) {
        const catalogItems = itemsQuery.data ?? [];
        const bulkIssues: CatalogIssue[] = result.errors.map((err) => {
          const sourceRow = parsedBulk.rows[err.row];
          const label = sourceRow
            ? sourceRow.product_code
              ? `${sourceRow.product_code} — ${sourceRow.name}`
              : sourceRow.name
            : `${t("items.issues_row_label")} ${err.row + 1}`;

          // Conservative matching: prefer product_code (unique), fallback to exact name match
          let matchedId: number | null = null;
          let matchField: CatalogIssueField | undefined;
          if (sourceRow?.product_code) {
            const codeMatches = catalogItems.filter(
              (item) => item.product_code === sourceRow.product_code,
            );
            if (codeMatches.length === 1) {
              matchedId = codeMatches[0].id;
              matchField = "product_code";
            }
          }
          if (matchedId === null && sourceRow?.name) {
            const nameMatches = catalogItems.filter(
              (item) => item.name.toLowerCase() === sourceRow.name.toLowerCase(),
            );
            if (nameMatches.length === 1) {
              matchedId = nameMatches[0].id;
              matchField = "name";
            }
          }

          return {
            id: `bulk-${err.row}`,
            itemId: matchedId,
            itemLabel: label,
            field: matchField,
            message: err.message,
            source: "bulk" as const,
            severity: "error" as const,
          };
        });
        setCatalogIssues((prev) => [
          ...prev.filter((i) => i.source !== "bulk"),
          ...bulkIssues,
        ]);
        await queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      } else if (!result.dry_run && result.errors.length === 0) {
        setCatalogIssues((prev) => prev.filter((i) => i.source !== "bulk"));
        await queryClient.invalidateQueries({ queryKey: ["items-catalog"] });
      }
    },
    onError: (error) => {
      setInlineMessage(error instanceof Error ? error.message : t("items.msg_bulk_error"));
    },
  });

  const units = useMemo(
    () =>
      (
        unitsQuery.data ?? [
          { code: "kg", label: "кг" },
          { code: "l", label: "л" },
          { code: "pcs", label: "шт" },
        ]
      ).filter((unit) => unit.code !== "pack" && unit.code !== "bottle"),
    [unitsQuery.data],
  );

  const unitOptions = useMemo<MenuOption[]>(
    () => units.map((unit) => ({ value: unit.code, label: `${unit.label} (${unit.code})` })),
    [units],
  );

  // Stable callbacks for memoized rows (ref pattern avoids re-renders)
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;
  const deleteMutationRef = useRef(deleteMutation);
  deleteMutationRef.current = deleteMutation;

  const handleItemSave = useCallback(
    (itemId: number, draft: ItemDraft) => {
      setRowStatus((prev) => ({ ...prev, [itemId]: "saving" }));
      saveMutationRef.current.mutate({
        itemId,
        payload: {
          product_code: draft.product_code?.trim().toUpperCase() || undefined,
          name: draft.name.trim(),
          unit: draft.unit,
          is_active: draft.is_active,
        },
      });
    },
    [],
  );

  const handleItemDelete = useCallback((itemId: number) => {
    deleteMutationRef.current.mutate(itemId);
  }, []);

  const openEditSheet = useCallback((item: ItemCatalog) => {
    setSheetCode(item.product_code ?? "");
    setSheetName(item.name);
    setSheetUnit(item.unit);
    setSheetActive(item.is_active);
    setEditingItem(item);
  }, []);

  const saveAndCloseSheet = useCallback(() => {
    if (!editingItem) return;
    handleItemSave(editingItem.id, {
      product_code: sheetCode,
      name: sheetName,
      unit: sheetUnit,
      is_active: sheetActive,
    });
    setEditingItem(null);
  }, [editingItem, sheetCode, sheetName, sheetUnit, sheetActive, handleItemSave]);

  useEffect(() => {
    const textarea = bulkTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const nextHeight = Math.max(220, textarea.scrollHeight);
    textarea.style.height = `${nextHeight}px`;
    setBulkEditorHeight(nextHeight);
  }, [bulkText]);

  const deferredBulkText = useDeferredValue(bulkText);

  const parsedBulk = useMemo(() => parseBulkLines(deferredBulkText), [deferredBulkText]);
  const uploadLineNumbers = useMemo(() => {
    const count = deferredBulkText.length === 0 ? 1 : deferredBulkText.split(/\r?\n/).length;
    return Array.from({ length: count }, (_, index) => index + 1);
  }, [deferredBulkText]);

  return (
    <section className="space-y-6 rounded-3xl border border-border/60 bg-card/65 p-3 shadow-sm md:p-5">
      <header className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t("items.heading")}</h1>
        <p className="mt-3 max-w-2xl border-t pt-3 text-sm leading-relaxed text-muted-foreground">
          {t("items.description")}
        </p>
      </header>

      {showCatalogRoleWarning ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          {t("items.role_warning")}
        </div>
      ) : null}

      <div className="grid gap-4 rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm md:grid-cols-3">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("items.zone_label")}
          </span>
          <MenuSelect
            value={selectedZone}
            onChange={(next) => setSelectedZone(next as ZoneCode)}
            options={zoneOptions}
            placeholder={t("items.zone_placeholder")}
            disabled={!isCatalogManager}
          />
        </div>

        <div ref={searchContainerRef} className="relative space-y-1 md:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {t("items.search_label")}
          </span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              scrollToFirstMatch();
            }}
          >
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onFocus={() => {
                if (searchResults.length > 0) setSearchOpen(true);
              }}
              enterKeyHint="search"
              placeholder={t("items.search_placeholder")}
            />
          </form>
          {searchOpen && searchResults.length > 0 && (
            <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border/70 bg-card shadow-lg">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
                {t("items.search_found")}: {searchResults.length}
              </div>
              {searchResults.slice(0, 50).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 transition-colors"
                  onClick={() => scrollToItem(item.id)}
                >
                  <span className="min-w-[3.5rem] shrink-0 font-mono text-xs text-muted-foreground">
                    {item.product_code?.trim() ? item.product_code : "—"}
                  </span>
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight">{t("items.add_one_title")}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-4">

          <Input
            placeholder={t("items.add_one_code_placeholder")}
            value={newProductCode}
            onChange={(event) => { setNewProductCode(event.target.value.toUpperCase()); setCreateError(null); }}
            className={cn("md:h-10 h-12 text-base md:text-sm", createError?.field === "product_code" && "border-destructive ring-1 ring-destructive/40")}
          />

          <Input
            placeholder={t("items.add_one_name_placeholder")}
            value={newName}
            onChange={(event) => { setNewName(event.target.value); setCreateError(null); }}
            className={cn("md:h-10 h-12 text-base md:text-sm", createError?.field === "name" && "border-destructive ring-1 ring-destructive/40")}
          />

          <MenuSelect
            value={newUnit}
            onChange={setNewUnit}
            options={unitOptions}
            placeholder={t("items.unit_placeholder")}
            className="md:h-10 h-12 text-base md:text-sm"
          />

          <Button
            type="button"
            className="h-12 text-base md:h-10 md:text-sm"
            disabled={
              !isCatalogManager ||
              !resolvedWarehouseId ||
              !newName.trim() ||
              createMutation.isPending
            }
            onClick={() => {
              if (!resolvedWarehouseId) return;
              createMutation.mutate({
                product_code: newProductCode.trim() ? newProductCode.trim().toUpperCase() : null,
                name: newName.trim(),
                unit: newUnit,
                warehouse_id: resolvedWarehouseId,
                station_id: null,
              });
            }}
          >
            {t("items.add_one_button")}
          </Button>
        </div>
        {createError ? (
          <p className="mt-2 text-sm font-medium text-destructive">{createError.message}</p>
        ) : null}
      </div>

      <div className="hidden rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm md:block">
        <h2 className="text-base font-semibold tracking-tight">{t("items.bulk_title")}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("items.bulk_instruction")}</p>

        <div className="mt-3 space-y-1 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <p>{t("items.bulk_format_label")}<span className="font-medium text-foreground/70">{t("items.bulk_format_pattern")}</span> &middot; {t("items.bulk_format_note")}</p>
          <div className="font-mono text-[11px] leading-relaxed text-foreground/50">
            <p>{t("items.bulk_format_example1")}</p>
            <p>{t("items.bulk_format_example2")}</p>
          </div>
          <p>{t("items.bulk_units_hint")}</p>
        </div>

        <div className="mt-3 flex overflow-hidden rounded-xl border border-border/70 bg-background/85 text-sm shadow-sm">
          <div
            className="w-14 select-none border-r border-border/70 bg-muted/30 px-2 py-2 font-mono text-xs text-muted-foreground"
            style={{ height: bulkEditorHeight }}
          >
            {uploadLineNumbers.map((lineNumber) => (
              <div key={lineNumber} className="h-5 text-right leading-5">
                {lineNumber}
              </div>
            ))}
          </div>
          <textarea
            ref={bulkTextareaRef}
            className="w-full resize-none overflow-hidden bg-transparent px-3 py-2 font-mono text-xs leading-5 outline-none"
            style={{ height: bulkEditorHeight }}
            wrap="off"
            placeholder={t("items.bulk_placeholder")}
            value={bulkText}
            onChange={(event) => setBulkText(normalizeBulkText(event.target.value))}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData.getData("text");
              setBulkText(normalizeBulkText(pasted));
            }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("items.bulk_total_lines")}: {parsedBulk.totalLines}</span>
          <span className="text-muted-foreground">{t("items.bulk_valid_lines")}: {parsedBulk.rows.length}</span>
          {parsedBulk.errors.length > 0 ? (
            <span className="text-destructive">{t("items.bulk_format_errors")}: {parsedBulk.errors.length}</span>
          ) : null}
        </div>
        {parsedBulk.errors.slice(0, 8).map((error) => (
          <p
            key={`${error.lineNumber}-${error.lineText}`}
            className="mt-1 text-sm text-destructive"
          >
            {t("items.bulk_line_error")} {error.lineNumber}: «{error.lineText}» — {error.reason}
          </p>
        ))}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!isCatalogManager || parsedBulk.rows.length === 0 || bulkMutation.isPending}
            onClick={() => {
              setBulkResult(null);
              bulkMutation.mutate({
                rows: parsedBulk.rows,
                dry_run: true,
                default_warehouse_id: resolvedWarehouseId ?? undefined,
              });
            }}
          >
            {t("items.bulk_check_button")}
          </Button>
          <Button
            type="button"
            disabled={
              !isCatalogManager ||
              !resolvedWarehouseId ||
              parsedBulk.rows.length === 0 ||
              parsedBulk.errors.length > 0 ||
              bulkMutation.isPending
            }
            onClick={() => {
              setBulkResult(null);
              bulkMutation.mutate({
                rows: parsedBulk.rows,
                dry_run: false,
                default_warehouse_id: resolvedWarehouseId ?? undefined,
              });
            }}
          >
            {t("items.bulk_upload_button")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("items.bulk_check_hint")}
        </p>
        {showWarehouseWarning ? (
          <p className="mt-2 text-xs text-amber-700">
            {t("items.bulk_no_warehouse")}
          </p>
        ) : null}

        {bulkResult ? (
          <div className="mt-3 rounded-xl border border-border/70 bg-muted/40 p-3 text-sm shadow-sm">
            <p>
              {bulkResult.dry_run ? t("items.bulk_result_check") : t("items.bulk_result_upload")}: {t("items.bulk_total_lines")}={parsedBulk.totalLines},
              {t("items.bulk_valid_lines")}={parsedBulk.rows.length}, {t("items.bulk_result_new")}={bulkResult.created}, {t("items.bulk_result_existing")}=
              {bulkResult.skipped_existing}, {t("items.bulk_format_errors")}={parsedBulk.errors.length}, {t("items.bulk_result_api_errors")}=
              {bulkResult.errors.length}
            </p>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/95 p-5 shadow-sm">
        <h2 className="text-base font-semibold tracking-tight">{t("items.catalog_title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("items.catalog_total")}:{" "}
          <span className="font-semibold text-foreground">{itemsQuery.data?.length ?? 0}</span>
        </p>
        {inlineMessage ? (
          <p className="mt-2 text-sm text-muted-foreground">{inlineMessage}</p>
        ) : null}
        {itemsQuery.isFetching ? (
          <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">{t("items.catalog_refreshing")}</p>
        ) : (
          <p className="mt-2 text-xs text-transparent select-none" aria-hidden="true">&nbsp;</p>
        )}
        {itemsQuery.isError ? (
          <p className="mt-2 text-sm text-destructive">
            {t("items.catalog_error")}
          </p>
        ) : null}

        {catalogIssues.length > 0 ? (
          <div className="mt-3 space-y-1.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("items.issues_heading")} ({catalogIssues.length})
            </h3>
            {catalogIssues.map((issue) => {
              const isNavigable = issue.itemId !== null && rowRefsMap.current.has(issue.itemId);
              return (
                <div
                  key={issue.id}
                  className={cn(
                    "flex flex-wrap items-baseline gap-x-2 rounded-lg px-2.5 py-1.5 text-sm",
                    isNavigable
                      ? "cursor-pointer bg-background/60 hover:bg-background transition-colors"
                      : "bg-background/40 opacity-75",
                  )}
                  role={isNavigable ? "button" : undefined}
                  tabIndex={isNavigable ? 0 : undefined}
                  onClick={() => {
                    if (isNavigable && issue.itemId !== null) {
                      scrollToItem(issue.itemId, issue.field);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (isNavigable && issue.itemId !== null && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      scrollToItem(issue.itemId, issue.field);
                    }
                  }}
                >
                  <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive/80">
                    {issue.source === "save" ? t("items.issues_source_save") : t("items.issues_source_bulk")}
                  </span>
                  <span className="font-medium text-foreground/90">{issue.itemLabel}</span>
                  <span className="text-muted-foreground">{issue.message}</span>
                  {isNavigable ? (
                    <span className="ml-auto shrink-0 text-[11px] text-primary underline underline-offset-2">
                      {t("items.issues_go_to_row")}
                    </span>
                  ) : issue.itemId === null ? (
                    <span className="ml-auto shrink-0 text-[11px] italic text-muted-foreground">
                      {t("items.issues_row_not_found")}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="mt-3 overflow-auto md:max-h-[50vh]">
          {/* ── Desktop table (md+) ── */}
          <table className="hidden min-w-full text-sm md:table">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-border/70 bg-muted text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <th className="px-2 py-2">{t("items.col_num")}</th>
                <th className="px-2 py-2">{t("items.col_code")}</th>
                <th className="px-2 py-2">{t("items.col_name")}</th>
                <th className="px-2 py-2">{t("items.col_unit")}</th>
                <th className="px-2 py-2">{t("items.col_active")}</th>
                <th className="px-2 py-2">{t("items.col_status")}</th>
                <th className="px-2 py-2">{t("items.col_delete")}</th>
              </tr>
            </thead>
            <tbody>
              {(itemsQuery.data ?? []).map((item, index) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={index}
                  isHighlighted={highlightedItemId === item.id}
                  isCatalogManager={isCatalogManager}
                  unitOptions={unitOptions}
                  status={rowStatus[item.id]}
                  isDeletePending={deleteMutation.isPending}
                  onSave={handleItemSave}
                  onDelete={handleItemDelete}
                  rowRefsMap={rowRefsMap}
                  t={t}
                />
              ))}
            </tbody>
          </table>

          {/* ── Mobile card list (<md) ── */}
          <div className="space-y-2 md:hidden">
            {(itemsQuery.data ?? []).map((item, index) => {
              const st = rowStatus[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  data-item-id={item.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-4 py-4 text-left transition-colors active:bg-muted/40",
                    highlightedItemId === item.id && "ring-2 ring-primary/40",
                    !item.is_active && "opacity-60",
                  )}
                  onClick={() => openEditSheet(item)}
                >
                  <span className="min-w-[2rem] text-sm text-muted-foreground">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium leading-snug">{item.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{item.product_code?.trim() || "—"}</span>
                      <span>·</span>
                      <span>{units.find((u) => u.code === item.unit)?.label ?? item.unit}</span>
                      {!item.is_active && (
                        <>
                          <span>·</span>
                          <span className="text-destructive">{t("items.active_no")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {st ? (
                    <span className={cn(
                      "shrink-0 text-xs font-medium",
                      st === "saving" && "text-muted-foreground",
                      st === "saved" && "text-emerald-600",
                      st === "error" && "text-destructive",
                    )}>
                      {st === "saving" ? t("items.status_saving") : null}
                      {st === "saved" ? t("items.status_saved") : null}
                      {st === "error" ? t("items.status_error") : null}
                    </span>
                  ) : null}
                  <Pencil className="h-5 w-5 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>

          {!itemsQuery.isError && itemsQuery.isLoading ? (
            <p className="py-4 text-sm text-muted-foreground">{t("items.catalog_loading")}</p>
          ) : null}
          {itemsQuery.data && itemsQuery.data.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">{t("items.catalog_empty")}</p>
          ) : null}
        </div>

        {/* ── Mobile edit sheet ── */}
        <Sheet open={editingItem !== null} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-8">
            <SheetHeader className="text-left">
              <SheetTitle>{t("items.edit_title")}</SheetTitle>
              <SheetDescription>{editingItem?.name ?? ""}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("items.col_code")}
                </label>
                <Input
                  value={sheetCode}
                  onChange={(e) => setSheetCode(e.target.value.toUpperCase())}
                  disabled={!isCatalogManager}
                  className="h-12 text-base"
                  placeholder={t("items.add_one_code_placeholder")}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("items.col_name")}
                </label>
                <Input
                  value={sheetName}
                  onChange={(e) => setSheetName(e.target.value)}
                  disabled={!isCatalogManager}
                  className="h-12 text-base"
                  placeholder={t("items.add_one_name_placeholder")}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("items.col_unit")}
                </label>
                <MenuSelect
                  value={sheetUnit}
                  onChange={setSheetUnit}
                  options={unitOptions}
                  placeholder={t("items.unit_placeholder")}
                  disabled={!isCatalogManager}
                  className="h-12 text-base"
                />
              </div>
              <label className="flex h-12 items-center gap-3 rounded-xl border border-border/60 px-4">
                <input
                  type="checkbox"
                  checked={sheetActive}
                  onChange={(e) => setSheetActive(e.target.checked)}
                  disabled={!isCatalogManager}
                  className="h-5 w-5"
                />
                <span className="text-sm">{t("items.col_active")}: {sheetActive ? t("items.active_yes") : t("items.active_no")}</span>
              </label>
              <div className="flex gap-3 pt-2">
                <Button
                  className="h-12 flex-1 text-base"
                  disabled={!isCatalogManager || !sheetName.trim()}
                  onClick={saveAndCloseSheet}
                >
                  {t("items.save_button")}
                </Button>
                {editingItem && isCatalogManager ? (
                  <Button
                    variant="outline"
                    className="h-12 text-base text-destructive"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      handleItemDelete(editingItem.id);
                      setEditingItem(null);
                    }}
                  >
                    {t("items.delete_button")}
                  </Button>
                ) : null}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </section>
  );
}
