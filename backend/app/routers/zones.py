from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.roles import can_manage_users
from app.db.session import get_db
from app.schemas.zone import ZoneCreate, ZoneOut
from app.models.zone import Zone

router = APIRouter(prefix="/zones", tags=["zones"])


@router.get("", response_model=list[ZoneOut])
def list_zones(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(Zone).order_by(Zone.name.asc()).all()


@router.post("", response_model=ZoneOut, status_code=201)
def create_zone(payload: ZoneCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    if not can_manage_users(current_user.role):
        raise HTTPException(status_code=403, detail="Only managers can create zones")
    exists = db.query(Zone).filter(Zone.name == payload.name).first()
    if exists:
        raise HTTPException(status_code=409, detail="Zone with this name already exists")

    zone = Zone(name=payload.name, description=payload.description)
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone