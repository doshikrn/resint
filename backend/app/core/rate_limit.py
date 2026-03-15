from __future__ import annotations

from collections import defaultdict, deque
import json
from threading import Lock
from time import monotonic

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


_LOGIN_FAIL_LIMIT = 5
_LOGIN_FAIL_WINDOW_SEC = 5 * 60
_SEARCH_LIMIT = 120
_SEARCH_WINDOW_SEC = 60


class InMemoryRateState:
    def __init__(self) -> None:
        self._events: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def add_event(self, bucket: str, key: str, window_sec: int, at: float | None = None) -> None:
        now = monotonic() if at is None else at
        store_key = (bucket, key)
        with self._lock:
            hits = self._events[store_key]
            while hits and (now - hits[0]) > window_sec:
                hits.popleft()
            hits.append(now)

    def is_blocked(self, bucket: str, key: str, limit: int, window_sec: int, at: float | None = None) -> tuple[bool, int]:
        now = monotonic() if at is None else at
        store_key = (bucket, key)
        with self._lock:
            hits = self._events[store_key]
            while hits and (now - hits[0]) > window_sec:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, int(window_sec - (now - hits[0])))
                return True, retry_after
            return False, 0

    def check_and_add(self, bucket: str, key: str, limit: int, window_sec: int, at: float | None = None) -> tuple[bool, int]:
        now = monotonic() if at is None else at
        store_key = (bucket, key)
        with self._lock:
            hits = self._events[store_key]
            while hits and (now - hits[0]) > window_sec:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, int(window_sec - (now - hits[0])))
                return False, retry_after
            hits.append(now)
            return True, 0

    def clear_bucket_key(self, bucket: str, key: str) -> None:
        store_key = (bucket, key)
        with self._lock:
            self._events.pop(store_key, None)

    def reset_all(self) -> None:
        with self._lock:
            self._events.clear()


_rate_state = InMemoryRateState()


def reset_rate_limits_for_tests() -> None:
    _rate_state.reset_all()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _login_username(request_body: bytes) -> str:
    try:
        payload = json.loads(request_body.decode("utf-8"))
    except Exception:
        return "<invalid>"
    username = str(payload.get("username", "")).strip().lower()
    return username or "<empty>"


def _restore_request_body(request: Request, body: bytes) -> None:
    async def receive() -> dict:
        return {"type": "http.request", "body": body, "more_body": False}

    request._receive = receive


def _rate_limited_response(code: str, message: str, retry_after_sec: int) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": {"retry_after_sec": retry_after_sec},
            }
        },
        headers={"Retry-After": str(retry_after_sec)},
    )


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method.upper()

        if path == "/items/search" and method == "GET":
            ip = _client_ip(request)
            allowed, retry_after = _rate_state.check_and_add(
                bucket="search_ip",
                key=ip,
                limit=_SEARCH_LIMIT,
                window_sec=_SEARCH_WINDOW_SEC,
            )
            if not allowed:
                return _rate_limited_response(
                    code="SEARCH_RATE_LIMIT_EXCEEDED",
                    message="Too many search requests",
                    retry_after_sec=retry_after,
                )

            return await call_next(request)

        if path == "/auth/login" and method == "POST":
            ip = _client_ip(request)
            body = await request.body()
            _restore_request_body(request, body)
            username = _login_username(body)
            key = f"{ip}|{username}"

            blocked, retry_after = _rate_state.is_blocked(
                bucket="login_fail_ip_user",
                key=key,
                limit=_LOGIN_FAIL_LIMIT,
                window_sec=_LOGIN_FAIL_WINDOW_SEC,
            )
            if blocked:
                return _rate_limited_response(
                    code="AUTH_RATE_LIMIT_EXCEEDED",
                    message="Too many login attempts",
                    retry_after_sec=retry_after,
                )

            response = await call_next(request)
            if response.status_code == 401:
                _rate_state.add_event(
                    bucket="login_fail_ip_user",
                    key=key,
                    window_sec=_LOGIN_FAIL_WINDOW_SEC,
                )
            elif response.status_code < 400:
                _rate_state.clear_bucket_key("login_fail_ip_user", key)

            return response

        return await call_next(request)
