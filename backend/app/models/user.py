from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.core.roles import DEFAULT_ROLE
from app.db.base_class import Base


class UserDepartment(str, Enum):
    kitchen = "kitchen"
    bar = "bar"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(
        String(30), default=DEFAULT_ROLE
    )  # cook / souschef / chef (+ legacy admin)
    department: Mapped[UserDepartment | None] = mapped_column(
        SAEnum(UserDepartment, name="user_department", native_enum=False),
        nullable=True,
    )
    warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouses.id"), nullable=True, index=True
    )
    default_station_id: Mapped[int | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True, index=True
    )
    default_warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouses.id"), nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    preferred_language: Mapped[str | None] = mapped_column(
        String(5), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
