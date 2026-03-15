from pydantic import BaseModel, ConfigDict, Field


class ZoneBase(BaseModel):
    name: str = Field(..., max_length=120)
    description: str | None = Field(default=None, max_length=255)


class ZoneCreate(ZoneBase):
    pass


class ZoneOut(ZoneBase):
    id: int
    model_config = ConfigDict(from_attributes=True)
