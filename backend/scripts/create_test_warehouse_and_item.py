import os
from pathlib import Path
import sys

if os.environ.get("APP_ENV", "development") == "production":
    print("ERROR: test scripts are disabled in production (APP_ENV=production)")
    sys.exit(1)

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.models.warehouse import Warehouse
from app.models.item import Item

session = SessionLocal()
try:
    wh = session.query(Warehouse).filter(Warehouse.name == 'Test Warehouse').first()
    if not wh:
        wh = Warehouse(name='Test Warehouse')
        session.add(wh)
        session.commit()
        session.refresh(wh)
        print(f"Created warehouse id={wh.id}")
    else:
        print(f"Warehouse exists id={wh.id}")

    item = session.query(Item).filter(Item.name == 'Test Item', Item.warehouse_id == wh.id).first()
    if not item:
        item = Item(name='Test Item', unit='pcs', is_active=True, warehouse_id=wh.id)
        session.add(item)
        session.commit()
        session.refresh(item)
        print(f"Created item id={item.id}")
    else:
        print(f"Item exists id={item.id}")
finally:
    session.close()
