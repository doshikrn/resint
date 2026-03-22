"""Re-export facade -- keeps ``from app.routers.inventory._helpers import ...``
working across all sub-routers while the real code lives in focused modules.

Modules:
    _common      -- _raise_api_error
    _auth        -- permission guards, warehouse access
    _validation  -- qty normalisation, item validation, etag / version parsing
    _events      -- audit-event builders, user display names, contributors
    _session_ops -- session CRUD, station resolution, snapshots, counters
    _progress    -- zone-progress state machine
    _idempotency -- request hashing, idempotency store, report aggregation
"""

# -- _common ------------------------------------------------------------------
from app.routers.inventory._common import _raise_api_error  # noqa: F401

# -- _auth --------------------------------------------------------------------
from app.routers.inventory._auth import (  # noqa: F401
    _can_edit_closed_revision,
    _is_session_closed,
    _require_access_to_warehouse,
    _require_active_session_owner,
    _require_audit_view_role,
    _require_revision_manage_role,
    _require_user_warehouse_id,
    _require_warehouse_param_access,
    _resolve_user_warehouse_id,
)

# -- _validation --------------------------------------------------------------
from app.routers.inventory._validation import (  # noqa: F401
    _is_step_aligned,
    _normalize_etag,
    _normalize_outside_zone_note,
    _normalize_qty_for_api,
    _normalize_reason,
    _parse_if_match_version,
    _validate_item_quantity,
)

# -- _events ------------------------------------------------------------------
from app.routers.inventory._events import (  # noqa: F401
    _build_entry_contributors_map,
    _build_user_display_name,
    _create_entry_event,
    _create_session_event,
    _event_to_out,
    _recent_event_to_out,
)

# -- _session_ops --------------------------------------------------------------
from app.routers.inventory._session_ops import (  # noqa: F401
    _count_session_entered_items,
    _count_session_entered_items_by_user,
    _create_draft_session,
    _entry_to_out,
    _get_or_create_unknown_station,
    _get_session_or_404,
    _has_table,
    _is_active_session_unique_violation,
    _next_revision_no,
    _resolve_counted_by_zone_id,
    _resolve_station_id,
    _snapshot_session_totals,
    _touch_item_usage_stats,
)

# -- _progress -----------------------------------------------------------------
from app.routers.inventory._progress import (  # noqa: F401
    _ensure_zone_progress,
    _load_zone_progress_snapshot,
    _normalize_zone_progress_state,
    _touch_zone_progress_activity,
    _zone_progress_to_out,
)

# -- _idempotency --------------------------------------------------------------
from app.routers.inventory._idempotency import (  # noqa: F401
    _aggregate_window,
    _build_catalog_etag,
    _build_entries_request_hash,
    _cleanup_expired_idempotency_keys,
    _collect_session_rows,
    _ensure_aware,
    _get_stored_idempotent_response,
)
