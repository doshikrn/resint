from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.roles import can_manage_users
from app.db.session import get_db
from app.models.warehouse import Warehouse
from app.models.zone import Zone
from app.schemas.warehouse import WarehouseCreate, WarehouseOut

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


@router.get("", response_model=list[WarehouseOut])
def list_warehouses(
    zone_id: int | None = None, db: Session = Depends(get_db), _=Depends(get_current_user)
):
    q = db.query(Warehouse).filter(Warehouse.is_active.is_(True))
    if zone_id is not None:
        q = q.filter(Warehouse.zone_id == zone_id)
    return q.order_by(Warehouse.name.asc()).all()


@router.post("", response_model=WarehouseOut)
def create_warehouse(
    payload: WarehouseCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)
):
    if not can_manage_users(current_user.role):
        raise HTTPException(status_code=403, detail="Only managers can create warehouses")
    exists = db.query(Warehouse).filter(Warehouse.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=400, detail="Warehouse already exists")

    zone = db.query(Zone).filter(Zone.id == payload.zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    wh = Warehouse(name=payload.name, zone_id=payload.zone_id)
    db.add(wh)
    db.commit()
    db.refresh(wh)
    return wh
