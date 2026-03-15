from sqlalchemy import create_engine
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

_connect_args: dict = {}
try:
    _url = make_url(settings.database_url)
    if _url.get_backend_name() == "postgresql":
        _connect_args = {"connect_timeout": 3}
except Exception:
    _connect_args = {}

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    **({"connect_args": _connect_args} if _connect_args else {}),
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
