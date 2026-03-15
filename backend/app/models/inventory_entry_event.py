from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base

from app.core.clock import utc_now as _utc_now


class InventoryEntryEvent(Base):
    __tablename__ = "inventory_entry_events"

    __table_args__ = (
        Index("ix_entry_events_session_item", "session_id", "item_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_sessions.id"), index=True, nullable=False
    )
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True, nullable=False)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    counted_outside_zone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    counted_by_zone_id: Mapped[int | None] = mapped_column(
        ForeignKey("zones.id"), index=True, nullable=True
    )
    station_id: Mapped[int | None] = mapped_column(
        ForeignKey("stations.id"), index=True, nullable=True
    )
    outside_zone_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    before_quantity: Mapped[float | None] = mapped_column(
        Numeric(12, 3, asdecimal=False), nullable=True
    )
    after_quantity: Mapped[float] = mapped_column(Numeric(12, 3, asdecimal=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now, index=True
    )
