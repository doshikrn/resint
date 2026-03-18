from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.core.clock import utc_now as _utc_now
from app.models.enums import SessionStatus


class InventorySession(Base):
    __tablename__ = "inventory_sessions"

    __table_args__ = (
        # Partial unique index to ensure only one active (draft) session per warehouse in Postgres
        Index(
            "uq_inventory_sessions_warehouse_draft",
            "warehouse_id",
            unique=True,
            postgresql_where=text("status='draft'"),
            sqlite_where=text("status='draft'"),
        ),
        # Partial unique: revision_no is unique per warehouse only among
        # non-deleted rows, so soft-deleted numbers can be reused.
        Index(
            "uq_inventory_sessions_revision_no",
            "warehouse_id",
            "revision_no",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    status: Mapped[str] = mapped_column(String(20), default=SessionStatus.DRAFT, index=True)  # draft / closed
    is_closed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    entries = relationship("InventoryEntry", back_populates="session", cascade="all, delete-orphan")
