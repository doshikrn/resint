"use client";

import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { AuditLogEntry } from "@/lib/api/http";

// ── Action → human-readable Russian label ───────────────────
const ACTION_LABELS: Record<string, string> = {
  revision_created: "Создал ревизию",
  revision_closed: "Закрыл ревизию",
  revision_reopened: "Возобновил ревизию",
  revision_deleted: "Удалил ревизию",
  revision_exported: "Экспортировал Excel",
  entry_updated: "Изменил итог",
  entry_corrected: "Исправил итог",
  entry_deleted: "Удалил товар из ревизии",
  user_created: "Создал пользователя",
  user_updated: "Изменил пользователя",
  user_deleted: "Удалил пользователя",
  user_role_changed: "Изменил роль",
  user_password_reset: "Сбросил пароль",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// ── Entity type label ───────────────────────────────────────
function entityLabel(entityType: string): string {
  switch (entityType) {
    case "session":
      return "Ревизия";
    case "entry":
      return "Позиция";
    case "user":
      return "Пользователь";
    default:
      return entityType;
  }
}

// ── Smart entity badge — hide internal IDs, show human names ─
function buildEntityBadge(event: AuditLogEntry): { label: string; show: boolean } {
  const meta = parseMeta(event);
  if (event.entity_type === "session") {
    const revNo = meta?.revision_no;
    if (revNo != null) return { label: `Ревизия #${revNo}`, show: true };
    return { label: "", show: false };
  }
  if (event.entity_type === "entry") {
    const itemName = meta?.item_name;
    if (itemName) return { label: String(itemName), show: true };
    return { label: "", show: false };
  }
  if (event.entity_type === "user") {
    const username = meta?.username;
    if (username) return { label: String(username), show: true };
    return { label: "", show: false };
  }
  return { label: `${entityLabel(event.entity_type)} #${event.entity_id}`, show: true };
}

// ── Parse metadata_json safely ──────────────────────────────
function parseMeta(entry: AuditLogEntry): Record<string, unknown> | null {
  if (!entry.metadata_json) return null;
  try {
    return JSON.parse(entry.metadata_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Build brief detail string from metadata ─────────────────
function metadataDetail(entry: AuditLogEntry): string | null {
  const meta = parseMeta(entry);
  if (!meta) return null;

  const parts: string[] = [];

  if (meta.item_id && meta.before_qty != null && meta.after_qty != null) {
    parts.push(`${meta.before_qty} → ${meta.after_qty}`);
  }
  if (meta.revision_no != null && entry.entity_type !== "session") {
    parts.push(`#${meta.revision_no}`);
  }
  if (meta.format) {
    parts.push(String(meta.format).toUpperCase());
  }
  if (meta.username) {
    parts.push(String(meta.username));
  }
  if (meta.reason) {
    parts.push(String(meta.reason));
  }
  if (meta.fields && Array.isArray(meta.fields)) {
    parts.push(meta.fields.join(", "));
  }
  if (meta.role) {
    parts.push(String(meta.role));
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

// ── Build searchable text blob per event ────────────────────
function buildSearchText(entry: AuditLogEntry): string {
  const parts: string[] = [
    entry.actor_display_name ?? "",
    entry.actor_username ?? "",
    actionLabel(entry.action),
    entityLabel(entry.entity_type),
  ];

  if (entry.entity_id != null) {
    parts.push(`#${entry.entity_id}`);
  }

  const meta = parseMeta(entry);
  if (meta) {
    if (meta.revision_no != null) parts.push(`#${meta.revision_no}`);
    if (meta.username) parts.push(String(meta.username));
    if (meta.role) parts.push(String(meta.role));
    if (meta.reason) parts.push(String(meta.reason));
    if (meta.format) parts.push(String(meta.format));
    if (meta.item_name) parts.push(String(meta.item_name));
    if (meta.fields && Array.isArray(meta.fields)) parts.push(meta.fields.join(" "));
  }

  return parts.join(" ").toLowerCase();
}

// ── Time helpers ────────────────────────────────────────────
type TimeGroup = "today" | "yesterday" | "earlier";

const almatyDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Almaty",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function getLocalDay(d: Date): string {
  return almatyDayFmt.format(d);
}

function getTimeGroup(dateStr: string): TimeGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const todayStr = getLocalDay(now);
  const dateLocal = getLocalDay(date);

  if (dateLocal === todayStr) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateLocal === getLocalDay(yesterday)) return "yesterday";

  return "earlier";
}

function isWithinDays(dateStr: string, days: number): boolean {
  const date = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return date >= cutoff;
}

const GROUP_LABELS: Record<TimeGroup, string> = {
  today: "Сегодня",
  yesterday: "Вчера",
  earlier: "Ранее",
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Almaty",
  }).format(date);
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Almaty",
  }).format(date);
}

// ── Filter types ────────────────────────────────────────────
type CategoryFilter = "all" | "revision" | "entry" | "export";
type TimeFilter = "all" | "today" | "yesterday" | "7days";

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "revision", label: "Ревизия" },
  { value: "entry", label: "Товары" },
  { value: "export", label: "Экспорт" },
];

const TIME_FILTERS: { value: TimeFilter; label: string }[] = [
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "7days", label: "7 дней" },
  { value: "all", label: "Все" },
];

const CATEGORY_ACTIONS: Record<CategoryFilter, Set<string> | null> = {
  all: null,
  revision: new Set([
    "revision_created",
    "revision_closed",
    "revision_reopened",
    "revision_deleted",
  ]),
  entry: new Set(["entry_updated", "entry_corrected", "entry_deleted"]),
  export: new Set(["revision_exported"]),
};

