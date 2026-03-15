from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

import logging
from app.core.log_json import configure_json_logging
from app.core.logging_mw import RequestLoggingMiddleware
from app.core.rate_limit import RateLimitMiddleware

from app.core.errors import (
    http_exception_handler,
    validation_exception_handler,
    unhandled_exception_handler,
)
from app.core.config import settings

from app.db.session import engine
from app.db.base import Base

from app.routers.auth import router as auth_router
from app.routers.warehouses import router as warehouses_router
from app.routers.items import router as items_router
from app.routers.inventory import router as inventory_router
from app.routers.zones import router as zones_router
from app.routers.stations import router as stations_router
from app.routers.users import router as users_router
from app.routers.health import router as health_router
from app.routers.admin_backups import router as admin_backups_router

configure_json_logging(logging.INFO)

app = FastAPI(title="Inventory API", version="1.0.0", debug=False)


def _parse_origins(raw: str) -> list[str]:
    values = [value.strip() for value in raw.split(",")]
    return [value for value in values if value]


cors_origins = _parse_origins(settings.cors_allow_origins)
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "If-Match", "x-request-id"],
    )

# Attach middleware
from app.core.maintenance import MaintenanceMiddleware  # noqa: E402
app.add_middleware(MaintenanceMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)

# Register custom exception handlers
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)


app.include_router(auth_router)
app.include_router(warehouses_router)
app.include_router(items_router)
app.include_router(inventory_router)
app.include_router(zones_router)
app.include_router(stations_router)
app.include_router(users_router)
app.include_router(health_router)
app.include_router(admin_backups_router)

def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description="Inventory backend",
        routes=app.routes,
    )

    
    openapi_schema.setdefault("components", {})
    openapi_schema["components"].setdefault("securitySchemes", {})
    openapi_schema["components"]["securitySchemes"]["BearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
    }

    
    openapi_schema["security"] = [{"BearerAuth": []}]

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


@app.get("/")
def root():
    return {"status": "Inventory API is running"}