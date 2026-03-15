import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

UNIT_ALIASES = {
    "kg": "kg",
    "кг": "kg",
    "kilogram": "kg",
    "килограмм": "kg",
    "l": "l",
    "л": "l",
    "liter": "l",
    "литр": "l",
    "pcs": "pcs",
    "pc": "pcs",
    "piece": "pcs",
    "шт": "pcs",
    "штука": "pcs",
    "штук": "pcs",
    "pack": "pack",
    "пачка": "pack",
    "bottle": "bottle",
    "бутылка": "bottle",
}

ALLOWED_UNITS = ("kg", "l", "pcs", "pack", "bottle")
UNIT_LABELS = {
    "kg": "кг",
    "l": "л",
    "pcs": "шт",
    "pack": "пач",
    "bottle": "бут",
}

PRODUCT_CODE_RE = re.compile(r"^\d{5}$")


def validate_item_name(value: str) -> str:
    normalized = value.strip()
    if len(normalized) < 1:
        raise ValueError("Item name cannot be empty")
    return normalized


def normalize_name_for_dedupe(value: str) -> str:
    """Normalize an item name for exact duplicate comparison.

    Strip, lowercase, and collapse multiple whitespace into a single space.
    """
    return re.sub(r"\s+", " ", value.strip()).lower()


def normalize_product_code(value: str | None) -> str | None:
    if value is None or value.strip() == "":
        return None
    normalized = value.strip().upper()
    if not PRODUCT_CODE_RE.fullmatch(normalized):
        raise ValueError("product_code must contain exactly 5 digits")
    return normalized


class ItemCreate(BaseModel):
    product_code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    unit: str = Field(..., min_length=1, max_length=20)
    warehouse_id: int
    step: float = Field(default=1.0, gt=0, lt=100000)
    min_qty: float | None = Field(default=None, ge=0, lt=100000)
    max_qty: float | None = Field(default=None, gt=0, lt=100000)
    is_favorite: bool = False
    category_id: int | None = None
    station_id: int | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return validate_item_name(value)

    @field_validator("product_code")
    @classmethod
    def normalize_product_code_value(cls, value: str | None) -> str | None:
        return normalize_product_code(value)

    @field_validator("unit")
    @classmethod
    def normalize_unit(cls, value: str) -> str:
        normalized = value.strip().lower()
        canonical = UNIT_ALIASES.get(normalized)
        if not canonical:
            raise ValueError(f"Unsupported unit. Allowed: {', '.join(ALLOWED_UNITS)}")
        return canonical

    @model_validator(mode="after")
    def validate_qty_bounds(self):
        if self.min_qty is not None and self.max_qty is not None and self.min_qty > self.max_qty:
            raise ValueError("min_qty cannot be greater than max_qty")
        return self


class ItemOut(BaseModel):
    id: int
    product_code: str | None
    name: str
    unit: str
    step: float
    min_qty: float | None
    max_qty: float | None
    is_favorite: bool
    is_active: bool
    warehouse_id: int
    category_id: int | None
    station_id: int | None
    model_config = ConfigDict(from_attributes=True)


class ItemUnitOut(BaseModel):
    code: str
    label: str


class ItemPatch(BaseModel):
    product_code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    step: float | None = Field(default=None, gt=0, lt=100000)
    min_qty: float | None = Field(default=None, ge=0, lt=100000)
    max_qty: float | None = Field(default=None, gt=0, lt=100000)
    is_active: bool | None = None
    is_favorite: bool | None = None
    category_id: int | None = None
    station_id: int | None = None

    @field_validator("name")
    @classmethod
    def normalize_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return validate_item_name(value)

    @field_validator("product_code")
    @classmethod
    def normalize_optional_product_code(cls, value: str | None) -> str | None:
        if value is None:
            return value
        return normalize_product_code(value)

    @field_validator("unit")
    @classmethod
    def normalize_optional_unit(cls, value: str | None) -> str | None:
        if value is None:
            return value
        normalized = value.strip().lower()
        canonical = UNIT_ALIASES.get(normalized)
        if not canonical:
            raise ValueError(f"Unsupported unit. Allowed: {', '.join(ALLOWED_UNITS)}")
        return canonical

    @model_validator(mode="after")
    def validate_qty_bounds(self):
        if self.min_qty is not None and self.max_qty is not None and self.min_qty > self.max_qty:
            raise ValueError("min_qty cannot be greater than max_qty")
        return self


class ItemAliasCreate(BaseModel):
    alias_text: str = Field(..., min_length=1, max_length=200)

    @field_validator("alias_text")
    @classmethod
    def normalize_alias(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("alias_text cannot be empty")
        return normalized


class ItemAliasOut(BaseModel):
    id: int
    item_id: int
    alias_text: str
    model_config = ConfigDict(from_attributes=True)


class ItemCategoryCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) < 2:
            raise ValueError("Category name must be at least 2 characters")
        return normalized


class ItemCategoryOut(BaseModel):
    id: int
    name: str
    model_config = ConfigDict(from_attributes=True)


class ItemBulkUpsertRow(BaseModel):
    product_code: str | None = Field(default=None, min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    unit: str = Field(..., min_length=1, max_length=20)
    warehouse_id: int | None = None
    station_id: int | None = None
    station_name: str | None = None
    step: float | None = Field(default=None, gt=0, lt=100000)
    min_qty: float | None = Field(default=None, ge=0, lt=100000)
    max_qty: float | None = Field(default=None, gt=0, lt=100000)
    is_active: bool | None = None
    is_favorite: bool | None = None
    category_id: int | None = None
    category_name: str | None = None

    @field_validator("product_code")
    @classmethod
    def normalize_bulk_product_code(cls, value: str | None) -> str | None:
        return normalize_product_code(value)


class ItemsBulkUpsertRequest(BaseModel):
    rows: list[ItemBulkUpsertRow]
    dry_run: bool = True
    default_warehouse_id: int | None = None
