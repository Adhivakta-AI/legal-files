from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys

import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.schemas import SearchRequest  # noqa: E402
from app.search import hybrid_search  # noqa: E402


async def verify_counts(conn: asyncpg.Connection) -> dict[str, int]:
    row = await conn.fetchrow(
        """
        SELECT
          (SELECT count(*) FROM public.judgments) AS judgments,
          (SELECT count(*) FROM public.judgment_pages) AS judgment_pages,
          (SELECT count(*) FROM public.chunks) AS chunks,
          (SELECT count(*) FROM public.chunks WHERE embedding IS NOT NULL) AS embedded_chunks
        """
    )
    counts = dict(row)
    expected = {
        "judgments": 500,
        "judgment_pages": 8146,
        "chunks": 31368,
        "embedded_chunks": 31368,
    }
    for key, expected_value in expected.items():
        if counts[key] != expected_value:
            raise RuntimeError(f"{key} count is {counts[key]}, expected {expected_value}")
    return counts


async def main() -> None:
    parser = argparse.ArgumentParser(description="Verify corpus counts and hybrid search.")
    parser.add_argument(
        "query",
        nargs="?",
        default="When can a tenant challenge a possession decree?",
    )
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--year-from", type=int, default=1950)
    parser.add_argument("--year-to", type=int, default=2026)
    args = parser.parse_args()

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    settings = get_settings()
    if not settings.database_url:
        raise SystemExit("DATABASE_URL is required. Put it in backend/.env or export it.")

    conn = await asyncpg.connect(settings.database_url, command_timeout=180)
    try:
        counts = await verify_counts(conn)
        request = SearchRequest(
            query=args.query,
            limit=args.limit,
            year_from=args.year_from,
            year_to=args.year_to,
        )
        results = await hybrid_search(conn, request)
        if not results:
            raise RuntimeError("Hybrid search returned no results")

        print(f"counts={counts}")
        print(f"results={len(results)}")
        for result in results[: args.limit]:
            print(
                {
                    "chunk_id": result.chunk_id,
                    "title": result.title,
                    "citation": result.citation,
                    "pdf_page": result.pdf_page,
                    "keyword_score": result.keyword_score,
                    "semantic_score": result.semantic_score,
                    "rrf_score": result.rrf_score,
                }
            )
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
