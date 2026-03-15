export type Zone = {
  id: number;
  name: string;
  description: string | null;
};

export type Warehouse = {
  id: number;
  name: string;
  zone_id: number;
};

export type Station = {
  id: number;
  name: string;
  department: "kitchen" | "bar";
  is_active: boolean;
  sort_order: number | null;
};

export type CurrentUserProfile = {
  username: string;
  full_name: string | null;
  role: "cook" | "souschef" | "chef" | "manager" | "admin";
  role_label: string;
  department: "kitchen" | "bar" | null;
  warehouse_id: number | null;
  default_station_id: number | null;
  default_warehouse_id: number | null;
  preferred_language: string | null;
};

export type InventorySession = {
  id: number;
  warehouse_id: number;
  revision_no: number;
  status: string;
  is_closed: boolean;
  updated_at: string | null;
};

export type InventorySessionListItem = {
  id: number;
  warehouse_id: number;
  revision_no: number;
  status: string;
  is_closed: boolean;
  created_at: string | null;
  updated_at: string | null;
  items_count: number;
  deleted_at: string | null;
};

export type InventoryEntry = {
  id: number;
  session_id: number;
  item_id: number;
  item_name: string;
  unit: string;
  quantity: number;
  version: number;
  updated_at: string;
  station_id: number | null;
  station_name: string | null;
  station_department: string | null;
  counted_outside_zone: boolean;
  counted_by_zone_id: number | null;
  counted_by_zone: string | null;
  outside_zone_note: string | null;
  contributors_count?: number;
  contributors_preview?: string[];
};

export type InventoryEntryEvent = {
  id: number;
  session_id: number;
  item_id: number;
  item_name: string;
  actor_user_id: number;
  actor_username: string;
  actor_display_name: string;
  action: string;
  reason: string | null;
  station_id: number | null;
  counted_outside_zone: boolean;
  counted_by_zone_id: number | null;
  outside_zone_note: string | null;
  request_id: string | null;
  before_quantity: number | null;
  after_quantity: number;
  created_at: string;
};

export type InventoryRecentEvent = {
  id: number;
  session_id: number;
  item_id: number;
  item_name: string;
  unit: string;
  mode: "add" | "set" | string;
  qty_input: number;
  qty_delta: number;
  actor_user_id: number;
  actor_username: string | null;
  actor_display_name: string | null;
  station_id: number | null;
  station_name: string | null;
  station_department: string | null;
  counted_outside_zone: boolean;
  counted_by_zone_id: number | null;
  counted_by_zone: string | null;
  outside_zone_note: string | null;
  request_id: string | null;
  before_quantity: number | null;
  after_quantity: number;
  created_at: string;
};

export type InventorySessionEvent = {
  id: number;
  session_id: number;
  actor_user_id: number;
  actor_username: string | null;
  actor_display_name: string | null;
  action: string;
  reason: string | null;
  request_id: string | null;
  created_at: string;
};

export type InventoryItemContributor = {
  actor_user_id: number;
  actor_username: string | null;
  actor_display_name: string;
  qty: number;
  actions_count: number;
};

export type InventoryItemCorrection = {
  actor_user_id: number;
  actor_username: string | null;
  actor_display_name: string;
  quantity_delta: number;
  events_count: number;
};

export type InventoryItemContributors = {
  session_id: number;
  item_id: number;
  item_name: string;
  unit: string;
  total_quantity: number;
  contributors_count: number;
  contributors: InventoryItemContributor[];
  corrections_total_delta: number;
  corrections: InventoryItemCorrection[];
};

export type InventoryParticipantSummaryItem = {
  actor_user_id: number;
  actor_username: string | null;
  actor_display_name: string;
  touched_items_count: number;
  actions_count: number;
  last_activity_at: string | null;
  kg: number;
  l: number;
  pcs: number;
  corrections_total_delta: number;
  corrections_events_count: number;
};

export type InventoryParticipantsSummary = {
  session_id: number;
  participants: InventoryParticipantSummaryItem[];
};

export type InventoryZoneProgress = {
  session_id: number;
  warehouse_id: number;
  warehouse_name: string;
  zone_id: number;
  zone_name: string;
  session_status: string;
  is_session_closed: boolean;
  entered_items_count: number;
  entered_items_by_user_count: number;
  last_activity_at: string | null;
  is_completed: boolean;
  completed_at: string | null;
  completed_by_user_id: number | null;
  completed_by_username: string | null;
};

export type InventorySessionProgress = {
  session_id: number;
  warehouse_id: number;
  status: string;
  is_session_closed: boolean;
  total_counted_items: number;
  my_counted_items: number;
  last_activity_at: string | null;
};

export type ItemSearchResult = {
  id: number;
  product_code: string | null;
  name: string;
  unit: string;
  step: number;
  min_qty: number | null;
  max_qty: number | null;
  is_favorite: boolean;
  warehouse_id: number;
  station_id?: number | null;
};

export type InventoryCatalogItem = ItemSearchResult & {
  aliases: string[];
  updated_at: string;
  is_active: boolean;
};

export type InventoryEntrySnapshotRow = {
  item_id: number;
  qty: number;
  unit: string;
  updated_at: string;
  updated_by_user: {
    id: number;
    username: string;
    display_name: string;
  };
};

export type ItemCatalog = {
  id: number;
  product_code: string | null;
  name: string;
  unit: string;
  step: number;
  min_qty: number | null;
  max_qty: number | null;
  is_favorite: boolean;
  is_active: boolean;
  warehouse_id: number;
  category_id: number | null;
  station_id: number | null;
};

export type ItemBulkUpsertRow = {
  product_code?: string;
  name: string;
  unit: string;
  warehouse_id?: number;
  station_id?: number | null;
  station_name?: string;
  step?: number;
  min_qty?: number | null;
  max_qty?: number | null;
  is_active?: boolean;
  is_favorite?: boolean;
  category_id?: number | null;
  category_name?: string;
};

export type ItemBulkUpsertResult = {
  dry_run: boolean;
  total: number;
  created: number;
  updated: number;
  skipped_existing: number;
  errors: Array<{ row: number; message: string }>;
};

export type OnlineUser = {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
  role_label: string;
};

export type UserListItem = {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
  role_label: string;
  is_active: boolean;
  department: string | null;
  warehouse_id: number | null;
  default_warehouse_id: number | null;
  last_seen_at: string | null;
};

export type AuditLogEntry = {
  id: number;
  actor_id: number;
  actor_username: string | null;
  actor_display_name: string | null;
  action: string;
  entity_type: string;
  entity_id: number | null;
  warehouse_id: number | null;
  metadata_json: string | null;
  created_at: string;
  previous_hash: string;
  hash: string;
};

export type BackupFile = {
  filename: string;
  size_bytes: number;
  created_at: string;
  session_id: number | null;
  revision_no: number | null;
  checksum: string | null;
  uploaded_to_s3: boolean;
  s3_key: string | null;
  upload_error: string | null;
  download_url: string | null;
};

export type RestoreResult = {
  status: string;
  emergency_backup: string | null;
  restored_from: string;
  tables_count: number | null;
};

export type HealthReadyResponse = {
  status: string;
  maintenance_mode: boolean;
  service_version?: string;
  build_sha?: string;
  checks?: { db: string; migrations: string };
  db_latency_ms?: number;
};
