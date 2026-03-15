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

username = "testuser"
password = "password"

session = SessionLocal()
try:
    existing = session.query(User).filter(User.username == username).first()
    if existing:
        print(f"User '{username}' already exists (id={existing.id})")
    else:
        u = User(
            username=username, password_hash=hash_password(password), role="chef", is_active=True
        )
        session.add(u)
        session.commit()
        print(f"Created user '{username}' with id={u.id}")
finally:
    session.close()
