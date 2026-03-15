from pydantic import BaseModel, ConfigDict

from app.schemas.zone import ZoneOut


class WarehouseCreate(BaseModel):
    name: str
    zone_id: int


class WarehouseOut(BaseModel):
    id: int
    name: str
    zone_id: int
    is_active: bool = True
    zone: ZoneOut | None = None
    model_config = ConfigDict(from_attributes=True)
