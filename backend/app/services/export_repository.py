from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import and_, case, func, inspect
from sqlalchemy.orm import Session, aliased

from app.models.enums import SessionStatus
from app.models.inventory_entry import InventoryEntry
from app.models.inventory_session import InventorySession
from app.models.inventory_session_total import InventorySessionTotal
from app.models.item import Item
from app.models.item_category import ItemCategory
from app.models.station import Station
from app.models.user import User
from app.models.warehouse import Warehouse
from app.models.zone import Zone


@dataclass
class SessionExportMeta:
    session_id: int
    session_status: str
    session_started_at: datetime
    warehouse_name: str
    zone_name: str


@dataclass
class SessionExportRow:
    item_id: int
    product_code: str
    zone: str
    warehouse: str
    session_id: int
    session_status: str
    item: str
    unit: str
    step: Decimal
    qty: Decimal
    category: str
    counted_outside_zone: bool
    counted_by_zone_name: str
    updated_at: datetime
    updated_by: str
    station_name: str
    station_department: str


@dataclass
class SessionCatalogExportRow:
    item_id: int
    product_code: str
    name: str
    unit: str
    qty: Decimal | None


def _has_table(db: Session, table_name: str) -> bool:
    try:
        conn = db.connection()
        return bool(inspect(conn).has_table(table_name))
    except Exception:
        return False


def fetch_session_export_rows(
    db: Session, session_id: int
) -> tuple[SessionExportMeta | None, list[SessionExportRow]]:
    warehouse_zone = aliased(Zone)
    counted_zone = aliased(Zone)

    has_totals_table = _has_table(db, InventorySessionTotal.__tablename__)

    if has_totals_table:
        quantity_expr = case(
            (
                InventorySession.status == SessionStatus.CLOSED,
                func.coalesce(InventorySessionTotal.qty_final, InventoryEntry.quantity),
            ),
            else_=InventoryEntry.quantity,
        ).label("qty")
    else:
        quantity_expr = InventoryEntry.quantity.label("qty")

    query = (
        db.query(
            warehouse_zone.name.label("zone_name"),
            Warehouse.name.label("warehouse_name"),
            InventorySession.id.label("session_id"),
            InventorySession.status.label("session_status"),
            InventorySession.created_at.label("session_started_at"),
            Item.name.label("item_name"),
            Item.id.label("item_id"),
            Item.product_code.label("product_code"),
            Item.unit.label("unit"),
            Item.step.label("step"),
            ItemCategory.name.label("category_name"),
            User.username.label("updated_by"),
            InventoryEntry.counted_outside_zone.label("counted_outside_zone"),
            counted_zone.name.label("counted_by_zone_name"),
            Station.name.label("station_name"),
            Station.department.label("station_department"),
            InventoryEntry.updated_at.label("updated_at"),
            quantity_expr,
        )
        .join(InventorySession, InventorySession.id == InventoryEntry.session_id)
        .join(Warehouse, Warehouse.id == InventorySession.warehouse_id)
        .outerjoin(warehouse_zone, warehouse_zone.id == Warehouse.zone_id)
        .outerjoin(counted_zone, counted_zone.id == InventoryEntry.counted_by_zone_id)
        .join(Item, Item.id == InventoryEntry.item_id)
        .outerjoin(ItemCategory, ItemCategory.id == Item.category_id)
        .join(User, User.id == InventoryEntry.updated_by_user_id)
        .outerjoin(Station, Station.id == InventoryEntry.station_id)
        .filter(InventoryEntry.session_id == session_id)
        .order_by(
            func.coalesce(ItemCategory.name, "Uncategorized").asc(),
            Item.name.asc(),
            InventoryEntry.id.asc(),
        )
    )

    if has_totals_table:
        query = query.outerjoin(
            InventorySessionTotal,
            and_(
                InventorySessionTotal.session_id == InventoryEntry.session_id,
                InventorySessionTotal.item_id == InventoryEntry.item_id,
            ),
        )

    rows = query.all()

    if rows:
        head = rows[0]
        meta = SessionExportMeta(
            session_id=int(head.session_id),
            session_status=str(head.session_status),
            session_started_at=head.session_started_at,
            warehouse_name=str(head.warehouse_name),
            zone_name=str(head.zone_name or ""),
        )
        prepared_rows = [
            SessionExportRow(
                item_id=int(row.item_id),
                product_code=(str(row.product_code) if row.product_code else ""),
                zone=str(row.zone_name or ""),
                warehouse=str(row.warehouse_name),
                session_id=int(row.session_id),
                session_status=str(row.session_status),
                item=str(row.item_name),
                unit=str(row.unit),
                step=Decimal(str(row.step)),
                qty=Decimal(str(row.qty)),
                category=str(row.category_name or ""),
                counted_outside_zone=bool(row.counted_outside_zone),
                counted_by_zone_name=str(row.counted_by_zone_name or ""),
                updated_at=row.updated_at,
                updated_by=str(row.updated_by),
                station_name=str(row.station_name or ""),
                station_department=(
                    str(row.station_department.value)
                    if hasattr(row.station_department, "value")
                    else str(row.station_department or "")
                ),
            )
            for row in rows
        ]
        return meta, prepared_rows

    meta_row = (
        db.query(
            Zone.name.label("zone_name"),
            Warehouse.name.label("warehouse_name"),
            InventorySession.id.label("session_id"),
            InventorySession.status.label("session_status"),
            InventorySession.created_at.label("session_started_at"),
        )
        .join(Warehouse, Warehouse.id == InventorySession.warehouse_id)
        .outerjoin(Zone, Zone.id == Warehouse.zone_id)
        .filter(InventorySession.id == session_id)
        .first()
    )

    if not meta_row:
        return None, []

    meta = SessionExportMeta(
        session_id=int(meta_row.session_id),
        session_status=str(meta_row.session_status),
        session_started_at=meta_row.session_started_at,
        warehouse_name=str(meta_row.warehouse_name),
        zone_name=str(meta_row.zone_name or ""),
    )
    return meta, []


