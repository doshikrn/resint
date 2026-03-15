from sqlalchemy import ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class InventorySessionTotal(Base):
    __tablename__ = "inventory_session_totals"
    __table_args__ = (
        UniqueConstraint("session_id", "item_id", name="uq_inventory_session_totals_session_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("inventory_sessions.id"), index=True, nullable=False
    )
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True, nullable=False)
    qty_final: Mapped[float] = mapped_column(Numeric(12, 3, asdecimal=False), nullable=False)
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
