"""Shared micro-utilities used across all inventory helper modules."""

from fastapi import HTTPException


def _raise_api_error(status_code: int, code: str, message: str, details=None) -> None:
    payload = {"code": code, "message": message}
    if details is not None:
        payload["details"] = details
    raise HTTPException(status_code=status_code, detail=payload)
