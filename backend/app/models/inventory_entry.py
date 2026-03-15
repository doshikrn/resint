from datetime import UTC, datetime

from sqlalchemy import (  # + UniqueConstraint
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.core.clock import utc_now as _utc_now


class InventoryEntry(Base):
    __tablename__ = "inventory_entries"
    __table_args__ = (
        UniqueConstraint("session_id", "item_id", name="uq_inventory_entries_session_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    session_id: Mapped[int] = mapped_column(ForeignKey("inventory_sessions.id"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True)

    quantity: Mapped[float] = mapped_column(Numeric(12, 3, asdecimal=False), default=0.0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    counted_outside_zone: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    counted_by_zone_id: Mapped[int | None] = mapped_column(
        ForeignKey("zones.id"), nullable=True, index=True
    )
    station_id: Mapped[int | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True, index=True
    )
    outside_zone_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now)

    session = relationship("InventorySession", back_populates="entries")
    item = relationship("Item")
    counted_by_zone = relationship("Zone")
    station = relationship("Station")
