from __future__ import annotations

import argparse
import csv
import os
import sys
from dataclasses import dataclass
from pathlib import Path

if os.environ.get("APP_ENV", "development") == "production":
    print("ERROR: test/seed scripts are disabled in production (APP_ENV=production)")
    sys.exit(1)

# Ensure backend package root is on sys.path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func

from app.core.security import hash_password
from app.db import base  # noqa: F401  # ensure all models are imported/registered
from app.db.session import SessionLocal
from app.models.station import Station
from app.models.user import User, UserDepartment

ALLOWED_ROLES = {"cook", "souschef", "chef", "admin"}
MANAGER_ROLES = {"souschef", "chef", "admin"}


@dataclass
class Summary:
    created: int = 0
    updated: int = 0
    errors: int = 0


def parse_bool(raw: str | None, default: bool = True) -> bool:
    if raw is None or raw == "":
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "y", "да"}:
        return True
    if value in {"0", "false", "no", "n", "нет"}:
        return False
    raise ValueError(f"invalid boolean value: {raw}")


def normalize_role(raw: str | None) -> str:
    if not raw:
        raise ValueError("role is required")
    value = raw.strip().lower()
    if value not in ALLOWED_ROLES:
        raise ValueError("role must be one of: cook, souschef, chef, admin")
    return value


def resolve_station(session, station_id_raw: str | None, station_name_raw: str | None) -> Station:
    if station_id_raw:
        station_id = int(station_id_raw)
        station = session.query(Station).filter(Station.id == station_id).first()
        if not station:
            raise ValueError(f"station_id={station_id} not found")
        return station

    if not station_name_raw:
        raise ValueError("station_name or station_id is required")

    station_name = station_name_raw.strip()
    station = (
        session.query(Station)
        .filter(func.lower(Station.name) == station_name.lower())
        .order_by(Station.is_active.desc(), Station.id.asc())
        .first()
    )
    if not station:
        raise ValueError(f"station '{station_name}' not found")
    return station


def resolve_department(raw: str | None, station: Station | None) -> UserDepartment | None:
    if raw:
        value = raw.strip().lower()
        if value not in {"kitchen", "bar"}:
            raise ValueError("department must be kitchen or bar")
        if station is not None and value != station.department.value:
            raise ValueError(
                f"department '{value}' does not match station department '{station.department.value}'"
            )
        return UserDepartment(value)

    if station is not None:
        return UserDepartment(station.department.value)

    return None


def resolve_warehouse_id(raw: str | None) -> int | None:
    if raw is None or raw == "":
        return None
    warehouse_id = int(raw)
    if warehouse_id <= 0:
        raise ValueError("default_warehouse_id must be a positive integer")
    return warehouse_id


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Bulk create/update users with roles and station assignments from CSV",
    )
    parser.add_argument(
        "--csv",
        required=True,
        help="Path to CSV file (UTF-8).",
    )
    parser.add_argument(
        "--default-password",
        default=None,
        help="Fallback password for rows where password is empty.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and preview changes without committing.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    csv_path = Path(args.csv)

    if not csv_path.exists():
        print(f"CSV file not found: {csv_path}")
        return 1

    expected_columns = {
        "username",
        "password",
        "role",
        "station_name",
        "station_id",
        "department",
        "default_warehouse_id",
        "is_active",
    }

    summary = Summary()

    session = SessionLocal()
    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                print("CSV has no header row")
                return 1

            header = {name.strip() for name in reader.fieldnames if name}
            missing = expected_columns - header
            if missing:
                print(f"CSV missing columns: {', '.join(sorted(missing))}")
                return 1

            for line_number, row in enumerate(reader, start=2):
                try:
                    username = (row.get("username") or "").strip().lower()
                    if not username:
                        raise ValueError("username is required")

                    full_name = (row.get("full_name") or "").strip() or None

                    role = normalize_role(row.get("role"))
                    station_id_raw = row.get("station_id")
                    station_name_raw = row.get("station_name")
                    has_station_input = bool((station_id_raw or "").strip() or (station_name_raw or "").strip())
                    station = None
                    if has_station_input:
                        station = resolve_station(session, station_id_raw, station_name_raw)
                    elif role not in MANAGER_ROLES:
                        raise ValueError("station_name or station_id is required for cook")

                    department = resolve_department(row.get("department"), station)
                    default_warehouse_id = resolve_warehouse_id(row.get("default_warehouse_id"))
                    is_active = parse_bool(row.get("is_active"), default=True)

                    password = (row.get("password") or "").strip() or (args.default_password or "").strip()

                    user = session.query(User).filter(User.username == username).first()

                    if user is None:
                        if not password:
                            raise ValueError("password is required for new user (or pass --default-password)")
                        user = User(
                            username=username,
                            full_name=full_name,
                            password_hash=hash_password(password),
                            role=role,
                            department=department,
                            default_station_id=station.id if station else None,
                            default_warehouse_id=default_warehouse_id,
                            is_active=is_active,
                        )
                        session.add(user)
                        summary.created += 1
                        station_label = station.name if station else "none"
                        department_label = department.value if department else "none"
                        print(
                            f"line {line_number}: create '{username}' role={role} station={station_label} department={department_label}"
                        )
                        continue

                    user.role = role
                    user.full_name = full_name
                    user.department = department
                    user.default_station_id = station.id if station else None
                    user.default_warehouse_id = default_warehouse_id
                    user.is_active = is_active
                    if password:
                        user.password_hash = hash_password(password)

                    session.add(user)
                    summary.updated += 1
                    station_label = station.name if station else "none"
                    department_label = department.value if department else "none"
                    print(
                        f"line {line_number}: update '{username}' role={role} station={station_label} department={department_label}"
                    )
                except Exception as exc:  # noqa: BLE001
                    summary.errors += 1
                    print(f"line {line_number}: ERROR: {exc}")

        if args.dry_run:
            session.rollback()
            print("\nDry-run complete (no changes committed).")
        else:
            session.commit()
            print("\nChanges committed.")

        print(
            f"Summary: created={summary.created}, updated={summary.updated}, errors={summary.errors}, dry_run={args.dry_run}"
        )

        return 0 if summary.errors == 0 else 2
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
