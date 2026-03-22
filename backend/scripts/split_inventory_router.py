"""
One-time script to split the monolithic routers/inventory.py (3297 lines)
into a Python package with domain-focused modules.

Structure after split:
  routers/inventory/
    __init__.py          — combines sub-routers, re-exports `router`
    _helpers.py          — all private helper functions (shared across modules)
    sessions.py          — session CRUD + lifecycle (create/close/reopen/delete/list)
    entries.py           — entry CRUD + idempotency
    audit.py             — audit/event viewing endpoints
    progress.py          — zone progress tracking
    reports.py           — reports, diff, exports, participants

Usage:
    python scripts/split_inventory_router.py
"""

import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "app", "routers", "inventory.py")
PKG = os.path.join(BASE, "app", "routers", "inventory")


def read_source():
    with open(SRC, encoding="utf-8") as f:
        return f.readlines()


# ------------ categorize each function by the line it starts on ----------------

# Route handler → module mapping
ROUTE_TO_MODULE = {
    # sessions.py
    "list_sessions": "sessions",
    "get_session_events": "sessions",
    "create_session": "sessions",
    "get_session": "sessions",
    "get_session_catalog": "sessions",
    "get_entries_snapshot": "sessions",
    "close_session": "sessions",
    "reopen_session": "sessions",
    "soft_delete_session": "sessions",
    "get_or_create_active_session": "sessions",
    # entries.py
    "get_session_entries": "entries",
    "add_or_update_entry": "entries",
    "patch_entry": "entries",
    "delete_entry": "entries",
    "recent_entries": "entries",
    "recent_entry_events": "entries",
    # audit.py
    "session_audit": "audit",
    "entry_audit": "audit",
    "session_audit_log": "audit",
    "verify_audit_log": "audit",
    "audit_events": "audit",
    # progress.py
    "get_session_progress": "progress",
    "complete_zone": "progress",
    "get_progress": "progress",
    # reports.py
    "session_report": "reports",
    "session_item_contributors": "reports",
    "session_participants_summary": "reports",
    "export_session_report": "reports",
    "inventory_diff_report": "reports",
    "inventory_diff_today_report": "reports",
}


def find_function_ranges(lines):
    """Find start/end lines for each top-level def (0-indexed)."""
    ranges = []
    i = 0
    n = len(lines)
    while i < n:
        # Match top-level def or @router. decorator
        line = lines[i]
        if line.startswith("def ") or line.startswith("@router."):
            # Find the function name
            start = i
            # If decorator, skip to the def
            while i < n and not lines[i].startswith("def "):
                i += 1
            if i >= n:
                break
            m = re.match(r"def\s+(\w+)\s*\(", lines[i])
            if not m:
                i += 1
                continue
            fname = m.group(1)
            # Find end: next top-level def or decorator or EOF
            i += 1
            while i < n:
                if (lines[i].startswith("def ") or lines[i].startswith("@router.")) and not lines[i].startswith("    "):
                    break
                i += 1
            # Trim trailing blank lines from the end
            end = i
            ranges.append((fname, start, end))
        else:
            i += 1
    return ranges


def classify_helpers_and_routes(ranges):
    helpers = []
    routes = {}  # module -> [(fname, start, end)]
    for fname, start, end in ranges:
        if fname.startswith("_"):
            helpers.append((fname, start, end))
        else:
            module = ROUTE_TO_MODULE.get(fname, "sessions")
            routes.setdefault(module, []).append((fname, start, end))
    return helpers, routes


def figure_out_imports(lines, func_lines, all_helper_names):
    """Given the lines of a function, figure out which helpers it calls."""
    used = set()
    text = "".join(func_lines)
    for name in all_helper_names:
        if name in text:
            used.add(name)
    return used


