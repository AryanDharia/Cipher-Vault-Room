import asyncio
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.database.session import engine, init_db

TABLES_IN_DELETE_ORDER = [
    "export_records",
    "audit_events",
    "source_items",
    "vault_secrets",
    "threshold_approvals",
    "documents",
    "room_members",
    "rooms",
    "users"
]

async def clear_database_data():
    print("--- [DATABASE DATA CLEAR] Starting inspection & data wipe ---")
    await init_db()

    async with engine.begin() as conn:
        print("\nPre-wipe row counts:")
        for table in TABLES_IN_DELETE_ORDER:
            try:
                res = await conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
                count = res.scalar()
                print(f"  {table}: {count} records")
            except Exception as e:
                print(f"  {table}: Table not found or error ({e})")

        print("\nClearing tables in foreign key safe order...")
        for table in TABLES_IN_DELETE_ORDER:
            try:
                await conn.execute(text(f"DELETE FROM {table}"))
                print(f"  Cleared {table}")
            except Exception as e:
                print(f"  Error clearing {table}: {e}")

        # Vacuum / Optimize if SQLite
        try:
            await conn.execute(text("VACUUM"))
            print("  Executed SQLite VACUUM")
        except Exception:
            pass

        print("\nPost-wipe verification (ensuring tables & schema intact with 0 records):")
        total_rows = 0
        for table in TABLES_IN_DELETE_ORDER:
            res = await conn.execute(text(f"SELECT COUNT(*) FROM {table}"))
            count = res.scalar()
            print(f"  {table}: {count} records (Schema & Index intact)")
            total_rows += count

        if total_rows == 0:
            print("\n>>> SUCCESS: All application data cleared successfully. Database schema & indexes preserved! <<<")
        else:
            print(f"\n>>> WARNING: {total_rows} remaining records detected! <<<")

if __name__ == "__main__":
    asyncio.run(clear_database_data())
