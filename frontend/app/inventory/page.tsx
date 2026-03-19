"use client";

import { AuditLogTab } from "@/components/inventory/audit-log-tab";
import { FastEntryContainer } from "@/components/inventory/fast-entry-container";
import { SyncStatusIndicator } from "@/components/inventory/sync-status-indicator";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/lib/i18n/language-provider";
import { canManageRevision as checkCanManageRevision, canExport, canAccessAllWarehouses, canViewAudit as checkCanViewAudit } from "@/lib/permissions";
import { mapApiError } from "@/lib/api/error-mapper";
import {
  ApiRequestError,
  closeInventorySession,
  createInventorySession,
  deleteInventoryEntry,
  deleteInventorySession,
  reopenInventorySession,
  exportInventorySessionXlsx,
  getOrCreateActiveSession,
  getSessionAuditLog,
  getSessionInventoryAudit,
  getSessionInventoryEntries,
  getSessionItemContributors,
  getSessionParticipants,
  getWarehouses,
  listInventorySessions,
  patchInventoryEntry,
  type InventoryEntry,
  type InventoryEntryEvent,
  type InventoryItemContributors,
  type InventoryParticipantsSummary,
  type InventorySession,
  type InventorySessionListItem,
} from "@/lib/api/http";
import { formatQuantity, formatQuantityWithUnit, formatUnit } from "@/lib/format-quantity";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReportItemsDesktopTable, ReportItemsMobileList } from "@/components/inventory/report-items-table";
import { AlertTriangle, Check, Download, Loader2, MoreHorizontal, Search, Trash2 } from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { useFastEntry } from "@/lib/hooks/use-fast-entry";

// ─── Types (page-level only) ────────────────────────────────────────

type EditEntryState = {
  itemId: number;
  itemName: string;
  unit: string;
  quantity: number;
  version: number;
  isClosedSession: boolean;
};

// ─── Warehouse mapping ──────────────────────────────────────────────

function parseWarehouseIdEnv(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

const DEPARTMENT_WAREHOUSE_MAP: Record<"kitchen" | "bar", number | null> = {
  kitchen: parseWarehouseIdEnv(process.env.NEXT_PUBLIC_KITCHEN_WAREHOUSE_ID),
  bar: parseWarehouseIdEnv(process.env.NEXT_PUBLIC_BAR_WAREHOUSE_ID),
};

const MENU_TAP_DRAG_THRESHOLD_PX = 10;

type IntentionalMenuTriggerProps = {
  ariaLabel: string;
  isOpen: boolean;
  onToggle: () => void;
};

function IntentionalMenuTrigger({ ariaLabel, isOpen, onToggle }: IntentionalMenuTriggerProps) {
  const pointerStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pointerMovedRef = useRef(false);

  const resetGesture = useCallback(() => {
    pointerStartRef.current = null;
    pointerMovedRef.current = false;
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      resetGesture();
      return;
    }

    event.preventDefault();

    pointerStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    pointerMovedRef.current = false;
  }, [resetGesture]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current;

    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);

    if (deltaX > MENU_TAP_DRAG_THRESHOLD_PX || deltaY > MENU_TAP_DRAG_THRESHOLD_PX) {
      pointerMovedRef.current = true;
    }
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current;

    if (!start || start.pointerId !== event.pointerId) {
      resetGesture();
      return;
    }

    const deltaX = Math.abs(event.clientX - start.x);
    const deltaY = Math.abs(event.clientY - start.y);
    const shouldTreatAsTap = !pointerMovedRef.current
      && deltaX <= MENU_TAP_DRAG_THRESHOLD_PX
      && deltaY <= MENU_TAP_DRAG_THRESHOLD_PX;

    resetGesture();

    if (shouldTreatAsTap) {
      onToggle();
    }
  }, [onToggle, resetGesture]);

  const handlePointerCancel = useCallback(() => {
    resetGesture();
  }, [resetGesture]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggle();
    }
  }, [onToggle]);

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-11 w-full rounded-xl border border-border/60 bg-background/90 px-0 text-foreground shadow-sm touch-manipulation hover:bg-transparent hover:text-current active:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring sm:h-9 sm:w-9 sm:rounded-lg sm:border-transparent sm:bg-transparent sm:shadow-none sm:hover:bg-accent sm:hover:text-accent-foreground"
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={isOpen}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <MoreHorizontal className="h-5 w-5 sm:h-4 sm:w-4" />
    </Button>
  );
}

// ─── Page component ─────────────────────────────────────────────────

