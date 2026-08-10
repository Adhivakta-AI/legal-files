from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys

import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser(description="Apply the canonical pgvector schema.")
    parser.add_argument("--schema", type=Path, default=None, help="Override schema SQL path.")
    args = parser.parse_args()

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    settings = get_settings()
    if not settings.database_url:
        raise SystemExit("DATABASE_URL is required. Put it in backend/.env or export it.")

    schema_path = args.schema or settings.schema_sql_path
    if not schema_path.exists():
        raise SystemExit(f"Schema SQL not found: {schema_path}")

    sql = schema_path.read_text(encoding="utf-8")
    conn = await asyncpg.connect(settings.database_url, command_timeout=300)
    try:
        await conn.execute(sql)
        objects = await conn.fetchrow(
            """
            SELECT
              to_regclass('public.judgments') IS NOT NULL AS judgments,
              to_regclass('public.judgment_pages') IS NOT NULL AS judgment_pages,
              to_regclass('public.chunks') IS NOT NULL AS chunks,
              EXISTS (
                SELECT 1
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = 'hybrid_search'
              ) AS hybrid_search
            """
        )
        print(dict(objects))
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
