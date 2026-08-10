from __future__ import annotations

import math
from functools import lru_cache

from fastembed import TextEmbedding

from app.config import get_settings


@lru_cache(maxsize=1)
def _query_embedder() -> TextEmbedding:
    settings = get_settings()
    return TextEmbedding(model_name=settings.query_embedding_model)


def embed_query(query: str) -> list[float]:
    settings = get_settings()
    embedder = _query_embedder()

    if hasattr(embedder, "query_embed"):
        vector_iter = embedder.query_embed(query)
    else:
        vector_iter = embedder.embed([query])

    vector = [float(value) for value in next(iter(vector_iter))]
    if len(vector) != settings.embedding_dimensions:
        raise ValueError(
            f"Query embedding has {len(vector)} dimensions; "
            f"expected {settings.embedding_dimensions}"
        )
    if not all(math.isfinite(value) for value in vector):
        raise ValueError("Query embedding contains non-finite values")

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0 or not math.isfinite(norm):
        raise ValueError("Query embedding has invalid norm")

    # BGE vectors from FastEmbed are expected to be normalized. Normalize defensively so
    # cosine scores are comparable with the stored normalized document vectors.
    if abs(norm - 1.0) > 1e-3:
        vector = [value / norm for value in vector]

    return vector


def to_pgvector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.8g}" for value in vector) + "]"
