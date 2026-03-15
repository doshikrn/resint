"""Middleware that blocks write requests during maintenance mode (database restore)."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# ── Maintenance mode flag (in-memory, single-process) ──────────
_maintenance_mode = False


def is_maintenance_mode() -> bool:
    return _maintenance_mode


def set_maintenance_mode(value: bool) -> None:
    global _maintenance_mode
    _maintenance_mode = value


# Paths that are always allowed even during maintenance
_EXEMPT_PREFIXES = (
    "/health",
    "/live",
    "/ready",
    "/admin/backups",
)

_READ_METHODS = {"GET", "HEAD", "OPTIONS"}


class MaintenanceMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if is_maintenance_mode():
            path = request.url.path

            # Always allow exempt paths
            if any(path.startswith(p) for p in _EXEMPT_PREFIXES):
                return await call_next(request)

            # Block all write operations
            if request.method not in _READ_METHODS:
                return JSONResponse(
                    status_code=503,
                    content={
                        "error": {
                            "code": "MAINTENANCE_MODE",
                            "message": "System is under maintenance. Please try again later.",
                        }
                    },
                )

        return await call_next(request)
