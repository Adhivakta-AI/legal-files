from __future__ import annotations

from collections.abc import AsyncIterator

import asyncpg

from app.config import Settings, get_settings


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None

    async def connect(self, settings: Settings | None = None) -> None:
        settings = settings or get_settings()
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is required for database access")
        self.pool = await asyncpg.create_pool(
            dsn=settings.database_url,
            min_size=1,
            max_size=10,
            command_timeout=120,
        )

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    async def acquire(self) -> AsyncIterator[asyncpg.Connection]:
        if self.pool is None:
            raise RuntimeError("Database pool has not been initialized")
        async with self.pool.acquire() as conn:
            yield conn


db = Database()
