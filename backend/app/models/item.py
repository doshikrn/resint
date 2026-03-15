from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    product_code: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    unit: Mapped[str] = mapped_column(String(20))
    step: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    min_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"), index=True)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("item_categories.id"), nullable=True, index=True
    )
    station_id: Mapped[int | None] = mapped_column(
        ForeignKey("stations.id"), nullable=True, index=True
    )
    warehouse = relationship("Warehouse", back_populates="items")
    category = relationship("ItemCategory", back_populates="items")
    station = relationship("Station")
