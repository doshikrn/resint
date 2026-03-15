from typing import Final


ROLE_COOK: Final[str] = "cook"
ROLE_SOUSCHEF: Final[str] = "souschef"
ROLE_CHEF: Final[str] = "chef"
ROLE_MANAGER: Final[str] = "manager"
ROLE_ADMIN_LEGACY: Final[str] = "admin"

CANONICAL_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_COOK, ROLE_SOUSCHEF, ROLE_CHEF, ROLE_MANAGER}
)

# ── Permission sets ──────────────────────────────────────────
# User management: only manager
USER_MANAGE_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_MANAGER, ROLE_ADMIN_LEGACY}
)
# Station management: chef, manager
STATION_MANAGE_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_CHEF, ROLE_MANAGER, ROLE_ADMIN_LEGACY}
)
# Revision lifecycle (start/close/reopen/delete/edit closed): souschef, chef, manager
REVISION_MANAGE_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_SOUSCHEF, ROLE_CHEF, ROLE_MANAGER, ROLE_ADMIN_LEGACY}
)
# Catalog (items) management: souschef, chef, manager
CATALOG_MANAGE_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_SOUSCHEF, ROLE_CHEF, ROLE_MANAGER, ROLE_ADMIN_LEGACY}
)
# Export access (own warehouse): souschef, chef, manager
EXPORT_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_SOUSCHEF, ROLE_CHEF, ROLE_MANAGER, ROLE_ADMIN_LEGACY}
)
# Audit view: souschef, chef, manager
AUDIT_VIEW_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_SOUSCHEF, ROLE_CHEF, ROLE_MANAGER, ROLE_ADMIN_LEGACY}
)
# All-warehouse (cross-warehouse) access: only manager
ALL_WAREHOUSE_ROLES: Final[frozenset[str]] = frozenset(
    {ROLE_MANAGER, ROLE_ADMIN_LEGACY}
)

DEFAULT_ROLE: Final[str] = ROLE_COOK

ROLE_LABELS_RU: Final[dict[str, str]] = {
    ROLE_COOK: "Повар",
    ROLE_SOUSCHEF: "Су-шеф",
    ROLE_CHEF: "Шеф-повар",
    ROLE_MANAGER: "Управляющий",
    ROLE_ADMIN_LEGACY: "Шеф-повар",
}

# ── Legacy aliases (kept for existing imports) ───────────────
MANAGER_ROLES = USER_MANAGE_ROLES
REVISION_MANAGER_ROLES = REVISION_MANAGE_ROLES
CATALOG_MANAGER_ROLES = CATALOG_MANAGE_ROLES


def normalize_role(value: str) -> str:
    return value.strip().lower()


# ── Permission helpers ───────────────────────────────────────
def can_manage_users(role: str) -> bool:
    """manager only."""
    return normalize_role(role) in USER_MANAGE_ROLES


def can_manage_stations(role: str) -> bool:
    """chef / manager."""
    return normalize_role(role) in STATION_MANAGE_ROLES


def can_manage_revision(role: str) -> bool:
    """souschef / chef / manager."""
    return normalize_role(role) in REVISION_MANAGE_ROLES


def can_manage_catalog(role: str) -> bool:
    """souschef / chef / manager."""
    return normalize_role(role) in CATALOG_MANAGE_ROLES


def can_export(role: str) -> bool:
    """souschef / chef / manager."""
    return normalize_role(role) in EXPORT_ROLES


def can_view_audit(role: str) -> bool:
    """souschef / chef / manager."""
    return normalize_role(role) in AUDIT_VIEW_ROLES


def can_access_all_warehouses(role: str) -> bool:
    """manager only."""
    return normalize_role(role) in ALL_WAREHOUSE_ROLES


# Legacy alias
def is_manager_role(role: str) -> bool:
    return can_manage_users(role)


def resolve_registration_role(role: str | None) -> str:
    if role is None:
        return DEFAULT_ROLE

    normalized = normalize_role(role)
    if normalized in CANONICAL_ROLES:
        return normalized

    raise ValueError("Role must be one of: cook, souschef, chef, manager")


def role_label_ru(role: str) -> str:
    normalized = normalize_role(role)
    return ROLE_LABELS_RU.get(normalized, normalized)
