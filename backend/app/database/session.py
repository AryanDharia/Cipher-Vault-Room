from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
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