def build_module_imports(module_name, helper_names_used, has_routes=True):
    """Build the import block for a sub-module."""
    parts = []
    parts.append("import hashlib")
    parts.append("import json")
    parts.append("import logging")
    parts.append("from datetime import date, datetime, time, timedelta, timezone")
    parts.append("from decimal import ROUND_HALF_UP, Decimal")
    parts.append("from email.utils import format_datetime, parsedate_to_datetime")
    parts.append("")
    parts.append("from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response")
    parts.append("from fastapi.encoders import jsonable_encoder")
    parts.append("from fastapi.responses import JSONResponse, StreamingResponse")
    parts.append("from sqlalchemy import func, inspect")
    parts.append("from sqlalchemy.exc import IntegrityError")
    parts.append("from sqlalchemy.orm import Session, joinedload")
    parts.append("")
    parts.append("from app.core.config import settings")
    parts.append("from app.core.deps import get_current_user")
    parts.append("from app.core.clock import utc_now as _utc_now")
    parts.append("from app.core.metrics import (")
    parts.append("    observe_idempotency_cleanup,")
    parts.append("    observe_idempotency_conflict,")
    parts.append("    observe_idempotency_replay,")
    parts.append(")")
    parts.append("from app.core.roles import (")
    parts.append("    can_access_all_warehouses,")
    parts.append("    can_export,")
    parts.append("    can_manage_revision,")
    parts.append("    can_view_audit,")
    parts.append(")")
    parts.append("from app.db.session import get_db")
    parts.append("from app.models.audit_log import AuditLog")
    parts.append("from app.models.enums import (")
    parts.append("    AuditAction,")
    parts.append("    EntryAction,")
    parts.append("    SessionEventAction,")
    parts.append("    SessionStatus,")
    parts.append(")")
    parts.append("from app.models.idempotency_key import IdempotencyKey")
    parts.append("from app.models.inventory_entry import InventoryEntry")
    parts.append("from app.models.inventory_entry_event import InventoryEntryEvent")
    parts.append("from app.models.inventory_session import InventorySession")
    parts.append("from app.models.inventory_session_event import InventorySessionEvent")
    parts.append("from app.models.inventory_session_total import InventorySessionTotal")
    parts.append("from app.models.inventory_zone_progress import InventoryZoneProgress")
    parts.append("from app.models.item import Item")
    parts.append("from app.models.item_alias import ItemAlias")
    parts.append("from app.models.item_usage_stat import ItemUsageStat")
    parts.append("from app.models.station import Station, StationDepartment")
    parts.append("from app.models.user import User")
    parts.append("from app.models.warehouse import Warehouse")
    parts.append("from app.models.zone import Zone")
    parts.append("from app.schemas.inventory import (")
    parts.append("    ActiveSessionRequest,")
    parts.append("    AuditLogOut,")
    parts.append("    InventoryAddEntry,")
    parts.append("    InventoryCatalogItemOut,")
    parts.append("    InventoryDiffReportOut,")
    parts.append("    InventoryEntryEventOut,")
    parts.append("    InventoryEntryOut,")
    parts.append("    InventoryEntryPatch,")
    parts.append("    InventoryEntrySnapshotOut,")
    parts.append("    InventoryItemContributorsOut,")
    parts.append("    InventoryParticipantsSummaryOut,")
    parts.append("    InventoryRecentEventOut,")
    parts.append("    InventorySessionCreate,")
    parts.append("    InventorySessionEventOut,")
    parts.append("    InventorySessionListItemOut,")
    parts.append("    InventorySessionOut,")
    parts.append("    InventorySessionProgressOut,")
    parts.append("    InventorySessionReportOut,")
    parts.append("    InventoryZoneProgressOut,")
    parts.append(")")
    parts.append("from app.services.audit import log_audit, verify_audit_chain")
    parts.append("from app.services.export import (")
    parts.append("    build_csv_export,")
    parts.append("    build_export_filename,")
    parts.append("    build_xlsx_accounting_template_export,")
    parts.append(")")
    parts.append("from app.services.export_repository import (")
    parts.append("    fetch_session_catalog_export_rows,")
    parts.append("    fetch_session_export_rows,")
    parts.append(")")
    parts.append("")
    if helper_names_used:
        items = sorted(helper_names_used)
        parts.append("from app.routers.inventory._helpers import (")
        for item in items:
            parts.append(f"    {item},")
        parts.append(")")
        parts.append("")
    if has_routes:
        parts.append(f'router = APIRouter()')
        parts.append("")
        parts.append('log = logging.getLogger("app")')
        parts.append("")
    return "\n".join(parts)


