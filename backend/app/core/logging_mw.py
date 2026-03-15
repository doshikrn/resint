import logging
import time
import uuid

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.metrics import observe_request

log = logging.getLogger("app")
SLOW_REQUEST_THRESHOLD_MS = 300


def _is_expected_active_session_not_found(request: Request, response_status: int) -> bool:
    return (
        response_status == 404
        and request.method == "POST"
        and request.url.path == "/inventory/sessions/active"
    )


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id
        start = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            # Ошибка будет обработана handler'ом, но логируем тут с контекстом
            dur_ms = int((time.perf_counter() - start) * 1000)
            route = request.scope.get("route")
            route_path = getattr(route, "path", request.url.path)
            observe_request(request.method, route_path, 500, dur_ms)
            log.exception(
                "unhandled_exception",
                extra={
                    "event": "request_unhandled_exception",
                    "request_id": request_id,
                    "user_id": getattr(request.state, "user_id", None),
                    "role": getattr(request.state, "role", None),
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": dur_ms,
                },
            )
            raise

        dur_ms = int((time.perf_counter() - start) * 1000)
        user_id = getattr(request.state, "user_id", None)
        role = getattr(request.state, "role", None)
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        observe_request(request.method, route_path, response.status_code, dur_ms)

        request_log_payload = {
            "event": "request_finished",
            "request_id": request_id,
            "user_id": user_id,
            "role": role,
            "method": request.method,
            "path": route_path,
            "status": response.status_code,
            "duration_ms": dur_ms,
        }

        if response.status_code >= 500:
            log.error("request_5xx", extra=request_log_payload)
        elif _is_expected_active_session_not_found(request, response.status_code):
            log.info("request", extra=request_log_payload)
        elif response.status_code >= 400:
            log.warning("request_4xx", extra=request_log_payload)
        else:
            log.info("request", extra=request_log_payload)

        if dur_ms > SLOW_REQUEST_THRESHOLD_MS:
            log.warning(
                "slow_request",
                extra={
                    "event": "slow_request",
                    "request_id": request_id,
                    "user_id": user_id,
                    "role": role,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": dur_ms,
                },
            )

        response.headers["x-request-id"] = request_id
        return response
