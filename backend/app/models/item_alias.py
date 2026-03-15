from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class ItemAlias(Base):
    __tablename__ = "item_aliases"
    __table_args__ = (
        UniqueConstraint("item_id", "alias_text", name="uq_item_aliases_item_alias"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"), index=True, nullable=False)
    alias_text: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