def main():
    lines = read_source()

    # Parse all function ranges
    ranges = find_function_ranges(lines)
    helpers, routes = classify_helpers_and_routes(ranges)

    all_helper_names = [name for name, _, _ in helpers]

    # Create package directory
    os.makedirs(PKG, exist_ok=True)

    # --- Write _helpers.py ---
    helper_lines = []
    # Imports for helpers
    helper_lines.append("import hashlib\n")
    helper_lines.append("import json\n")
    helper_lines.append("import logging\n")
    helper_lines.append("from datetime import date, datetime, time, timedelta, timezone\n")
    helper_lines.append("from decimal import ROUND_HALF_UP, Decimal\n")
    helper_lines.append("from email.utils import format_datetime, parsedate_to_datetime\n")
    helper_lines.append("\n")
    helper_lines.append("from fastapi import HTTPException\n")
    helper_lines.append("from sqlalchemy import func, inspect\n")
    helper_lines.append("from sqlalchemy.exc import IntegrityError\n")
    helper_lines.append("from sqlalchemy.orm import Session\n")
    helper_lines.append("\n")
    helper_lines.append("from app.core.config import settings\n")
    helper_lines.append("from app.core.clock import utc_now as _utc_now\n")
    helper_lines.append("from app.core.metrics import (\n")
    helper_lines.append("    observe_idempotency_cleanup,\n")
    helper_lines.append("    observe_idempotency_conflict,\n")
    helper_lines.append("    observe_idempotency_replay,\n")
    helper_lines.append(")\n")
    helper_lines.append("from app.core.roles import (\n")
    helper_lines.append("    can_access_all_warehouses,\n")
    helper_lines.append("    can_export,\n")
    helper_lines.append("    can_manage_revision,\n")
    helper_lines.append("    can_view_audit,\n")
    helper_lines.append(")\n")
    helper_lines.append("from app.models.enums import (\n")
    helper_lines.append("    AuditAction,\n")
    helper_lines.append("    EntryAction,\n")
    helper_lines.append("    SessionEventAction,\n")
    helper_lines.append("    SessionStatus,\n")
    helper_lines.append(")\n")
    helper_lines.append("from app.models.idempotency_key import IdempotencyKey\n")
    helper_lines.append("from app.models.inventory_entry import InventoryEntry\n")
    helper_lines.append("from app.models.inventory_entry_event import InventoryEntryEvent\n")
    helper_lines.append("from app.models.inventory_session import InventorySession\n")
    helper_lines.append("from app.models.inventory_session_event import InventorySessionEvent\n")
    helper_lines.append("from app.models.inventory_session_total import InventorySessionTotal\n")
    helper_lines.append("from app.models.inventory_zone_progress import InventoryZoneProgress\n")
    helper_lines.append("from app.models.item import Item\n")
    helper_lines.append("from app.models.item_usage_stat import ItemUsageStat\n")
    helper_lines.append("from app.models.station import Station, StationDepartment\n")
    helper_lines.append("from app.models.user import User\n")
    helper_lines.append("from app.models.warehouse import Warehouse\n")
    helper_lines.append("from app.models.zone import Zone\n")
    helper_lines.append("\n")
    helper_lines.append('log = logging.getLogger("app")\n')
    helper_lines.append("\n")

    # Add all helper functions
    for fname, start, end in helpers:
        helper_lines.append("\n")
        for i in range(start, end):
            helper_lines.append(lines[i])

    with open(os.path.join(PKG, "_helpers.py"), "w", encoding="utf-8") as f:
        f.writelines(helper_lines)
    print(f"  _helpers.py: {len(helper_lines)} lines, {len(helpers)} functions")

    # --- Write each route module ---
    for module_name, funcs in routes.items():
        # Figure out which helpers each route function uses
        used_helpers = set()
        for fname, start, end in funcs:
            func_text = "".join(lines[start:end])
            for hname in all_helper_names:
                if hname in func_text:
                    used_helpers.add(hname)

        module_lines = []
        # Full imports + helper imports
        header = build_module_imports(module_name, used_helpers)
        module_lines.append(header)
        module_lines.append("\n")

        # Add route functions
        for fname, start, end in funcs:
            module_lines.append("\n")
            for i in range(start, end):
                module_lines.append(lines[i])

        filepath = os.path.join(PKG, f"{module_name}.py")
        with open(filepath, "w", encoding="utf-8") as f:
            f.writelines(module_lines)
        line_count = len(module_lines)
        print(f"  {module_name}.py: ~{line_count} lines, {len(funcs)} routes")

    # --- Write __init__.py ---
    init_content = '''"""
Inventory router package.

Split from monolithic inventory.py for maintainability.
Sub-modules are organized by domain concern.
"""
from fastapi import APIRouter

from app.routers.inventory.sessions import router as sessions_router
from app.routers.inventory.entries import router as entries_router
from app.routers.inventory.audit import router as audit_router
from app.routers.inventory.progress import router as progress_router
from app.routers.inventory.reports import router as reports_router

router = APIRouter(prefix="/inventory", tags=["inventory"])
router.include_router(sessions_router)
router.include_router(entries_router)
router.include_router(audit_router)
router.include_router(progress_router)
router.include_router(reports_router)
'''

    with open(os.path.join(PKG, "__init__.py"), "w", encoding="utf-8") as f:
        f.write(init_content)
    print("  __init__.py written")

    # --- Summary ---
    print(f"\nSplit complete. Original: {len(lines)} lines")
    print(f"Helpers: {len(helpers)} functions")
    for module_name, funcs in routes.items():
        print(f"  {module_name}: {len(funcs)} routes")


if __name__ == "__main__":
    main()
