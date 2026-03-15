export const API_BASE_URL = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export const API_ROUTES = {
  root: "/",
  health: "/health",
  live: "/live",
  healthLive: "/health/live",
  healthReady: "/health/ready",
  ready: "/ready",
  metrics: "/metrics",

  auth: {
    login: "/auth/login",
    refresh: "/auth/refresh",
    logout: "/auth/logout",
    me: "/auth/me",
  },

  users: {
    me: "/users/me",
    updateMe: "/users/me",
    heartbeat: "/users/heartbeat",
    online: "/users/online",
    list: "/users",
    create: "/users",
  },

  warehouses: {
    list: "/warehouses",
    create: "/warehouses",
  },

  zones: {
    list: "/zones",
    create: "/zones",
  },

  stations: {
    list: "/stations",
    create: "/stations",
  },

  items: {
    list: "/items",
    create: "/items",
    units: "/items/units",
    recent: "/items/recent",
    frequent: "/items/frequent",
    search: "/items/search",
    import: "/items/import",
    export: "/items/export",
    categories: "/items/categories",
    patch: (itemId: number) => `/items/${itemId}`,
    createAlias: (itemId: number) => `/items/${itemId}/aliases`,
    deleteAlias: (itemId: number, aliasId: number) => `/items/${itemId}/aliases/${aliasId}`,
  },

  inventory: {
    createSession: "/inventory/sessions",
    sessions: "/inventory/sessions",
    activeSession: "/inventory/sessions/active",
    session: (sessionId: number) => `/inventory/sessions/${sessionId}`,
    sessionEvents: (sessionId: number) => `/inventory/sessions/${sessionId}/events`,
    sessionEntries: (sessionId: number) => `/inventory/sessions/${sessionId}/entries`,
    sessionEntryPatch: (sessionId: number, itemId: number) =>
      `/inventory/sessions/${sessionId}/entries/${itemId}`,
    sessionEntryDelete: (sessionId: number, itemId: number) =>
      `/inventory/sessions/${sessionId}/entries/${itemId}`,
    sessionEntriesRecent: (sessionId: number) => `/inventory/sessions/${sessionId}/entries/recent`,
    sessionEntriesRecentEvents: (sessionId: number) =>
      `/inventory/sessions/${sessionId}/entries/recent-events`,
    sessionClose: (sessionId: number) => `/inventory/sessions/${sessionId}/close`,
    sessionReopen: (sessionId: number) => `/inventory/sessions/${sessionId}/reopen`,
    sessionDelete: (sessionId: number) => `/inventory/sessions/${sessionId}`,
    sessionReport: (sessionId: number) => `/inventory/reports/session/${sessionId}`,
    sessionExport: (sessionId: number) => `/inventory/sessions/${sessionId}/export`,
    sessionAudit: (sessionId: number) => `/inventory/sessions/${sessionId}/audit`,
    sessionAuditLog: (sessionId: number) => `/inventory/sessions/${sessionId}/audit-log`,
    entryAudit: (sessionId: number, itemId: number) =>
      `/inventory/entries/${sessionId}/${itemId}/audit`,
    sessionItemContributors: (sessionId: number, itemId: number) =>
      `/inventory/sessions/${sessionId}/items/${itemId}/contributors`,
    sessionParticipants: (sessionId: number) => `/inventory/sessions/${sessionId}/participants`,
    globalAudit: "/inventory/audit",
    sessionProgress: (sessionId: number) => `/inventory/sessions/${sessionId}/progress`,
    sessionZoneComplete: (sessionId: number) => `/inventory/sessions/${sessionId}/zone-complete`,
    progress: "/inventory/progress",
    reportDiff: "/inventory/reports/diff",
    reportDiffToday: "/inventory/reports/diff/today",
  },

  admin: {
    backups: "/admin/backups",
    backupCreate: "/admin/backups/create",
    backupDelete: (filename: string) => `/admin/backups/${encodeURIComponent(filename)}`,
    backupDownload: (filename: string) => `/admin/backups/download/${encodeURIComponent(filename)}`,
    backupRestore: "/admin/backups/restore",
    backupStatus: "/admin/backups/status",
    systemStatus: "/admin/system-status",
  },
} as const;

export function makeApiUrl(path: string): string {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}${path}`;
}
