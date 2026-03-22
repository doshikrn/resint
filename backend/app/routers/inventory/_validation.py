"""Input validation and normalization helpers for the inventory router."""

from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException

from app.models.item import Item

from app.routers.inventory._common import _raise_api_error


def _normalize_qty_for_api(
    value: float | Decimal | None, unit: str | None = None, max_decimals: int = 3
) -> float:
    if value is None:
        return 0.0

    normalized_unit = (unit or "").strip().lower()
    decimals = 0 if normalized_unit in {"pcs", "шт"} else max_decimals
    quantum = Decimal("1") if decimals == 0 else Decimal("1").scaleb(-decimals)

    try:
        decimal_value = Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP)
    except Exception:
        decimal_value = Decimal("0")

    text = format(decimal_value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in {"", "-0"}:
        text = "0"
    return float(text)


def _normalize_reason(reason: str | None) -> str | None:
    if reason is None:
        return None
    value = reason.strip()
    return value or None


def _normalize_outside_zone_note(note: str | None) -> str | None:
    if note is None:
        return None
    value = note.strip()
    return value or None


def _is_step_aligned(quantity: float, step: float) -> bool:
    q = Decimal(str(quantity))
    s = Decimal(str(step))
    if s <= 0:
        return False
    return (q % s) == 0


def _validate_item_quantity(item: Item, quantity: float) -> None:
    min_qty_floor = 0.01
    if quantity <= min_qty_floor:
        _raise_api_error(422, "VALIDATION_ERROR", "Quantity must be greater than 0.01")
    unit = (item.unit or "").strip().lower()
    if unit not in ("kg", "l") and not _is_step_aligned(quantity, float(item.step)):
        _raise_api_error(
            422, "VALIDATION_STEP_MISMATCH", f"Quantity must match step {item.step}"
        )
    if item.min_qty is not None and quantity < float(item.min_qty):
        _raise_api_error(422, "VALIDATION_ERROR", f"Quantity must be >= {item.min_qty}")
    if item.max_qty is not None and quantity > float(item.max_qty):
        _raise_api_error(422, "VALIDATION_ERROR", f"Quantity must be <= {item.max_qty}")


def _parse_if_match_version(raw_if_match: str | None) -> int | None:
    if raw_if_match is None:
        return None
    value = raw_if_match.strip()
    if not value:
        return None
    if value.startswith("W/"):
        value = value[2:]
    value = value.strip().strip('"')
    try:
        parsed = int(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail="If-Match must contain an integer version"
        ) from exc
    if parsed < 1:
        raise HTTPException(status_code=422, detail="If-Match version must be >= 1")
    return parsed


def _normalize_etag(raw: str) -> str:
    value = raw.strip()
    if value.startswith("W/"):
        value = value[2:].strip()
    if value.startswith('"') and value.endswith('"') and len(value) >= 2:
        value = value[1:-1]
    return value
