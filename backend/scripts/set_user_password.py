from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

if os.environ.get("APP_ENV", "development") == "production":
    print("ERROR: test scripts are disabled in production (APP_ENV=production)")
    sys.exit(1)

# Ensure backend package root is on sys.path
sys.path.append(str(Path(__file__).resolve().parents[1]))

import app.db.base  # noqa: F401
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User


def main() -> int:
    parser = argparse.ArgumentParser(description="Set (reset) password for a user")
    parser.add_argument("username", help="Username to update")
    parser.add_argument("password", help="New password to set")
    parser.add_argument("--create", action="store_true", help="Create user if missing")
    parser.add_argument("--role", default="cook", help="Role for created user (default: cook)")
    args = parser.parse_args()

    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == args.username).first()
        if not user:
            if not args.create:
                print(f"User '{args.username}' not found. Use --create to create.")
                return 2
            user = User(
                username=args.username,
                password_hash=hash_password(args.password),
                role=args.role,
                is_active=True,
            )
            session.add(user)
            session.commit()
            session.refresh(user)
            print(f"Created user '{args.username}' (id={user.id}) and set password")
            return 0

        user.password_hash = hash_password(args.password)
        session.add(user)
        session.commit()
        print(f"Updated password for '{args.username}' (id={user.id})")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
