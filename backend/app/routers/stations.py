from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.roles import can_manage_stations
from app.db.session import get_db
from app.models.station import Station
from app.models.user import User
from app.schemas.station import StationCreate, StationDepartment, StationOut, StationPatch

router = APIRouter(prefix="/stations", tags=["stations"])


def _require_station_manage_role(current_user: User) -> None:
    if not can_manage_stations(current_user.role):
        raise HTTPException(status_code=403, detail="Only chef can manage stations")


@router.get("", response_model=list[StationOut])
def list_stations(
    department: StationDepartment | None = None,
    is_active: bool | None = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    query = db.query(Station)
    if department is not None:
        query = query.filter(Station.department == department)
    if is_active is not None:
        query = query.filter(Station.is_active == is_active)
    return query.order_by(Station.sort_order.asc(), Station.name.asc()).all()


@router.post("", response_model=StationOut, status_code=201)
def create_station(
    payload: StationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_station_manage_role(current_user)

    station = Station(
        name=payload.name,
        department=payload.department,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(station)
    db.commit()
    db.refresh(station)
    return station


@router.patch("/{station_id}", response_model=StationOut)
def patch_station(
    station_id: int,
    payload: StationPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_station_manage_role(current_user)

    station = db.query(Station).filter(Station.id == station_id).first()
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(station, field, value)

    db.add(station)
    db.commit()
    db.refresh(station)
    return station
