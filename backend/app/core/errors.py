import logging

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings

log = logging.getLogger("app")


def _is_expected_http_404(request: Request, status_code: int, detail) -> bool:
    if status_code != 404:
        return False
    if request.method != "POST" or request.url.path != "/inventory/sessions/active":
        return False
    if isinstance(detail, str):
        return detail == "Active session not found"
    if isinstance(detail, dict):
        return detail.get("message") == "Active session not found"
    return False


def _request_ctx(request: Request) -> dict:
    return {
        "request_id": getattr(request.state, "request_id", request.headers.get("x-request-id")),
        "user_id": getattr(request.state, "user_id", None),
        "role": getattr(request.state, "role", None),
        "method": request.method,
        "path": request.url.path,
    }


def _err(code: str, message: str, status_code: int, details=None):
    payload = {"error": {"code": code, "message": message}}
    if details is not None:
        payload["error"]["details"] = details
    return JSONResponse(status_code=status_code, content=jsonable_encoder(payload))


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    expected_404 = _is_expected_http_404(request, exc.status_code, detail)
    if isinstance(detail, dict):
        code = detail.get("code", "HTTP_ERROR")
        message = detail.get("message", "Request error")
        details = detail.get("details")
        ctx = _request_ctx(request)
        if exc.status_code >= 500:
            log_method = log.error
        elif expected_404:
            log_method = log.info
        else:
            log_method = log.warning
        log_method(
            "http_exception",
            extra={
                "event": "http_exception",
                "status": exc.status_code,
                "error_code": code,
                "details": details,
                **ctx,
            },
        )
        return _err(code, message, exc.status_code, details=details)

    message = detail if isinstance(detail, str) else "Request error"
    ctx = _request_ctx(request)
    if exc.status_code >= 500:
        log_method = log.error
    elif expected_404:
        log_method = log.info
    else:
        log_method = log.warning
    log_method(
        "http_exception",
        extra={
            "event": "http_exception",
            "status": exc.status_code,
            "error_code": "HTTP_ERROR",
            "details": detail if not isinstance(detail, str) else None,
            **ctx,
        },
    )
    return _err(
        "HTTP_ERROR",
        message,
        exc.status_code,
        details=detail if not isinstance(detail, str) else None,
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Pydantic ошибки — стабильным форматом + сериализуемый details
    details = []
    for err in exc.errors():
        cleaned = dict(err)
        ctx = cleaned.get("ctx")
        if isinstance(ctx, dict):
            cleaned["ctx"] = {
                key: (str(value) if isinstance(value, Exception) else value)
                for key, value in ctx.items()
            }
        details.append(cleaned)
    log.warning(
        "validation_exception",
        extra={
            "event": "validation_exception",
            "status": 422,
            "error_code": "VALIDATION_ERROR",
            "details": details,
            **_request_ctx(request),
        },
    )
    return _err("VALIDATION_ERROR", "Validation failed", 422, details=details)


def _classify_critical(exc: Exception) -> str:
    """Return a specific error_code for critical/known exception families."""
    from sqlalchemy.exc import OperationalError, InterfaceError, DisconnectionError

    if isinstance(exc, (OperationalError, InterfaceError, DisconnectionError)):
        return "DB_CONNECTION_ERROR"
    from sqlalchemy.exc import SQLAlchemyError
    if isinstance(exc, SQLAlchemyError):
        return "DB_ERROR"
    return "INTERNAL_ERROR"


async def unhandled_exception_handler(request: Request, exc: Exception):
    error_code = _classify_critical(exc)
    log_payload = {
        "event": "unhandled_exception",
        "status": 500,
        "error_code": error_code,
        "exception_type": type(exc).__name__,
        **_request_ctx(request),
    }
    if error_code.startswith("DB_"):
        log.critical("unhandled_exception", extra=log_payload, exc_info=True)
    elif settings.expose_stacktrace:
        log.exception("unhandled_exception", extra=log_payload)
    else:
        log.error("unhandled_exception", extra=log_payload, exc_info=True)
    return _err("INTERNAL_ERROR", "Internal server error", 500)
