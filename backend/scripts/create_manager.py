"""
create_manager.py — Bootstrap the first manager user.

Usage
-----
    python backend/scripts/create_manager.py

Idempotent: if the user already exists the script exits with code 0.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the backend package importable when run as a standalone script.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Importing app.db.base registers ALL ORM models with Base.metadata so that
# SQLAlchemy resolves every foreign-key relationship before the session opens.
import app.db.base  # noqa: F401
from app.core.roles import ROLE_MANAGER
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User

USERNAME = "manager"
PASSWORD = "123456"
FULL_NAME = "Manager"


def main() -> int:
    session = SessionLocal()
    try:
        existing = session.query(User).filter(User.username == USERNAME).first()
        if existing:
            print("manager user already exists")
            return 0

        user = User(
            username=USERNAME,
            full_name=FULL_NAME,
            password_hash=hash_password(PASSWORD),
            role=ROLE_MANAGER,
            is_active=True,
            # nullable FK fields left as None — no warehouse/station assigned yet
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        print("manager user created")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