function matchesCategory(entry: AuditLogEntry, cat: CategoryFilter): boolean {
  const allowed = CATEGORY_ACTIONS[cat];
  return allowed === null || allowed.has(entry.action);
}

function matchesTime(entry: AuditLogEntry, tf: TimeFilter): boolean {
  switch (tf) {
    case "all":
      return true;
    case "today":
      return getTimeGroup(entry.created_at) === "today";
    case "yesterday":
      return (
        getTimeGroup(entry.created_at) === "today" ||
        getTimeGroup(entry.created_at) === "yesterday"
      );
    case "7days":
      return isWithinDays(entry.created_at, 7);
  }
}

// ── Component ───────────────────────────────────────────────
type AuditLogTabProps = {
  data: AuditLogEntry[] | undefined;
  isLoading: boolean;
  isError: boolean;
};

type GroupedEvents = {
  group: TimeGroup;
  label: string;
  events: AuditLogEntry[];
};

export function AuditLogTab({ data, isLoading, isError }: AuditLogTabProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");

  // Unique actors from data
  const actors = useMemo(() => {
    if (!data) return [];
    const seen = new Map<string, string>();
    for (const e of data) {
      const key = String(e.actor_id);
      if (!seen.has(key)) {
        seen.set(key, e.actor_display_name ?? e.actor_username ?? key);
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [data]);

  const resetFilters = useCallback(() => {
    setSearchTerm("");
    setCategoryFilter("all");
    setTimeFilter("all");
    setActorFilter("all");
  }, []);

  const hasActiveFilters =
    searchTerm.trim() !== "" ||
    categoryFilter !== "all" ||
    timeFilter !== "all" ||
    actorFilter !== "all";

  // Filtered events
  const filtered = useMemo(() => {
    if (!data) return [];

    const needle = searchTerm.trim().toLowerCase();

    return data.filter((e) => {
      if (!matchesCategory(e, categoryFilter)) return false;
      if (!matchesTime(e, timeFilter)) return false;
      if (actorFilter !== "all" && String(e.actor_id) !== actorFilter) return false;
      if (needle && !buildSearchText(e).includes(needle)) return false;
      return true;
    });
  }, [data, searchTerm, categoryFilter, timeFilter, actorFilter]);

  // Group filtered events
  const grouped = useMemo(() => {
    if (filtered.length === 0) return [];

    const groups: GroupedEvents[] = [];
    const order: TimeGroup[] = ["today", "yesterday", "earlier"];

    for (const g of order) {
      const events = filtered.filter((e) => getTimeGroup(e.created_at) === g);
      if (events.length > 0) {
        groups.push({ group: g, label: GROUP_LABELS[g], events });
      }
    }
    return groups;
  }, [filtered]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка журнала…</p>;
  }

  if (isError) {
    return <p className="text-sm text-destructive">Не удалось загрузить журнал действий</p>;
  }

  if (!data || data.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет записей в журнале</p>;
  }

  return (
    <div className="flex flex-col gap-2 lg:flex-1 lg:min-h-0">
      {/* ── Search ─────────────────────────────────────────── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Поиск по журналу…"
          className="h-9 rounded-lg pl-9 text-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* ── Filters row ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* Category */}
        <div className="inline-flex rounded-lg border border-border/60 bg-background/70 p-0.5">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                categoryFilter === f.value
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setCategoryFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Time */}
        <div className="inline-flex rounded-lg border border-border/60 bg-background/70 p-0.5">
          {TIME_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                timeFilter === f.value
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTimeFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Actor select */}
        {actors.length > 1 ? (
          <select
            className="h-7 rounded-lg border border-border/60 bg-background/70 px-2 text-xs text-foreground"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
          >
            <option value="all">Все сотрудники</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : null}

        {/* Reset */}
        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={resetFilters}
          >
            Сбросить
          </Button>
        ) : null}
      </div>

      {/* ── Results count ──────────────────────────────────── */}
      {hasActiveFilters ? (
        <p className="text-xs text-muted-foreground">
          {filtered.length === 0
            ? "Ничего не найдено"
            : `Найдено: ${filtered.length}`}
        </p>
      ) : null}

      {/* ── Event list ─────────────────────────────────────── */}
      {filtered.length > 0 ? (
        <div className="max-h-[50dvh] overflow-y-auto overflow-x-hidden rounded-xl border border-border/70 lg:max-h-none lg:flex-1 lg:min-h-0">
          <div className="divide-y divide-border/50">
            {grouped.map((group) => (
              <div key={group.group}>
                <div className="sticky top-0 z-10 bg-muted/95 px-4 py-2 backdrop-blur-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
                    {group.label}
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {group.events.map((event) => {
                    const detail = metadataDetail(event);
                    const isEarlier = group.group === "earlier";
                    return (
                      <div
                        key={event.id}
                        className="flex flex-col gap-0.5 px-4 py-3 hover:bg-muted/20"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="text-sm font-medium text-foreground">
                              {event.actor_display_name ?? event.actor_username ?? "—"}
                            </span>
                            <span className="text-sm text-foreground/80">
                              {actionLabel(event.action)}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground pt-0.5">
                            {isEarlier
                              ? formatDateShort(event.created_at)
                              : formatTime(event.created_at)}
                          </span>
                        </div>
                        {(() => {
                          const badge = buildEntityBadge(event);
                          return (badge.show || detail) ? (
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              {badge.show ? (
                                <span className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  {badge.label}
                                </span>
                              ) : null}
                              {detail ? (
                                <span className="text-xs text-muted-foreground">{detail}</span>
                              ) : null}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
