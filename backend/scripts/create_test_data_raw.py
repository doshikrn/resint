import os
import sqlite3
import sys
from pathlib import Path

if os.environ.get("APP_ENV", "development") == "production":
    print("ERROR: test scripts are disabled in production (APP_ENV=production)")
    sys.exit(1)

db_path = Path(__file__).resolve().parents[1] / 'inventory.db'
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Create warehouse if not exists
cur.execute("SELECT id FROM warehouses WHERE name = ?", ("Test Warehouse",))
row = cur.fetchone()
if row:
    warehouse_id = row[0]
    print(f"Warehouse exists id={warehouse_id}")
else:
    cur.execute("INSERT INTO warehouses (name) VALUES (?)", ("Test Warehouse",))
    warehouse_id = cur.lastrowid
    print(f"Created warehouse id={warehouse_id}")

# Create item if not exists
cur.execute("SELECT id FROM items WHERE name = ? AND warehouse_id = ?", ("Test Item", warehouse_id))
row = cur.fetchone()
if row:
    item_id = row[0]
    print(f"Item exists id={item_id}")
else:
    cur.execute("INSERT INTO items (name, unit, is_active, warehouse_id) VALUES (?, ?, ?, ?)", ("Test Item", "pcs", 1, warehouse_id))
    item_id = cur.lastrowid
    print(f"Created item id={item_id}")

conn.commit()
conn.close()
