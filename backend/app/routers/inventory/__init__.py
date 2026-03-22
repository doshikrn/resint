"""
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
