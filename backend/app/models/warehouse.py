from sqlalchemy import Boolean, Integer, String, ForeignKey, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base


class Warehouse(Base):
    
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    items = relationship("Item", back_populates="warehouse")
    zone = relationship("Zone", back_populates="warehouses")


