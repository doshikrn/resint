/**
 * Unified frontend permission helpers — mirrors backend/app/core/roles.py.
 */

type Role = "cook" | "souschef" | "chef" | "manager" | "admin";

// ── Permission sets (mirrors backend exactly) ───────────────
const USER_MANAGE_ROLES = new Set<Role>(["manager", "admin"]);
const REVISION_MANAGE_ROLES = new Set<Role>(["souschef", "chef", "manager", "admin"]);
const CATALOG_MANAGE_ROLES = new Set<Role>(["souschef", "chef", "manager", "admin"]);
const EXPORT_ROLES = new Set<Role>(["souschef", "chef", "manager", "admin"]);
const AUDIT_VIEW_ROLES = new Set<Role>(["souschef", "chef", "manager", "admin"]);
const ALL_WAREHOUSE_ROLES = new Set<Role>(["manager", "admin"]);
const BACKUP_MANAGE_ROLES = new Set<Role>(["manager", "admin"]);

// ── Permission helpers ──────────────────────────────────────
export function canManageUsers(role: string): boolean {
  return USER_MANAGE_ROLES.has(role as Role);
}

export function canManageRevision(role: string): boolean {
  return REVISION_MANAGE_ROLES.has(role as Role);
}

export function canManageCatalog(role: string): boolean {
  return CATALOG_MANAGE_ROLES.has(role as Role);
}

export function canExport(role: string): boolean {
  return EXPORT_ROLES.has(role as Role);
}

export function canViewAudit(role: string): boolean {
  return AUDIT_VIEW_ROLES.has(role as Role);
}

export function canAccessAllWarehouses(role: string): boolean {
  return ALL_WAREHOUSE_ROLES.has(role as Role);
}

export function canManageBackups(role: string): boolean {
  return BACKUP_MANAGE_ROLES.has(role as Role);
}
