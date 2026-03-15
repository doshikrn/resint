from enum import Enum

from pydantic import BaseModel, ConfigDict


class StationDepartment(str, Enum):
    kitchen = "kitchen"
    bar = "bar"


class StationCreate(BaseModel):
    name: str
    department: StationDepartment
    is_active: bool = True
    sort_order: int | None = None


class StationPatch(BaseModel):
    name: str | None = None
    department: StationDepartment | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class StationOut(BaseModel):
    id: int
    name: str
    department: StationDepartment
    is_active: bool
    sort_order: int | None
    model_config = ConfigDict(from_attributes=True)