def fetch_session_catalog_export_rows(
    db: Session,
    session_id: int,
) -> tuple[SessionExportMeta | None, list[SessionCatalogExportRow]]:
    meta_row = (
        db.query(
            Zone.name.label("zone_name"),
            Warehouse.name.label("warehouse_name"),
            InventorySession.id.label("session_id"),
            InventorySession.status.label("session_status"),
            InventorySession.created_at.label("session_started_at"),
            InventorySession.warehouse_id.label("warehouse_id"),
        )
        .join(Warehouse, Warehouse.id == InventorySession.warehouse_id)
        .outerjoin(Zone, Zone.id == Warehouse.zone_id)
        .filter(InventorySession.id == session_id)
        .first()
    )

    if not meta_row:
        return None, []

    meta = SessionExportMeta(
        session_id=int(meta_row.session_id),
        session_status=str(meta_row.session_status),
        session_started_at=meta_row.session_started_at,
        warehouse_name=str(meta_row.warehouse_name),
        zone_name=str(meta_row.zone_name or ""),
    )

    rows = (
        db.query(
            Item.id.label("item_id"),
            Item.product_code.label("product_code"),
            Item.name.label("item_name"),
            Item.unit.label("unit"),
            InventoryEntry.quantity.label("qty"),
        )
        .outerjoin(
            InventoryEntry,
            and_(
                InventoryEntry.item_id == Item.id,
                InventoryEntry.session_id == session_id,
            ),
        )
        .filter(
            Item.warehouse_id == int(meta_row.warehouse_id),
            Item.is_active.is_(True),
        )
        .order_by(Item.product_code.asc(), Item.name.asc(), Item.id.asc())
        .all()
    )

    prepared_rows = [
        SessionCatalogExportRow(
            item_id=int(row.item_id),
            product_code=(str(row.product_code) if row.product_code else ""),
            name=str(row.item_name or ""),
            unit=str(row.unit or ""),
            qty=(None if row.qty is None else Decimal(str(row.qty))),
        )
        for row in rows
    ]

    return meta, prepared_rows
