from __future__ import annotations

from collections import defaultdict
from threading import Lock


_metrics_lock = Lock()
_request_count: dict[tuple[str, str, int], int] = defaultdict(int)
_error_count: dict[tuple[str, str, int], int] = defaultdict(int)
_latency_sum_ms: dict[tuple[str, str], float] = defaultdict(float)
_latency_count: dict[tuple[str, str], int] = defaultdict(int)
_idempotency_replay_count: dict[str, int] = defaultdict(int)
_idempotency_conflict_count: dict[str, int] = defaultdict(int)
_idempotency_cleanup_deleted_total: dict[str, int] = defaultdict(int)


def observe_request(method: str, path: str, status: int, duration_ms: int) -> None:
    method_u = method.upper()
    key_request = (method_u, path, int(status))
    key_latency = (method_u, path)

    with _metrics_lock:
        _request_count[key_request] += 1
        _latency_sum_ms[key_latency] += float(duration_ms)
        _latency_count[key_latency] += 1
        if status >= 400:
            _error_count[key_request] += 1


def observe_idempotency_replay(endpoint: str) -> None:
    with _metrics_lock:
        _idempotency_replay_count[endpoint] += 1


def observe_idempotency_conflict(endpoint: str) -> None:
    with _metrics_lock:
        _idempotency_conflict_count[endpoint] += 1


def observe_idempotency_cleanup(endpoint: str, deleted: int) -> None:
    if deleted <= 0:
        return
    with _metrics_lock:
        _idempotency_cleanup_deleted_total[endpoint] += int(deleted)


def render_prometheus(service_version: str | None = None, build_sha: str | None = None) -> str:
    lines: list[str] = []

    if service_version or build_sha:
        version = service_version or "unknown"
        sha = build_sha or "unknown"
        lines.append("# HELP app_build_info Build and version info")
        lines.append("# TYPE app_build_info gauge")
        lines.append(f'app_build_info{{service_version="{version}",build_sha="{sha}"}} 1')

    lines.append("# HELP app_http_requests_total Total HTTP requests")
    lines.append("# TYPE app_http_requests_total counter")
    with _metrics_lock:
        for (method, path, status), value in sorted(_request_count.items()):
            lines.append(
                f'app_http_requests_total{{method="{method}",path="{path}",status="{status}"}} {value}'
            )

        lines.append("# HELP app_http_errors_total Total HTTP 4xx/5xx responses")
        lines.append("# TYPE app_http_errors_total counter")
        for (method, path, status), value in sorted(_error_count.items()):
            lines.append(
                f'app_http_errors_total{{method="{method}",path="{path}",status="{status}"}} {value}'
            )

        lines.append("# HELP app_http_request_duration_ms_sum Total request duration in milliseconds")
        lines.append("# TYPE app_http_request_duration_ms_sum counter")
        for (method, path), value in sorted(_latency_sum_ms.items()):
            lines.append(
                f'app_http_request_duration_ms_sum{{method="{method}",path="{path}"}} {value:.3f}'
            )

        lines.append("# HELP app_http_request_duration_ms_count Request count for latency metric")
        lines.append("# TYPE app_http_request_duration_ms_count counter")
        for (method, path), value in sorted(_latency_count.items()):
            lines.append(
                f'app_http_request_duration_ms_count{{method="{method}",path="{path}"}} {value}'
            )

        lines.append("# HELP app_idempotency_replays_total Total idempotency replay responses")
        lines.append("# TYPE app_idempotency_replays_total counter")
        for endpoint, value in sorted(_idempotency_replay_count.items()):
            lines.append(f'app_idempotency_replays_total{{endpoint="{endpoint}"}} {value}')

        lines.append("# HELP app_idempotency_conflicts_total Total idempotency key payload conflicts")
        lines.append("# TYPE app_idempotency_conflicts_total counter")
        for endpoint, value in sorted(_idempotency_conflict_count.items()):
            lines.append(f'app_idempotency_conflicts_total{{endpoint="{endpoint}"}} {value}')

        lines.append("# HELP app_idempotency_ttl_cleanup_deleted_total Total expired idempotency keys deleted")
        lines.append("# TYPE app_idempotency_ttl_cleanup_deleted_total counter")
        for endpoint, value in sorted(_idempotency_cleanup_deleted_total.items()):
            lines.append(f'app_idempotency_ttl_cleanup_deleted_total{{endpoint="{endpoint}"}} {value}')

    lines.append("")
    return "\n".join(lines)


def reset_metrics() -> None:
    with _metrics_lock:
        _request_count.clear()
        _error_count.clear()
        _latency_sum_ms.clear()
        _latency_count.clear()
        _idempotency_replay_count.clear()
        _idempotency_conflict_count.clear()
        _idempotency_cleanup_deleted_total.clear()
