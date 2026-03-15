from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EntryAction


class InventorySessionCreate(BaseModel):
    warehouse_id: int


class InventorySessionOut(BaseModel):
    id: int
    warehouse_id: int
    revision_no: int
    status: str
    is_closed: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None
    model_config = ConfigDict(from_attributes=True)


class InventorySessionListItemOut(BaseModel):
    id: int
    warehouse_id: int
    revision_no: int
    status: str
    is_closed: bool
    created_at: datetime | None
    updated_at: datetime | None
    items_count: int
    deleted_at: datetime | None = None


class InventorySessionEventOut(BaseModel):
    id: int
    session_id: int
    actor_user_id: int
    actor_username: str | None
    actor_display_name: str | None
    action: str
    reason: str | None
    request_id: str | None
    created_at: datetime


class InventoryZoneProgressOut(BaseModel):
    session_id: int
    warehouse_id: int
    warehouse_name: str
    zone_id: int
    zone_name: str
    session_status: str
    is_session_closed: bool
    entered_items_count: int
    entered_items_by_user_count: int = 0
    last_activity_at: datetime | None
    is_completed: bool
    completed_at: datetime | None
    completed_by_user_id: int | None
    completed_by_username: str | None


class InventorySessionProgressOut(BaseModel):
    session_id: int
    warehouse_id: int
    status: str
    is_session_closed: bool
    total_counted_items: int
    my_counted_items: int
    last_activity_at: datetime | None


class InventoryCatalogItemOut(BaseModel):
    id: int
    product_code: str
    name: str
    unit: str
    step: float
    min_qty: float | None
    max_qty: float | None
    is_favorite: bool
    is_active: bool
    warehouse_id: int
    station_id: int | None = None
    updated_at: datetime
    aliases: list[str] = []


class InventoryUserRefOut(BaseModel):
    id: int
    username: str
    display_name: str


class InventoryEntrySnapshotOut(BaseModel):
    item_id: int
    qty: float
    unit: str
    updated_at: datetime
    updated_by_user: InventoryUserRefOut


class InventoryAddEntry(BaseModel):
    item_id: int
    quantity: float = Field(..., gt=0.01, lt=100000)
    mode: str = EntryAction.ADD  # "add" | "set"
    reason: str | None = Field(default=None, max_length=500)
    station_id: int | None = None
    counted_outside_zone: bool = False
    outside_zone_note: str | None = Field(default=None, max_length=500)
    expected_version: int | None = None


class InventoryEntryOut(BaseModel):
    id: int
    session_id: int
    item_id: int
    item_name: str
    unit: str
    quantity: float
    version: int
    updated_at: datetime
    station_id: int | None = None
    station_name: str | None = None
    station_department: str | None = None
    counted_outside_zone: bool = False
    counted_by_zone_id: int | None = None
    counted_by_zone: str | None = None
    outside_zone_note: str | None = None
    contributors_count: int = 1
    contributors_preview: list[str] = Field(default_factory=list)
    model_config = ConfigDict(from_attributes=True)


class InventoryEntryPatch(BaseModel):
    quantity: float = Field(..., gt=0.01, lt=100000)
    reason: str | None = Field(default=None, max_length=500)
    station_id: int | None = None
    counted_outside_zone: bool = False
    outside_zone_note: str | None = Field(default=None, max_length=500)
    version: int | None = Field(default=None, ge=1)


class ActiveSessionRequest(BaseModel):
    warehouse_id: int
    create_if_missing: bool = True


class InventoryEntryEventOut(BaseModel):
    id: int
    session_id: int
    item_id: int
    item_name: str
    actor_user_id: int
    actor_username: str
    actor_display_name: str
    action: str
    reason: str | None
    station_id: int | None = None
    counted_outside_zone: bool = False
    counted_by_zone_id: int | None = None
    outside_zone_note: str | None = None
    request_id: str | None
    before_quantity: float | None
    after_quantity: float
    created_at: datetime


class InventoryRecentEventOut(BaseModel):
    id: int
    session_id: int
    item_id: int
    item_name: str
    unit: str
    mode: str
    qty_input: float
    qty_delta: float
    actor_user_id: int
    actor_username: str | None
    actor_display_name: str | None
    station_id: int | None = None
    station_name: str | None = None
    station_department: str | None = None
    counted_outside_zone: bool = False
    counted_by_zone_id: int | None = None
    counted_by_zone: str | None = None
    outside_zone_note: str | None = None
    request_id: str | None
    before_quantity: float | None
    after_quantity: float
    created_at: datetime


class InventoryReportItemOut(BaseModel):
    item_id: int
    item_name: str
    unit: str
    quantity: float


class InventorySessionReportOut(BaseModel):
    session_id: int
    warehouse_id: int
    status: str
    is_closed: bool
    created_at: datetime
    updated_at: datetime | None
    items: list[InventoryReportItemOut]


class InventoryDiffItemOut(BaseModel):
    item_id: int
    item_name: str
    unit: str
    previous_quantity: float
    current_quantity: float
    diff_quantity: float


class InventoryDiffTotalsOut(BaseModel):
    previous_quantity: float
    current_quantity: float
    diff_quantity: float


class InventoryDiffReportOut(BaseModel):
    warehouse_id: int
    from_dt: datetime = Field(alias="from")
    to_dt: datetime = Field(alias="to")
    previous_from: datetime
    previous_to: datetime
    mode: str = "range"
    tz_offset_minutes: int | None = None
    day_local: str | None = None
    items: list[InventoryDiffItemOut]
    totals: InventoryDiffTotalsOut


class InventoryItemContributorOut(BaseModel):
    actor_user_id: int
    actor_username: str | None
    actor_display_name: str
    qty: float
    actions_count: int


class InventoryItemCorrectionOut(BaseModel):
    actor_user_id: int
    actor_username: str | None
    actor_display_name: str
    quantity_delta: float
    events_count: int


class InventoryItemContributorsOut(BaseModel):
    session_id: int
    item_id: int
    item_name: str
    unit: str
    total_quantity: float
    contributors_count: int
    contributors: list[InventoryItemContributorOut]
    corrections_total_delta: float
    corrections: list[InventoryItemCorrectionOut]


class InventoryParticipantSummaryItemOut(BaseModel):
    actor_user_id: int
    actor_username: str | None
    actor_display_name: str
    touched_items_count: int = 0
    actions_count: int = 0
    last_activity_at: datetime | None = None
    kg: float = 0.0
    l: float = 0.0
    pcs: float = 0.0
    corrections_total_delta: float = 0.0
    corrections_events_count: int = 0


class InventoryParticipantsSummaryOut(BaseModel):
    session_id: int
    participants: list[InventoryParticipantSummaryItemOut]


class AuditLogOut(BaseModel):
    id: int
    actor_id: int
    actor_username: str | None = None
    actor_display_name: str | None = None
    action: str
    entity_type: str
    entity_id: int | None = None
    warehouse_id: int | None = None
    metadata_json: str | None = None
    created_at: datetime
    previous_hash: str
    hash: str

    model_config = {"from_attributes": True}
