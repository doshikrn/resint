// Barrel re-export — preserves all existing import paths.
// Domain modules live in sibling files; this file re-exports everything.

export { ApiRequestError, apiRequest } from "@/lib/api/request";

export type {
  Zone,
  Warehouse,
  Station,
  CurrentUserProfile,
  InventorySession,
  InventorySessionListItem,
  InventoryEntry,
  InventoryEntryEvent,
  InventoryRecentEvent,
  InventorySessionEvent,
  InventoryItemContributor,
  InventoryItemCorrection,
  InventoryItemContributors,
  InventoryParticipantSummaryItem,
  InventoryParticipantsSummary,
  InventoryZoneProgress,
  InventorySessionProgress,
  ItemSearchResult,
  InventoryCatalogItem,
  InventoryEntrySnapshotRow,
  ItemCatalog,
  ItemBulkUpsertRow,
  ItemBulkUpsertResult,
  OnlineUser,
  UserListItem,
  AuditLogEntry,
  BackupFile,
  RestoreResult,
  HealthReadyResponse,
} from "@/lib/api/types";

export { getCurrentUser, sendHeartbeat, getOnlineUsers } from "@/lib/api/auth";

export {
  listUsers,
  adminCreateUser,
  adminPatchUser,
  adminResetPassword,
  adminDeleteUser,
  updateMyProfile,
  changeMyPassword,
} from "@/lib/api/users";

export {
  getItems,
  createItem,
  patchItem,
  getItemUnits,
  bulkUpsertItems,
  searchItems,
  getFrequentItems,
  getRecentItems,
} from "@/lib/api/items";

export {
  getOrCreateActiveSession,
  createInventorySession,
  listInventorySessions,
  closeInventorySession,
  reopenInventorySession,
  deleteInventorySession,
  fetchSessionCatalog,
  getSessionEntriesSnapshot,
  saveInventoryEntry,
  patchInventoryEntry,
  deleteInventoryEntry,
  getRecentInventoryEntries,
  getRecentInventoryEvents,
  getSessionInventoryEntries,
  getSessionInventoryAudit,
  getSessionAuditLog,
  getSessionItemContributors,
  getSessionParticipants,
  getSessionEvents,
  getSessionInventoryProgress,
  completeSessionZone,
  getInventoryProgress,
  exportInventorySessionXlsx,
} from "@/lib/api/inventory";

export { getStations, getZones, getWarehouses } from "@/lib/api/warehouses";

export {
  listBackups,
  createBackup,
  deleteBackup,
  downloadBackup,
  restoreBackup,
  getBackupStatus,
  checkHealthReady,
} from "@/lib/api/admin";
