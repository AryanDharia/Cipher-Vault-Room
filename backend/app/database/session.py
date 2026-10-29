from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from sqlalchemy import text
from app.config import settings
from app.database.models import Base

connect_args = {}
pool_kwargs = {}
if "sqlite" in settings.normalized_database_url:
    connect_args = {"timeout": 30}
    pool_kwargs = {"poolclass": NullPool}

# Create async engine
engine = create_async_engine(
    settings.normalized_database_url,
    echo=False,
    future=True,
    connect_args=connect_args,
    **pool_kwargs
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        # Apply schema extensions if table already exists (safe for SQLite and PostgreSQL)
        migration_statements = [
            "ALTER TABLE rooms ADD COLUMN max_members INTEGER DEFAULT 20",
            "ALTER TABLE room_members ADD COLUMN is_kicked BOOLEAN DEFAULT 0",
            "ALTER TABLE source_items ADD COLUMN file_data BLOB"
        ]
        if "postgresql" in settings.normalized_database_url or "postgres" in settings.normalized_database_url:
            migration_statements = [
                "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS max_members INTEGER DEFAULT 20",
                "ALTER TABLE room_members ADD COLUMN IF NOT EXISTS is_kicked BOOLEAN DEFAULT FALSE",
                "ALTER TABLE source_items ADD COLUMN IF NOT EXISTS file_data BYTEA"
            ]
        for stmt in migration_statements:
            try:
                await conn.execute(text(stmt))
            except Exception:
                # Column already exists or table freshly created
                pass

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
