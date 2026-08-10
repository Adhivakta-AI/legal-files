from __future__ import annotations

import asyncpg

from app.config import get_settings
from app.embeddings import embed_query, to_pgvector_literal
from app.schemas import SearchRequest, SearchResult


async def hybrid_search(conn: asyncpg.Connection, request: SearchRequest) -> list[SearchResult]:
    settings = get_settings()
    vector_literal = to_pgvector_literal(embed_query(request.query))

    rows = await conn.fetch(
        """
        SELECT *
        FROM public.hybrid_search(
            query_text := $1,
            query_embedding := $2::vector,
            result_limit := $3,
            full_text_limit := $4,
            semantic_limit := $5,
            year_from := $6,
            year_to := $7
        )
        """,
        request.query,
        vector_literal,
        min(request.limit, settings.max_limit),
        settings.full_text_candidate_limit,
        settings.semantic_candidate_limit,
        request.year_from,
        request.year_to,
    )

    return [SearchResult.model_validate(dict(row)) for row in rows]