export default function InventoryPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  // ── Core page state ────────────────────────────────────────────────
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | null>(null);
  const advancedMode = false;
  const [session, setSession] = useState<InventorySession | null>(null);
  const [inventoryView, setInventoryView] = useState<"revision" | "management" | "reports">("revision");
  const warehouseOverrideRef = useRef(false);

  // Touch-scroll guard
  const tabTouchMovedRef = useRef(false);
  const tabTouchStartYRef = useRef(0);
  const handleTabTouchStart = useCallback((e: React.TouchEvent) => {
    tabTouchMovedRef.current = false;
    tabTouchStartYRef.current = e.touches[0].clientY;
  }, []);
  const handleTabTouchMove = useCallback((e: React.TouchEvent) => {
    const dy = Math.abs(e.touches[0].clientY - tabTouchStartYRef.current);
    if (dy > 8) tabTouchMovedRef.current = true;
  }, []);
  const switchTab = useCallback((view: "revision" | "management" | "reports") => {
    if (tabTouchMovedRef.current) return;
    setInventoryView(view);
  }, []);

  // Dynamic page title
  useEffect(() => {
    const titles: Record<typeof inventoryView, string> = {
      revision: "RESINT \u2014 \u0420\u0435\u0432\u0438\u0437\u0438\u044f",
      management: "RESINT \u2014 \u0423\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u0440\u0435\u0432\u0438\u0437\u0438\u0435\u0439",
      reports: "RESINT \u2014 \u041e\u0442\u0447\u0451\u0442\u044b",
    };
    document.title = titles[inventoryView];
  }, [inventoryView]);

  // ── UI state (shared across views) ─────────────────────────────────
  const [editEntryState, setEditEntryState] = useState<EditEntryState | null>(null);
  const [editQty, setEditQty] = useState("");
  const [, setEditReason] = useState("");
  const [selectedReportSessionId, setSelectedReportSessionId] = useState<number | null>(null);
  const [selectedReportItemId, setSelectedReportItemId] = useState<number | null>(null);
  const [reportsPanelTab, setReportsPanelTab] = useState<"items" | "people" | "history" | "audit">("items");
  const [reportSearchTerm, setReportSearchTerm] = useState("");
  const [deleteConfirmSessionId, setDeleteConfirmSessionId] = useState<number | null>(null);
  const [reportActionsMenuOpen, setReportActionsMenuOpen] = useState(false);
  const [itemHistoryOpen, setItemHistoryOpen] = useState(false);
  const [inlineErrorMessage, setInlineErrorMessage] = useState<string | null>(null);
  const [inlineErrorDebug, setInlineErrorDebug] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ── User / permissions ─────────────────────────────────────────────
  const { user: currentUser, isLoading: userIsLoading } = useCurrentUser();
  const isPrivilegedUser = currentUser ? canAccessAllWarehouses(currentUser.role) : false;
  const canManageRevision = currentUser ? checkCanManageRevision(currentUser.role) : false;
  const normalizedDepartment = currentUser?.department ?? null;

  // ── Warehouse resolution ───────────────────────────────────────────
  const managerWarehousesQuery = useQuery({
    queryKey: ["warehouses-manager-fallback"],
    queryFn: () => getWarehouses(),
    enabled: canManageRevision && !advancedMode,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (warehouseOverrideRef.current) return;
    if (isPrivilegedUser && advancedMode) return;
    const departmentWarehouse = normalizedDepartment ? DEPARTMENT_WAREHOUSE_MAP[normalizedDepartment] : null;
    const managerFallbackWarehouseId = managerWarehousesQuery.data?.[0]?.id ?? null;
    const fallbackWarehouseId =
      currentUser?.warehouse_id ??
      currentUser?.default_warehouse_id ??
      departmentWarehouse ??
      (canManageRevision ? managerFallbackWarehouseId : null);
    setSelectedWarehouseId(fallbackWarehouseId);
  }, [advancedMode, canManageRevision, currentUser?.warehouse_id, currentUser?.default_warehouse_id, isPrivilegedUser, managerWarehousesQuery.data, normalizedDepartment]);

  useEffect(() => {
    if (selectedWarehouseId === null) {
      setSession(null);
    }
  }, [selectedWarehouseId]);

  // ── Active session query ───────────────────────────────────────────
  const activeSessionQueryKey = useMemo(
    () => ["active-session", selectedWarehouseId] as const,
    [selectedWarehouseId],
  );

  const activeSessionQuery = useQuery({
    queryKey: activeSessionQueryKey,
    queryFn: async () => {
      try {
        return await getOrCreateActiveSession(selectedWarehouseId as number, false);
      } catch (err) {
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 403)) {
          return null;
        }
        throw err;
      }
    },
    enabled: selectedWarehouseId !== null,
    refetchInterval: 5_000,
    staleTime: 4_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  useEffect(() => {
    const data = activeSessionQuery.data;
    if (data === undefined) return;
    setSession((prev) => {
      if (data === null && prev === null) return prev;
      if (data !== null && prev !== null && data.id === prev.id && data.status === prev.status) return prev;
      if (data === null && prev !== null && prev.status === "draft") return prev;
      return data;
    });
  }, [activeSessionQuery.data]);

  const isClosed = Boolean(session && (session.is_closed || session.status.toLowerCase() === "closed"));

  // ── Derived flags ──────────────────────────────────────────────────
  const userCanExport = Boolean(currentUser && canExport(currentUser.role));
  const userCanViewAudit = Boolean(currentUser && checkCanViewAudit(currentUser.role));
  const canExportClosedSession = Boolean(session && isClosed && userCanExport);
  const canSearch = Boolean(session) && (!isClosed || canManageRevision);
  const showManagementView = canManageRevision && inventoryView === "management";
  const showReportsView = inventoryView === "reports";

  const departmentMappedWarehouseId = normalizedDepartment ? DEPARTMENT_WAREHOUSE_MAP[normalizedDepartment] : null;
  const managerFallbackWarehouseId = managerWarehousesQuery.data?.[0]?.id ?? null;
  const autoResolvedWarehouseId =
    currentUser?.warehouse_id ??
    currentUser?.default_warehouse_id ??
    departmentMappedWarehouseId ??
    (canManageRevision ? managerFallbackWarehouseId : null);
  const warehouseResolutionMessage =
    currentUser !== null &&
    !(isPrivilegedUser && advancedMode) &&
    autoResolvedWarehouseId === null &&
    !canManageRevision
      ? t("error.warehouse_not_found")
      : null;

  // ── Fast entry hook (delegates sync/offline/draft/save/search to a separate module) ──
  const fe = useFastEntry({
    session,
    isClosed,
    selectedWarehouseId,
    currentUser,
    canSearch,
    canManageRevision,
    activeSessionQueryKey,
    inventoryView,
    setToastMessage,
    setInlineErrorMessage,
    setInlineErrorDebug,
  });

  // ── Session management mutations ───────────────────────────────────

  const createSessionMutation = useMutation({
    mutationFn: createInventorySession,
    onSuccess: (nextSession) => {
      setSession(nextSession);
      void queryClient.cancelQueries({ queryKey: activeSessionQueryKey });
      queryClient.setQueryData(activeSessionQueryKey, nextSession);
      void queryClient.invalidateQueries({ queryKey: ["inventory-sessions-history"] });
      void queryClient.invalidateQueries({ queryKey: ["session-audit-log"] });
      setToastMessage(t("toast.revision_started"));
    },
    onError: (error) => {
      const mapped = mapApiError(error, { defaultMessage: t("error.start_failed") });
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
      setToastMessage(mapped.message);
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: closeInventorySession,
    onSuccess: (nextSession) => {
      setSession(nextSession);
      void queryClient.cancelQueries({ queryKey: activeSessionQueryKey });
      queryClient.setQueryData(activeSessionQueryKey, null);
      void queryClient.invalidateQueries({ queryKey: ["inventory-sessions-history"] });
      void queryClient.invalidateQueries({ queryKey: ["session-audit-log"] });
      setToastMessage(t("toast.revision_closed"));
    },
    onError: (error) => {
      const mapped = mapApiError(error, { defaultMessage: t("error.close_failed") });
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
      setToastMessage(mapped.message);
    },
  });

  const reopenSessionMutation = useMutation({
    mutationFn: (sessionId: number) => reopenInventorySession(sessionId),
    onSuccess: async (reopenedSession) => {
      setSession(reopenedSession);
      void queryClient.cancelQueries({ queryKey: activeSessionQueryKey });
      if (reopenedSession.warehouse_id !== selectedWarehouseId) {
        warehouseOverrideRef.current = true;
        setSelectedWarehouseId(reopenedSession.warehouse_id);
        queryClient.setQueryData(["active-session", reopenedSession.warehouse_id], reopenedSession);
      } else {
        queryClient.setQueryData(activeSessionQueryKey, reopenedSession);
      }
      setToastMessage(t("toast.revision_reopened"));
      setInventoryView("revision");
      await queryClient.invalidateQueries({ queryKey: ["inventory-sessions-history"] });
      void queryClient.invalidateQueries({ queryKey: ["session-audit-log"] });
      warehouseOverrideRef.current = false;
    },
    onError: (error) => {
      const mapped = mapApiError(error, { defaultMessage: "Не удалось возобновить ревизию" });
      setToastMessage(mapped.message);
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
    },
  });

  const exportMutation = useMutation({
    mutationFn: exportInventorySessionXlsx,
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setToastMessage(t("toast.export_ready"));
    },
    onError: () => {
      setToastMessage(t("toast.export_error"));
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: ({ sessionId }: { sessionId: number }) => deleteInventorySession(sessionId),
    onSuccess: async (_, variables) => {
      setToastMessage(t("toast.revision_deleted"));
      await queryClient.invalidateQueries({ queryKey: ["inventory-sessions-history"] });
      void queryClient.invalidateQueries({ queryKey: ["session-audit-log"] });
      if (selectedReportSessionId === variables.sessionId) {
        setSelectedReportSessionId(null);
      }
    },
    onError: (error) => {
      const mapped = mapApiError(error, { defaultMessage: t("error.delete_failed") });
      setToastMessage(mapped.message);
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
    },
  });

  const editEntryMutation = useMutation({
    mutationFn: patchInventoryEntry,
    onSuccess: async (_, variables) => {
      setInlineErrorMessage(null);
      setInlineErrorDebug(null);
      setToastMessage(t("toast.edit_saved"));
      setEditEntryState(null);
      setEditQty("");
      setEditReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recent-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["recent-events", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit-report", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit-log", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-progress", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-participants", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-item-contributors", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["items-frequent"] }),
        queryClient.invalidateQueries({ queryKey: ["items-recent"] }),
      ]);
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.body.includes("SESSION_CLOSED")) {
        queryClient.setQueryData(activeSessionQueryKey, null);
        void queryClient.invalidateQueries({ queryKey: activeSessionQueryKey });
      }
      const mapped = mapApiError(error, { defaultMessage: t("error.edit_failed") });
      setToastMessage(mapped.message);
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
    },
  });

  const deleteEntryMutation = useMutation({
    mutationFn: deleteInventoryEntry,
    onSuccess: async (_, variables) => {
      setInlineErrorMessage(null);
      setInlineErrorDebug(null);
      setToastMessage(t("toast.entry_deleted"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recent-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["recent-events", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-entries", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit-report", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-audit-log", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-progress", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-participants", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["session-item-contributors", variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ["items-frequent"] }),
        queryClient.invalidateQueries({ queryKey: ["items-recent"] }),
      ]);
    },
    onError: (error) => {
      const mapped = mapApiError(error, { defaultMessage: t("error.delete_entry_failed") });
      setToastMessage(mapped.message);
      setInlineErrorMessage(mapped.inlineMessage);
      setInlineErrorDebug(mapped.debug ?? null);
    },
  });

  const createSession = createSessionMutation.mutate;
  const closeSession = closeSessionMutation.mutate;

  // ── Report queries ─────────────────────────────────────────────────

  const sessionsHistoryQuery = useQuery({
    queryKey: ["inventory-sessions-history", selectedWarehouseId],
    queryFn: () => listInventorySessions({ limit: 120 }),
    enabled: Boolean(selectedWarehouseId) && (inventoryView === "reports" || inventoryView === "management"),
    staleTime: 10_000,
    refetchInterval: inventoryView === "management" || inventoryView === "reports" ? 10_000 : false,
    refetchOnWindowFocus: false,
  });

  const reportSessionId = selectedReportSessionId ?? session?.id ?? null;

  const reportEntriesQuery = useQuery({
    queryKey: ["session-entries", reportSessionId],
    queryFn: () => getSessionInventoryEntries(reportSessionId as number),
    enabled: Boolean(reportSessionId) && inventoryView === "reports",
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const reportAuditQuery = useQuery({
    queryKey: ["session-audit-report", reportSessionId],
    queryFn: () => getSessionInventoryAudit(reportSessionId as number, 120),
    enabled: Boolean(reportSessionId) && inventoryView === "reports" && userCanViewAudit,
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const reportItemContributorsQuery = useQuery({
    queryKey: ["session-item-contributors", reportSessionId, selectedReportItemId],
    queryFn: () => getSessionItemContributors(reportSessionId as number, selectedReportItemId as number),
    enabled: Boolean(reportSessionId) && Boolean(selectedReportItemId) && inventoryView === "reports",
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const participantsQuery = useQuery({
    queryKey: ["session-participants", reportSessionId],
    queryFn: () => getSessionParticipants(reportSessionId as number),
    enabled: Boolean(reportSessionId) && inventoryView === "reports",
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const auditLogQuery = useQuery({
    queryKey: ["session-audit-log", reportSessionId],
    queryFn: () => getSessionAuditLog(reportSessionId as number, 100),
    enabled: Boolean(reportSessionId) && inventoryView === "reports" && reportsPanelTab === "audit",
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // ── Reports derived state ──────────────────────────────────────────

  useEffect(() => {
    if (!canManageRevision && inventoryView === "management") {
      setInventoryView("revision");
    }
  }, [canManageRevision, inventoryView]);

  useEffect(() => {
    if (inventoryView !== "reports") return;
    const history = sessionsHistoryQuery.data ?? [];
    if (history.length === 0) { setSelectedReportSessionId(null); return; }
    const hasSelected = selectedReportSessionId !== null && history.some((row) => row.id === selectedReportSessionId);
    if (hasSelected) return;
    if (session?.id && history.some((row) => row.id === session.id)) { setSelectedReportSessionId(session.id); return; }
    setSelectedReportSessionId(history[0].id);
  }, [inventoryView, selectedReportSessionId, session?.id, sessionsHistoryQuery.data]);

  const revisionHistory = useMemo(() => sessionsHistoryQuery.data ?? [], [sessionsHistoryQuery.data]);

  const selectedReportSession: InventorySessionListItem | null = useMemo(
    () => revisionHistory.find((row) => row.id === reportSessionId) ?? null,
    [reportSessionId, revisionHistory],
  );

  const deleteConfirmSession: InventorySessionListItem | null = useMemo(
    () => revisionHistory.find((row) => row.id === deleteConfirmSessionId) ?? null,
    [deleteConfirmSessionId, revisionHistory],
  );

  useEffect(() => {
    if (!selectedReportSession) {
      setReportActionsMenuOpen(false);
    }
  }, [selectedReportSession]);

  const canEditClosedRevision = Boolean(currentUser && checkCanManageRevision(currentUser.role));
  const canDeleteRevision = Boolean(currentUser && checkCanManageRevision(currentUser.role));
  const canCloseSelectedReportDraft = Boolean(
    selectedReportSession && !selectedReportSession.is_closed && canEditClosedRevision,
  );

  const resolveWarehouseName = useCallback(
    (warehouseId: number | null | undefined): string | null => {
      if (!warehouseId) return null;
      const knownWarehouse = managerWarehousesQuery.data?.find((w) => w.id === warehouseId)?.name;
      const humanById: Record<number, string> = {};
      if (DEPARTMENT_WAREHOUSE_MAP.kitchen) humanById[DEPARTMENT_WAREHOUSE_MAP.kitchen] = "Кухня";
      if (DEPARTMENT_WAREHOUSE_MAP.bar) humanById[DEPARTMENT_WAREHOUSE_MAP.bar] = "Бар";
      humanById[1] = humanById[1] ?? "Кухня";
      humanById[2] = humanById[2] ?? "Бар";
      if (humanById[warehouseId]) return humanById[warehouseId];
      if (knownWarehouse) {
        const normalized = knownWarehouse.toLowerCase();
        if (normalized.includes("main warehouse") || normalized.includes("main")) return "Кухня";
        if (normalized.includes("bar warehouse")) return "Бар";
        if (normalized.includes("kitchen")) return "Кухня";
        if (normalized.includes("bar")) return "Бар";
        return knownWarehouse;
      }
      return `Склад #${warehouseId}`;
    },
    [managerWarehousesQuery.data],
  );

  const reportWarehouseName = resolveWarehouseName(selectedReportSession?.warehouse_id);

  const reportRows = useMemo(() => {
    const entries = reportEntriesQuery.data ?? [];
    const latestByItem = new Map<number, InventoryEntryEvent>();
    for (const event of reportAuditQuery.data ?? []) {
      if (!latestByItem.has(event.item_id)) latestByItem.set(event.item_id, event);
    }
    return entries.map((entry) => {
      const event = latestByItem.get(entry.item_id);
      const contributorsCountRaw = entry.contributors_count;
      const contributorsCount = typeof contributorsCountRaw === "number" && contributorsCountRaw > 0 ? contributorsCountRaw : 0;
      const contributorsPreview = Array.isArray(entry.contributors_preview)
        ? entry.contributors_preview.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const fallbackActor = event?.actor_display_name ?? event?.actor_username ?? null;

      let actorDisplayName: string | null = null;
      if (contributorsCount <= 1) {
        actorDisplayName = contributorsPreview[0] ?? fallbackActor;
      } else if (contributorsCount === 2 && contributorsPreview.length >= 2) {
        actorDisplayName = `${contributorsPreview[0]}, ${contributorsPreview[1]}`;
      } else {
        const leadName = contributorsPreview[0] ?? fallbackActor;
        actorDisplayName = leadName ? `${leadName} +${contributorsCount - 1}` : `+${contributorsCount}`;
      }

      return { entry, actorDisplayName, contributorsCount, contributorsPreview, lastActionAt: event?.created_at ?? entry.updated_at };
    });
  }, [reportAuditQuery.data, reportEntriesQuery.data]);

  const filteredReportRows = useMemo(() => {
    if (!reportSearchTerm.trim()) return reportRows;
    const needle = reportSearchTerm.trim().toLowerCase();
    return reportRows.filter((row) => row.entry.item_name.toLowerCase().includes(needle));
  }, [reportRows, reportSearchTerm]);

  useEffect(() => {
    if (inventoryView !== "reports") return;
    if (reportRows.length === 0) { setSelectedReportItemId(null); return; }
    if (selectedReportItemId !== null && reportRows.some((row) => row.entry.item_id === selectedReportItemId)) return;
    setSelectedReportItemId(reportRows[0].entry.item_id);
  }, [inventoryView, reportRows, selectedReportItemId]);

  useEffect(() => {
    setItemHistoryOpen(false);
  }, [reportsPanelTab, reportSessionId, selectedReportItemId]);

  const participantsSummary: InventoryParticipantsSummary | null = participantsQuery.data ?? null;
  const itemContributors: InventoryItemContributors | null = reportItemContributorsQuery.data ?? null;
  const itemHistoryEvents = useMemo(() => {
    if (!selectedReportItemId) return [] as InventoryEntryEvent[];
    return (reportAuditQuery.data ?? []).filter((event) => event.item_id === selectedReportItemId);
  }, [reportAuditQuery.data, selectedReportItemId]);

  const formatReportHistoryAction = useCallback((event: InventoryEntryEvent) => {
    const beforeQuantity = event.before_quantity ?? 0;
    const delta = event.after_quantity - beforeQuantity;
    if (event.action === "add") return `добавил ${delta > 0 ? "+" : ""}${formatQuantity(delta)}`;
    return `установил ${formatQuantity(event.after_quantity)}`;
  }, []);

  // ── Shared helpers ─────────────────────────────────────────────────

  const formatDateTime = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Almaty",
    }).format(date);
  }, []);

  const openEditEntryModal = useCallback((entry: InventoryEntry, closedSession?: boolean) => {
    setEditEntryState({
      itemId: entry.item_id,
      itemName: entry.item_name,
      unit: entry.unit,
      quantity: entry.quantity,
      version: entry.version,
      isClosedSession: Boolean(closedSession),
    });
    setEditQty(String(entry.quantity));
    setEditReason("");
  }, []);

  const submitEditEntry = useCallback(async () => {
    const targetSessionId = inventoryView === "reports" ? reportSessionId : session?.id;
    if (!targetSessionId || !editEntryState || editEntryMutation.isPending) return;
    const parsedQty = Number.parseFloat(editQty.replace(",", "."));
    if (!Number.isFinite(parsedQty)) { setToastMessage(t("inventory.qty.error_not_number")); return; }
    if (parsedQty < 0) { setToastMessage(t("inventory.qty.error_negative")); return; }
    if (parsedQty <= 0) { setToastMessage(t("inventory.qty.error_positive")); return; }
    const editIsPcs = editEntryState.unit === "pcs" || editEntryState.unit === "шт";
    if (editIsPcs && !Number.isInteger(parsedQty)) { setToastMessage(t("inventory.qty.error_integer_pcs")); return; }
    const editHardMax = editIsPcs ? 99999 : 99999.999;
    if (parsedQty > editHardMax) { setToastMessage(t("inventory.qty.error_too_large")); return; }

    await editEntryMutation.mutateAsync({
      sessionId: targetSessionId,
      itemId: editEntryState.itemId,
      quantity: parsedQty,
      version: editEntryState.version,
      stationId: null,
      countedOutsideZone: false,
      reason: undefined,
    });
  }, [editEntryMutation, editEntryState, editQty, inventoryView, reportSessionId, session?.id, setToastMessage, t]);

  const handleDeleteEntry = useCallback((entry: InventoryEntry) => {
    if (!reportSessionId || deleteEntryMutation.isPending) return;
    if (!window.confirm(`${t("inventory.reports.confirm_delete_entry")} "${entry.item_name}"?`)) return;
    deleteEntryMutation.mutate({ sessionId: reportSessionId, itemId: entry.item_id });
  }, [deleteEntryMutation, reportSessionId, t]);

  // ── Toast auto-dismiss ─────────────────────────────────────────────
  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => setToastMessage(null), 1800);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-3 sm:px-4 lg:px-5 md:flex md:flex-1 md:min-h-0 md:flex-col">
      <section className="min-w-0 w-full space-y-2.5 rounded-2xl border border-border/60 bg-card/60 p-2 pb-[calc(9rem+env(safe-area-inset-bottom))] shadow-sm md:flex md:flex-1 md:min-h-0 md:flex-col md:gap-3 md:space-y-0 md:p-3 md:pb-0">
        {inlineErrorMessage ? (
          <div className="rounded-xl border border-amber-300/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 shadow-sm">
            <p>{inlineErrorMessage}</p>
            {inlineErrorDebug ? (
              <p className="mt-1 text-xs text-amber-700">отладка: {inlineErrorDebug}</p>
            ) : null}
          </div>
        ) : null}

        {warehouseResolutionMessage ? (
          <div className="rounded-xl border border-amber-300/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 shadow-sm">
            {warehouseResolutionMessage}
          </div>
        ) : null}

        {/* ── Tab bar ── */}
        <div className="rounded-xl border border-border/60 bg-muted/40 p-1.5 md:shrink-0">
          <div
            className="grid grid-cols-1 gap-1.5 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-0"
            onTouchStart={handleTabTouchStart}
            onTouchMove={handleTabTouchMove}
          >
            <Button
              type="button"
              variant={inventoryView === "revision" ? "default" : "ghost"}
              className="h-10 w-full whitespace-normal rounded-lg px-3 text-sm font-medium sm:h-9 sm:w-auto"
              onClick={() => switchTab("revision")}
            >
              {t("inventory.tab.revision")}
            </Button>
            {canManageRevision ? (
              <>
                <div className="hidden sm:mx-1 sm:block sm:h-5 sm:w-px sm:bg-border/60" aria-hidden="true" />
                <Button
                  type="button"
                  variant={inventoryView === "management" ? "default" : "ghost"}
                  className="h-10 w-full whitespace-normal rounded-lg px-3 text-sm font-medium sm:h-9 sm:w-auto"
                  onClick={() => switchTab("management")}
                >
                  {t("inventory.tab.management")}
                </Button>
              </>
            ) : null}
            <div className="hidden sm:mx-1 sm:block sm:h-5 sm:w-px sm:bg-border/60" aria-hidden="true" />
            <Button
              type="button"
              variant={inventoryView === "reports" ? "default" : "ghost"}
              className="h-10 w-full whitespace-normal rounded-lg px-3 text-sm font-medium sm:h-9 sm:w-auto"
              onClick={() => switchTab("reports")}
            >
              {t("inventory.tab.reports")}
            </Button>
            <div className="hidden sm:ml-auto sm:block">
              <SyncStatusIndicator
                status={fe.syncStatus}
                queueLength={fe.offlineQueue.length}
                onRetry={fe.handleSyncRetry}
              />
            </div>
          </div>
          <div className="mt-1 flex justify-center sm:hidden">
            <SyncStatusIndicator
              status={fe.syncStatus}
              queueLength={fe.offlineQueue.length}
              onRetry={fe.handleSyncRetry}
            />
          </div>
        </div>

        {/* ── Queue failure banner ── */}
        {fe.offlineQueue.some((i) => i.status === "failed" || i.status === "failed_conflict") && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-300/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-800 shadow-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t("queue.banner")}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs border-amber-400/60 text-amber-800 hover:bg-amber-100"
              onClick={() => fe.setQueueRepairOpen(true)}
            >
              {t("queue.open")}
            </Button>
          </div>
        )}

        {/* ── Main content area ── */}
        {showManagementView ? (
          <div className="grid min-w-0 w-full gap-3 md:flex-1 md:min-h-0 md:overflow-y-auto">
            <div className="h-full min-h-0 flex flex-col gap-4">
              <div className="space-y-4 rounded-2xl border border-border/60 bg-card/95 p-5 shadow-sm md:p-6">
                <div className="space-y-3">
                  <button
                    type="button"
                    className="inline-flex items-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setInventoryView("revision")}
                  >
                    {t("common.back")}
                  </button>
                  <h3 className="text-lg font-semibold leading-tight">{t("inventory.manage.title")}</h3>
                  <div className="rounded-xl border border-dashed border-border/50 bg-muted/30 px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      {session && !isClosed
                        ? `${t("inventory.manage.active")} (#${session.revision_no})`
                        : t("inventory.manage.none")}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2.5 border-t border-border/50 pt-4">
                  <Button
                    type="button"
                    variant={session && !isClosed ? "destructive" : "default"}
                    className="rounded-xl"
                    onClick={() => {
                      if (session && !isClosed) { closeSession(session.id); return; }
                      if (selectedWarehouseId !== null) createSession(selectedWarehouseId);
                    }}
                    disabled={
                      (session && !isClosed ? closeSessionMutation.isPending : createSessionMutation.isPending) ||
                      (!session && selectedWarehouseId === null)
                    }
                  >
                    {session && !isClosed
                      ? closeSessionMutation.isPending ? t("inventory.manage.closing") : t("inventory.manage.close")
                      : createSessionMutation.isPending ? t("inventory.manage.starting") : t("inventory.manage.start")}
                  </Button>
                </div>

                {isClosed ? (
                  <div className="rounded-xl border border-dashed border-border/50 bg-muted/30 px-4 py-3">
                    <p className="text-sm text-muted-foreground">{t("inventory.manage.closed_hint")}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canEditClosedRevision && session ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
                          disabled={reopenSessionMutation.isPending}
                          onClick={() => reopenSessionMutation.mutate(session.id)}
                        >
                          {reopenSessionMutation.isPending ? t("inventory.manage.reopening") : t("inventory.manage.reopen")}
                        </Button>
                      ) : null}
                      {canExportClosedSession && session ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="rounded-xl"
                          disabled={exportMutation.isPending}
                          onClick={() => exportMutation.mutate(session.id)}
                        >
                          {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                          {exportMutation.isPending ? t("common.generating_excel") : t("common.download_excel")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* ── Compact recent revisions ── */}
              <div className="space-y-3 rounded-2xl border border-border/60 bg-card/95 p-4 shadow-sm md:p-5">
                <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t("inventory.manage.history_title")}
                </h3>
                {sessionsHistoryQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("inventory.manage.loading_history")}</p>
                ) : null}
                {!sessionsHistoryQuery.isLoading && revisionHistory.filter((r) => r.is_closed).length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("inventory.manage.no_history")}</p>
                ) : null}
                <div className="divide-y divide-border/50">
                  {revisionHistory
                    .filter((r) => r.is_closed)
                    .slice(0, 5)
                    .map((row) => {
                      const warehouseName = resolveWarehouseName(row.warehouse_id);
                      return (
                        <div key={row.id} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-tight">
                              #{row.revision_no}{warehouseName ? ` · ${warehouseName}` : ""}
                              {" · "}
                              <span className="text-muted-foreground font-normal">{row.items_count} {t("inventory.manage.items_short")}</span>
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{row.updated_at ? formatDateTime(row.updated_at) : "—"}</p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs"
                              onClick={() => { setSelectedReportSessionId(row.id); setInventoryView("reports"); }}>
                              {t("inventory.manage.open_report")}
                            </Button>
                            {canEditClosedRevision && row.is_closed ? (
                              <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs"
                                disabled={reopenSessionMutation.isPending}
                                onClick={() => reopenSessionMutation.mutate(row.id)}>
                                {reopenSessionMutation.isPending ? t("inventory.manage.reopening") : t("inventory.manage.reopen")}
                              </Button>
                            ) : null}
                            {canDeleteRevision ? (
                              <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs text-destructive hover:text-destructive"
                                disabled={deleteSessionMutation.isPending}
                                onClick={() => setDeleteConfirmSessionId(row.id)}>
                                {t("inventory.manage.delete")}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        ) : showReportsView ? (
          <div className="grid min-w-0 w-full gap-3 md:flex-1 md:min-h-0">
            <div className="h-full min-h-0 flex flex-1 flex-col gap-4 overflow-hidden sm:gap-4.5">
              <div className="grid min-w-0 gap-3 sm:gap-3.5 lg:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.6fr)] lg:flex-1 lg:min-h-0">
                <div className="min-w-0 space-y-2 rounded-2xl border border-border/60 bg-card/95 p-3 shadow-sm max-h-[45dvh] overflow-y-auto sm:p-4 lg:max-h-none lg:min-h-0">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {t("inventory.reports.history_title")}
                  </h3>
                  {sessionsHistoryQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("inventory.reports.loading_sessions")}</p> : null}
                  {sessionsHistoryQuery.isError ? <p className="text-sm text-destructive">{t("inventory.reports.error_sessions")}</p> : null}
                  {!sessionsHistoryQuery.isLoading && !sessionsHistoryQuery.isError && revisionHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("inventory.reports.no_sessions")}</p>
                  ) : null}
                  <div className="space-y-1.5">
                    {revisionHistory.map((row) => {
                      const selected = row.id === reportSessionId;
                      const statusLabel = row.is_closed ? t("inventory.session.closed") : t("inventory.session.active");
                      return (
                        <button key={row.id} type="button" onClick={() => setSelectedReportSessionId(row.id)}
                          className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${selected ? "border-primary/60 bg-primary/5 shadow-sm" : "border-border/50 hover:bg-muted/40"}`}>
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold">#{row.revision_no}</p>
                            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${row.is_closed ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}`}>
                              {statusLabel}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.items_count} {t("inventory.manage.items_short")} · {row.updated_at ? formatDateTime(row.updated_at) : "—"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-w-0 space-y-2.5 overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-3 shadow-sm sm:space-y-3 sm:p-4 lg:flex lg:flex-col lg:gap-3 lg:space-y-0 lg:min-h-0">
                  <div className="flex flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-center sm:gap-3 lg:shrink-0">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold tracking-tight sm:text-base">
                        {selectedReportSession
                          ? `${t("inventory.reports.revision_number")} #${selectedReportSession.revision_no}${reportWarehouseName ? ` (${reportWarehouseName})` : ""}`
                          : t("inventory.tab.reports")}
                      </h3>
                      {selectedReportSession ? (
                        <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${selectedReportSession.is_closed ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}`}>
                          {selectedReportSession.is_closed ? t("inventory.session.closed") : t("inventory.session.active")}
                        </span>
                      ) : null}
                    </div>
                    {selectedReportSession ? (
                      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
                        {userCanExport ? (
                          <Button type="button" variant="default" className="h-9 w-full rounded-lg sm:w-auto"
                            disabled={exportMutation.isPending}
                            onClick={() => exportMutation.mutate(selectedReportSession.id)}>
                            {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                            {exportMutation.isPending ? t("common.exporting") : t("common.export")}
                          </Button>
                        ) : null}
                        {canCloseSelectedReportDraft ? (
                          <Button type="button" variant="secondary" className="h-9 w-full rounded-lg sm:w-auto"
                            disabled={closeSessionMutation.isPending}
                            onClick={() => closeSession(selectedReportSession.id)}>
                            {closeSessionMutation.isPending ? t("inventory.reports.closing_revision") : t("inventory.reports.close_revision")}
                          </Button>
                        ) : null}
                        {canDeleteRevision ? (
                          <DropdownMenu
                            open={reportActionsMenuOpen}
                            onOpenChange={(nextOpen) => {
                              setReportActionsMenuOpen(nextOpen);
                            }}
                          >
                            <DropdownMenuTrigger asChild>
                              <IntentionalMenuTrigger
                                ariaLabel="Дополнительные действия"
                                isOpen={reportActionsMenuOpen}
                                onToggle={() => setReportActionsMenuOpen((currentOpen) => !currentOpen)}
                              />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl border border-border/60 bg-popover/95 p-1.5 shadow-lg">
                              <DropdownMenuLabel className="px-2.5 py-2 text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                                Опасное действие
                              </DropdownMenuLabel>
                              <DropdownMenuSeparator className="mx-0 my-1" />
                              <DropdownMenuItem
                                className="min-h-11 rounded-lg px-2.5 text-destructive focus:bg-destructive/10 focus:text-destructive"
                                disabled={!selectedReportSession.is_closed || deleteSessionMutation.isPending}
                                onClick={() => {
                                  if (!selectedReportSession.is_closed) return;
                                  setReportActionsMenuOpen(false);
                                  setDeleteConfirmSessionId(selectedReportSession.id);
                                }}>
                                <Trash2 className="h-4 w-4" />
                                {deleteSessionMutation.isPending ? t("inventory.reports.deleting") : t("inventory.reports.delete_revision")}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {selectedReportSession && selectedReportSession.is_closed && !canEditClosedRevision ? (
                    <p className="text-sm text-muted-foreground">{t("inventory.reports.closed_no_edit")}</p>
                  ) : null}

                  {selectedReportSession ? (
                    <div className="flex w-full flex-wrap gap-0.5 rounded-xl border border-border/60 bg-muted/40 p-0.5 sm:inline-flex sm:flex-nowrap lg:w-auto lg:shrink-0">
                      <Button type="button" variant={reportsPanelTab === "items" ? "default" : "ghost"} className="h-8 flex-1 basis-[calc(50%-0.25rem)] rounded-lg px-2 text-xs font-medium sm:h-9 sm:basis-auto sm:px-3 sm:text-sm lg:flex-none" onClick={() => setReportsPanelTab("items")}>{t("inventory.reports.tab_items")}</Button>
                      <Button type="button" variant={reportsPanelTab === "people" ? "default" : "ghost"} className="h-8 flex-1 basis-[calc(50%-0.25rem)] rounded-lg px-2 text-xs font-medium sm:h-9 sm:basis-auto sm:px-3 sm:text-sm lg:flex-none" onClick={() => setReportsPanelTab("people")}>{t("inventory.reports.tab_people")}</Button>
                      <Button type="button" variant={reportsPanelTab === "history" ? "default" : "ghost"} className="h-8 flex-1 basis-[calc(50%-0.25rem)] rounded-lg px-2 text-xs font-medium sm:h-9 sm:basis-auto sm:px-3 sm:text-sm lg:flex-none" onClick={() => setReportsPanelTab("history")}>{t("inventory.reports.tab_history")}</Button>
                      {userCanViewAudit ? (
                        <Button type="button" variant={reportsPanelTab === "audit" ? "default" : "ghost"} className="h-8 flex-1 basis-[calc(50%-0.25rem)] rounded-lg px-2 text-xs font-medium sm:h-9 sm:basis-auto sm:px-3 sm:text-sm lg:flex-none" onClick={() => setReportsPanelTab("audit")}>Журнал</Button>
                      ) : null}
                    </div>
                  ) : null}

                  {reportsPanelTab === "items" ? (
                    <>
                      {reportEntriesQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("inventory.reports.loading_items")}</p> : null}
                      {reportEntriesQuery.isError ? <p className="text-sm text-destructive">{t("inventory.reports.error_items")}</p> : null}
                      {!reportEntriesQuery.isLoading && !reportEntriesQuery.isError && selectedReportSession && reportRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("inventory.reports.no_items")}</p>
                      ) : null}
                      {selectedReportSession && reportRows.length > 0 ? (
                        <>
                          <div className="relative lg:shrink-0">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input type="text" className="h-10 rounded-xl pl-9" placeholder={t("inventory.reports.search_placeholder")} value={reportSearchTerm} onChange={(e) => setReportSearchTerm(e.target.value)} />
                          </div>
                          <ReportItemsDesktopTable
                            rows={filteredReportRows}
                            selectedReportItemId={selectedReportItemId}
                            onSelectItem={setSelectedReportItemId}
                            selectedReportSession={selectedReportSession}
                            canEditClosedRevision={canEditClosedRevision}
                            editEntryMutationPending={editEntryMutation.isPending}
                            openEditEntryModal={openEditEntryModal}
                            onDeleteEntry={handleDeleteEntry}
                            deleteEntryMutationPending={deleteEntryMutation.isPending}
                          />
                          <ReportItemsMobileList
                            rows={filteredReportRows}
                            selectedReportItemId={selectedReportItemId}
                            onSelectItem={setSelectedReportItemId}
                            selectedReportSession={selectedReportSession}
                            canEditClosedRevision={canEditClosedRevision}
                            editEntryMutationPending={editEntryMutation.isPending}
                            openEditEntryModal={openEditEntryModal}
                            onDeleteEntry={handleDeleteEntry}
                            deleteEntryMutationPending={deleteEntryMutation.isPending}
                          />
                          {selectedReportItemId ? (
                            <div className="space-y-3 rounded-xl border border-border/50 bg-background/60 p-3 sm:p-4 lg:shrink-0 lg:max-h-48 lg:overflow-y-auto">
                              <h4 className="text-sm font-semibold">{t("inventory.reports.item_details")}</h4>
                              {reportItemContributorsQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("inventory.reports.loading_details")}</p> : null}
                              {reportItemContributorsQuery.isError ? <p className="text-sm text-destructive">{t("inventory.reports.error_details")}</p> : null}
                              {itemContributors ? (
                                <>
                                  <p className="text-sm text-muted-foreground">
                                    {itemContributors.item_name} · итог: {formatQuantityWithUnit(itemContributors.total_quantity, itemContributors.unit)}
                                  </p>
                                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">{t("inventory.reports.who_added")}</p>
                                  {itemContributors.contributors.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">{t("inventory.reports.no_additions")}</p>
                                  ) : (
                                    <div className="space-y-1">
                                      {itemContributors.contributors.map((row) => (
                                        <p key={row.actor_user_id} className="text-sm text-muted-foreground">
                                          {row.actor_display_name}: <span className="font-medium text-foreground">{formatQuantityWithUnit(row.qty, itemContributors.unit)}</span> · {t("inventory.reports.actions_count")}: {row.actions_count}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                  <button type="button" className="text-sm text-primary hover:underline" onClick={() => setItemHistoryOpen(!itemHistoryOpen)}>
                                    {itemHistoryOpen ? t("inventory.reports.hide_item_history") : t("inventory.reports.show_item_history")}
                                  </button>
                                  {itemHistoryOpen ? (
                                    <div className="space-y-1 border-t pt-2">
                                      {itemHistoryEvents.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">{t("inventory.reports.no_item_changes")}</p>
                                      ) : (
                                        itemHistoryEvents.map((event) => (
                                          <p key={event.id} className="text-sm text-muted-foreground">
                                            {event.actor_display_name ?? event.actor_username} {formatReportHistoryAction(event)} · {formatDateTime(event.created_at)}
                                          </p>
                                        ))
                                      )}
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {reportsPanelTab === "people" && selectedReportSession ? (
                    <div className="max-h-[60dvh] space-y-3 overflow-y-auto overflow-x-hidden lg:max-h-none lg:flex-1 lg:min-h-0">
                      {participantsQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("inventory.reports.loading_people")}</p> : null}
                      {participantsQuery.isError ? <p className="text-sm text-destructive">{t("inventory.reports.error_people")}</p> : null}
                      {participantsSummary ? (
                        <>
                          <p className="text-xs font-medium text-muted-foreground">
                            {t("inventory.reports.col_employee")}: {participantsSummary.participants.length}
                          </p>
                          <div className="space-y-1.5">
                            {participantsSummary.participants.map((row) => (
                              <div key={row.actor_user_id} className="flex items-start justify-between rounded-xl border border-border/50 bg-background/60 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">{row.actor_display_name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {t("inventory.reports.col_touched_items")}: {row.touched_items_count} · {t("inventory.reports.col_entries_count")}: {row.actions_count}
                                    {row.corrections_events_count > 0 ? ` · ${t("inventory.reports.corrections")}: ${row.corrections_events_count}` : ""}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {reportsPanelTab === "history" && selectedReportSession ? (
                    <div className="max-h-[60dvh] space-y-1.5 overflow-y-auto overflow-x-hidden lg:max-h-none lg:flex-1 lg:min-h-0">
                      {reportAuditQuery.isLoading ? <p className="text-sm text-muted-foreground">{t("inventory.reports.loading_history")}</p> : null}
                      {reportAuditQuery.isError ? <p className="text-sm text-destructive">{t("inventory.reports.error_history")}</p> : null}
                      {(reportAuditQuery.data ?? []).length === 0 && !reportAuditQuery.isLoading ? (
                        <p className="text-sm text-muted-foreground">{t("inventory.reports.no_changes")}</p>
                      ) : null}
                      {(reportAuditQuery.data ?? []).map((event) => (
                        <div key={event.id} className="rounded-xl border border-border/50 bg-background/60 px-3 py-2">
                          <p className="text-sm">
                            <span className="font-medium">{event.actor_display_name ?? event.actor_username}</span>
                            {" "}
                            {formatReportHistoryAction(event)}
                            {" · "}
                            <span className="text-muted-foreground">{event.item_name}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(event.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {reportsPanelTab === "audit" && selectedReportSession && userCanViewAudit ? (
                    <AuditLogTab
                      data={auditLogQuery.data}
                      isLoading={auditLogQuery.isLoading}
                      isError={auditLogQuery.isError}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── Revision view: fast entry ── */
          <FastEntryContainer
            session={session}
            isClosed={isClosed}
            selectedWarehouseId={selectedWarehouseId}
            canSearch={canSearch}
            canManageRevision={canManageRevision}
            activeSessionLoading={activeSessionQuery.isLoading}
            fe={fe}
            setInventoryView={setInventoryView}
            canExportClosedSession={canExportClosedSession}
            exportPending={exportMutation.isPending}
            onExport={(sid) => exportMutation.mutate(sid)}
          />
        )}

        {/* ── Footer status lines ── */}
        {!currentUser && !userIsLoading ? <p className="text-sm text-destructive">{t("error.profile_load")}</p> : null}
        {inventoryView === "revision" && fe.catalogLoadError ? <p className="text-sm text-destructive">{fe.catalogLoadError}</p> : null}
        {showReportsView && reportEntriesQuery.isError ? <p className="text-sm text-destructive">{t("error.report_load")}</p> : null}
        {fe.sessionProgressLoading && false /* placeholder — progress errors shown via ProgressCard */}
        {closeSessionMutation.isError ? <p className="text-sm text-destructive">{t("error.close_failed")}</p> : null}
        {exportMutation.isError ? <p className="text-sm text-destructive">{t("error.export_failed")}</p> : null}

        {/* ── Toast ── */}
        {toastMessage ? (
          <div className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] inset-x-4 sm:inset-x-auto sm:right-6 sm:left-auto max-w-sm mx-auto sm:mx-0 rounded-xl bg-foreground px-4 py-2.5 text-sm text-background shadow-lg">
            {toastMessage}
          </div>
        ) : null}

        {/* ── Edit entry modal (shared: revision + reports) ── */}
        {editEntryState ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
            <form
              className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-5 shadow-xl"
              onSubmit={(event) => {
                event.preventDefault();
                void submitEditEntry();
              }}
            >
              <h3 className="text-base font-semibold">{t("edit.title")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{editEntryState.itemName}</p>
              <div className="mt-4 space-y-3">
                <label className="space-y-1 text-sm">
                  <span className="text-muted-foreground">{t("edit.qty_label")} ({formatUnit(editEntryState.unit)})</span>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      inputMode={editEntryState.unit === "pcs" || editEntryState.unit === "шт" ? "numeric" : "decimal"}
                      enterKeyHint="done"
                      autoFocus
                      value={editQty}
                      onChange={(event) => setEditQty(event.target.value)}
                    />
                    <Button type="submit" className="h-10 w-10 shrink-0 rounded-lg"
                      disabled={editEntryMutation.isPending}>
                      {editEntryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                  </div>
                </label>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setEditEntryState(null); setEditQty(""); setEditReason(""); }}>{t("common.cancel")}</Button>
                <Button type="submit" disabled={editEntryMutation.isPending}>{editEntryMutation.isPending ? t("common.saving") : t("common.save")}</Button>
              </div>
            </form>
          </div>
        ) : null}
      </section>

      {/* ── Delete confirm dialog ── */}
      <AlertDialog open={deleteConfirmSessionId !== null} onOpenChange={(open) => { if (!open) setDeleteConfirmSessionId(null); }}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("inventory.manage.confirm_delete_title")}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{t("inventory.manage.confirm_delete_body")}</AlertDialogDescription>
            {deleteConfirmSession ? (
              <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-left">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-destructive/80">Будет удалено</p>
                <p className="mt-1 text-sm font-medium text-foreground">Ревизия #{deleteConfirmSession.revision_no}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {resolveWarehouseName(deleteConfirmSession.warehouse_id) ?? "Склад не указан"}
                </p>
              </div>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSessionMutation.isPending}
              onClick={() => {
                if (deleteConfirmSessionId !== null) {
                  deleteSessionMutation.mutate({ sessionId: deleteConfirmSessionId }, { onSettled: () => setDeleteConfirmSessionId(null) });
                }
              }}>
              {deleteSessionMutation.isPending ? t("common.saving") : t("inventory.manage.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
