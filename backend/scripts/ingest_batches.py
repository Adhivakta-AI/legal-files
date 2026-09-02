"""Ingest one or more finalized OCR batches (from ocr/download-batch-from-r2.sh)
into the same judgments/judgment_pages/chunks schema used by ingest_pilot.py.

Unlike ingest_pilot.py, this script does not assume a fixed corpus size: it
discovers whichever batches are present, validates each one internally
(manifest/document/chunk/embedding alignment), and reports actual counts
instead of asserting hardcoded totals.
"""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from itertools import islice
import math
from pathlib import Path
import sys
from typing import Any

import asyncpg
import numpy as np
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import Settings, get_settings  # noqa: E402
from app.embeddings import to_pgvector_literal  # noqa: E402
from ingest_pilot import (  # noqa: E402
    batched,
    ensure_schema,
    judgment_row,
    read_gzip_json,
    read_gzip_jsonl,
    read_jsonl,
    update_embeddings,
    upsert_chunks,
    upsert_judgments,
    upsert_pages,
)


@dataclass(frozen=True)
class BatchPaths:
    batch_id: str
    manifest_path: Path
    documents_dir: Path
    chunks_path: Path
    embeddings_dir: Path


def discover_batches(root: Path, batch_ids: Sequence[str] | None) -> list[BatchPaths]:
    if batch_ids:
        names = list(batch_ids)
    else:
        names = sorted(
            path.name
            for path in root.iterdir()
            if path.is_dir() and (path / "completion" / "COMPLETE.json").is_file()
        )
    return [
        BatchPaths(
            batch_id=name,
            manifest_path=root / name / "manifest.jsonl",
            documents_dir=root / name / "final" / "documents",
            chunks_path=root / name / "final" / "chunks.jsonl.gz",
            embeddings_dir=root / name / "embeddings" / "shards",
        )
        for name in names
    ]


def require_batch_files(bp: BatchPaths) -> None:
    for path in (bp.manifest_path, bp.chunks_path):
        if not path.is_file():
            raise FileNotFoundError(f"[{bp.batch_id}] Required file is missing: {path}")
    for path in (bp.documents_dir, bp.embeddings_dir):
        if not path.is_dir():
            raise FileNotFoundError(f"[{bp.batch_id}] Required directory is missing: {path}")


def load_batch_manifest(bp: BatchPaths) -> dict[str, dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for record in read_jsonl(bp.manifest_path):
        sample_id = record.get("sample_id")
        if not sample_id:
            raise ValueError(f"[{bp.batch_id}] Manifest record missing sample_id")
        if sample_id in by_id:
            raise ValueError(f"[{bp.batch_id}] Duplicate manifest sample_id: {sample_id}")
        by_id[sample_id] = record
    return by_id


def load_batch_documents(
    bp: BatchPaths, manifest: dict[str, dict[str, Any]]
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    document_paths = sorted(bp.documents_dir.glob("*.json.gz"))
    judgment_rows: list[tuple[Any, ...]] = []
    page_rows: list[tuple[Any, ...]] = []
    seen: set[str] = set()

    for document_path in document_paths:
        document = read_gzip_json(document_path)
        sample_id = document.get("sample_id")
        if sample_id not in manifest:
            raise ValueError(
                f"[{bp.batch_id}] Document {document_path.name} is not in manifest: {sample_id}"
            )
        if sample_id in seen:
            raise ValueError(f"[{bp.batch_id}] Duplicate document sample_id: {sample_id}")
        seen.add(sample_id)

        metadata = dict(manifest[sample_id])
        metadata.update(document.get("metadata") or {})
        judgment_rows.append(judgment_row(metadata, document.get("source_sha256")))

        page_numbers: set[int] = set()
        for page in document.get("pages") or []:
            page_number = page.get("pdf_page")
            if not isinstance(page_number, int) or page_number <= 0:
                raise ValueError(
                    f"[{bp.batch_id}] Invalid pdf_page in {document_path.name}: {page_number}"
                )
            if page_number in page_numbers:
                raise ValueError(f"[{bp.batch_id}] Duplicate page {sample_id} p{page_number}")
            page_numbers.add(page_number)
            page_rows.append(
                (
                    sample_id,
                    page_number,
                    page.get("text") or "",
                    page.get("source"),
                    page.get("confidence"),
                    page.get("quality_score"),
                    page.get("removed_margin_markers") or [],
                    bool(page.get("needs_review", False)),
                )
            )

    missing = sorted(set(manifest) - seen)
    if missing:
        preview = ", ".join(missing[:5])
        print(
            f"[{bp.batch_id}] WARNING: {len(missing)} manifest record(s) have no "
            f"finalized document and will not be ingested ({preview})"
        )
    return judgment_rows, page_rows


def load_batch_chunks(
    bp: BatchPaths, manifest_ids: set[str]
) -> tuple[list[tuple[Any, ...]], list[str]]:
    rows: list[tuple[Any, ...]] = []
    ids: list[str] = []
    seen: set[str] = set()

    for chunk in read_gzip_jsonl(bp.chunks_path):
        chunk_id = chunk.get("id")
        sample_id = chunk.get("sample_id")
        if not chunk_id or not sample_id:
            raise ValueError(f"[{bp.batch_id}] Chunk missing id or sample_id")
        if sample_id not in manifest_ids:
            raise ValueError(f"[{bp.batch_id}] Chunk references unknown judgment: {sample_id}")
        if chunk_id in seen:
            raise ValueError(f"[{bp.batch_id}] Duplicate chunk id: {chunk_id}")
        seen.add(chunk_id)
        ids.append(chunk_id)
        rows.append(
            (
                chunk_id,
                sample_id,
                chunk["pdf_page"],
                chunk["paragraph_index"],
                chunk.get("paragraph_number"),
                chunk["part_index"],
                chunk["text"],
                chunk["text_source"],
            )
        )
    return rows, ids


def load_batch_embeddings(
    bp: BatchPaths, expected_chunk_ids: Sequence[str], dimensions: int
) -> list[tuple[Any, ...]]:
    shard_paths = sorted(bp.embeddings_dir.glob("*.npz"))
    if not shard_paths:
        raise ValueError(f"[{bp.batch_id}] No embedding shards found in {bp.embeddings_dir}")

    expected_ids = list(expected_chunk_ids)
    actual_ids: list[str] = []
    updates: list[tuple[Any, ...]] = []

    for shard_path in shard_paths:
        with np.load(shard_path, allow_pickle=False) as shard:
            if "ids" not in shard or "vectors" not in shard:
                raise ValueError(f"[{bp.batch_id}] {shard_path} must contain ids and vectors arrays")
            ids = [str(value) for value in shard["ids"].tolist()]
            vectors = np.asarray(shard["vectors"], dtype=np.float32)

        if vectors.ndim != 2 or vectors.shape[1] != dimensions:
            raise ValueError(
                f"[{bp.batch_id}] {shard_path} vector shape is {vectors.shape}; "
                f"expected (*, {dimensions})"
            )
        if len(ids) != vectors.shape[0]:
            raise ValueError(
                f"[{bp.batch_id}] {shard_path} has {len(ids)} ids but {vectors.shape[0]} vectors"
            )
        if not np.isfinite(vectors).all():
            raise ValueError(f"[{bp.batch_id}] {shard_path} contains non-finite vector values")

        actual_ids.extend(ids)
        for chunk_id, vector in zip(ids, vectors, strict=True):
            norm = float(np.linalg.norm(vector))
            if not math.isfinite(norm) or norm == 0:
                raise ValueError(f"[{bp.batch_id}] Invalid vector norm for {chunk_id}: {norm}")
            if abs(norm - 1.0) > 1e-3:
                vector = vector / norm
            updates.append((chunk_id, to_pgvector_literal(vector.astype(float).tolist())))

    if actual_ids != expected_ids:
        for index, (expected, actual) in enumerate(zip(expected_ids, actual_ids, strict=False)):
            if expected != actual:
                raise ValueError(
                    f"[{bp.batch_id}] Chunk/vector ID mismatch at index {index}: "
                    f"expected {expected}, got {actual}"
                )
        raise ValueError(f"[{bp.batch_id}] Chunk/vector ID sets differ")

    return updates


def batched_iterable(rows: Iterable[tuple[Any, ...]], size: int) -> Iterator[list[tuple[Any, ...]]]:
    """Yield bounded batches without materializing a complete OCR batch in RAM."""
    iterator = iter(rows)
    while batch := list(islice(iterator, size)):
        yield batch


def iter_chunk_rows(bp: BatchPaths, manifest_ids: set[str]) -> Iterator[tuple[Any, ...]]:
    seen: set[str] = set()
    for chunk in read_gzip_jsonl(bp.chunks_path):
        chunk_id = chunk.get("id")
        sample_id = chunk.get("sample_id")
        if not chunk_id or not sample_id:
            raise ValueError(f"[{bp.batch_id}] Chunk missing id or sample_id")
        if sample_id not in manifest_ids:
            raise ValueError(f"[{bp.batch_id}] Chunk references unknown judgment: {sample_id}")
        if chunk_id in seen:
            raise ValueError(f"[{bp.batch_id}] Duplicate chunk id: {chunk_id}")
        seen.add(chunk_id)
        yield (
            chunk_id,
            sample_id,
            chunk["pdf_page"],
            chunk["paragraph_index"],
            chunk.get("paragraph_number"),
            chunk["part_index"],
            chunk["text"],
            chunk["text_source"],
        )


def iter_embedding_updates(
    bp: BatchPaths, expected_chunk_ids: Iterable[str], dimensions: int
) -> Iterator[tuple[str, str]]:
    expected = iter(expected_chunk_ids)
    count = 0
    for shard_path in sorted(bp.embeddings_dir.glob("*.npz")):
        with np.load(shard_path, allow_pickle=False) as shard:
            if "ids" not in shard or "vectors" not in shard:
                raise ValueError(f"[{bp.batch_id}] {shard_path} must contain ids and vectors arrays")
            ids = [str(value) for value in shard["ids"].tolist()]
            vectors = np.asarray(shard["vectors"], dtype=np.float32)
        if vectors.shape != (len(ids), dimensions) or not np.isfinite(vectors).all():
            raise ValueError(f"[{bp.batch_id}] Invalid vectors in {shard_path}: {vectors.shape}")
        for chunk_id, vector in zip(ids, vectors, strict=True):
            expected_id = next(expected, None)
            if expected_id != chunk_id:
                raise ValueError(
                    f"[{bp.batch_id}] Chunk/vector ID mismatch at {count}: "
                    f"expected {expected_id}, got {chunk_id}"
                )
            norm = float(np.linalg.norm(vector))
            if not math.isfinite(norm) or norm == 0:
                raise ValueError(f"[{bp.batch_id}] Invalid vector norm for {chunk_id}: {norm}")
            if abs(norm - 1.0) > 1e-3:
                vector = vector / norm
            count += 1
            yield chunk_id, to_pgvector_literal(vector.astype(float).tolist())
    trailing_id = next(expected, None)
    if trailing_id is not None:
        raise ValueError(f"[{bp.batch_id}] Embeddings end before chunk {trailing_id}")


def iter_judgment_rows(bp: BatchPaths, manifest: dict[str, dict[str, Any]]) -> Iterator[tuple[Any, ...]]:
    for document_path in sorted(bp.documents_dir.glob("*.json.gz")):
        document = read_gzip_json(document_path)
        sample_id = document.get("sample_id")
        if sample_id not in manifest:
            raise ValueError(f"[{bp.batch_id}] Unknown document sample_id: {sample_id}")
        metadata = dict(manifest[sample_id])
        metadata.update(document.get("metadata") or {})
        yield judgment_row(metadata, document.get("source_sha256"))


def iter_page_rows(bp: BatchPaths, manifest: dict[str, dict[str, Any]]) -> Iterator[tuple[Any, ...]]:
    for document_path in sorted(bp.documents_dir.glob("*.json.gz")):
        document = read_gzip_json(document_path)
        sample_id = document.get("sample_id")
        if sample_id not in manifest:
            raise ValueError(f"[{bp.batch_id}] Unknown document sample_id: {sample_id}")
        for page in document.get("pages") or []:
            yield (
                sample_id,
                page["pdf_page"],
                page.get("text") or "",
                page.get("source"),
                page.get("confidence"),
                page.get("quality_score"),
                page.get("removed_margin_markers") or [],
                bool(page.get("needs_review", False)),
            )


def validate_batch(bp: BatchPaths, dimensions: int) -> tuple[dict[str, dict[str, Any]], int, int, int]:
    require_batch_files(bp)
    manifest = load_batch_manifest(bp)
    judgment_count = sum(1 for _ in iter_judgment_rows(bp, manifest))
    page_count = sum(1 for _ in iter_page_rows(bp, manifest))
    chunk_count = sum(1 for _ in iter_embedding_updates(
        bp,
        (row[0] for row in iter_chunk_rows(bp, set(manifest))),
        dimensions,
    ))
    print(
        f"[{bp.batch_id}] judgments={judgment_count} pages={page_count} "
        f"chunks={chunk_count} embeddings={chunk_count}"
    )
    return manifest, judgment_count, page_count, chunk_count


async def verify_database_batch(
    conn: asyncpg.Connection, judgment_ids: Sequence[str], expected_chunks: int
) -> None:
    row = await conn.fetchrow(
        """
        SELECT
          count(*) AS chunks,
          count(embedding) AS embedded_chunks
        FROM public.chunks
        WHERE judgment_id = ANY($1::text[])
        """,
        list(judgment_ids),
    )
    counts = dict(row)
    print(f"database_counts={counts}")
    if counts["chunks"] != expected_chunks or counts["embedded_chunks"] != expected_chunks:
        raise RuntimeError(
            f"Expected {expected_chunks} embedded chunks for batch; got {counts}"
        )


async def prepare_staging_tables(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        CREATE TEMP TABLE IF NOT EXISTS ingest_chunks_stage (
          id text, judgment_id text, pdf_page integer, paragraph_index integer,
          paragraph_number text, part_index integer, text text, text_source text
        ) ON COMMIT PRESERVE ROWS;
        CREATE TEMP TABLE IF NOT EXISTS ingest_embeddings_stage (
          id text, embedding_text text
        ) ON COMMIT PRESERVE ROWS;
        """
    )


async def upsert_chunks_staged(
    conn: asyncpg.Connection, rows: Sequence[tuple[Any, ...]]
) -> None:
    await conn.execute("TRUNCATE ingest_chunks_stage")
    await conn.copy_records_to_table(
        "ingest_chunks_stage",
        records=rows,
        columns=(
            "id", "judgment_id", "pdf_page", "paragraph_index",
            "paragraph_number", "part_index", "text", "text_source",
        ),
    )
    await conn.execute(
        """
        INSERT INTO public.chunks (
          id, judgment_id, pdf_page, paragraph_index, paragraph_number,
          part_index, text, text_source
        )
        SELECT id, judgment_id, pdf_page, paragraph_index, paragraph_number,
               part_index, text, text_source
        FROM ingest_chunks_stage
        ON CONFLICT (id) DO UPDATE SET
          judgment_id = EXCLUDED.judgment_id,
          pdf_page = EXCLUDED.pdf_page,
          paragraph_index = EXCLUDED.paragraph_index,
          paragraph_number = EXCLUDED.paragraph_number,
          part_index = EXCLUDED.part_index,
          text = EXCLUDED.text,
          text_source = EXCLUDED.text_source
        """
    )


async def update_embeddings_staged(
    conn: asyncpg.Connection, rows: Sequence[tuple[Any, ...]]
) -> None:
    await conn.execute("TRUNCATE ingest_embeddings_stage")
    await conn.copy_records_to_table(
        "ingest_embeddings_stage",
        records=rows,
        columns=("id", "embedding_text"),
    )
    result = await conn.execute(
        """
        UPDATE public.chunks AS c
        SET embedding = s.embedding_text::vector,
            embedding_model = 'BAAI/bge-small-en-v1.5',
            embedded_at = now()
        FROM ingest_embeddings_stage AS s
        WHERE c.id = s.id
        """
    )
    updated = int(result.rsplit(" ", 1)[-1])
    if updated != len(rows):
        raise RuntimeError(f"Updated {updated} embeddings; expected {len(rows)}")


async def ingest(
    settings: Settings,
    batches: list[BatchPaths],
    dimensions: int,
    batch_size: int,
    validate_only: bool,
) -> None:
    seen_judgment_ids: set[str] = set()
    validated: list[tuple[BatchPaths, dict[str, dict[str, Any]], int]] = []
    total_judgments = total_pages = total_chunks = 0
    for bp in batches:
        manifest, judgment_count, page_count, chunk_count = validate_batch(bp, dimensions)
        duplicates = seen_judgment_ids.intersection(manifest)
        if duplicates:
            raise ValueError(f"Duplicate judgment id across batches: {next(iter(duplicates))}")
        seen_judgment_ids.update(manifest)
        validated.append((bp, manifest, chunk_count))
        total_judgments += judgment_count
        total_pages += page_count
        total_chunks += chunk_count

    print(
        f"TOTAL across {len(batches)} batches: judgments={total_judgments} "
        f"pages={total_pages} chunks={total_chunks} embeddings={total_chunks}"
    )

    if validate_only:
        print("validation complete; database ingestion skipped")
        return

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required. Put it in backend/.env or export it.")

    conn = await asyncpg.connect(settings.database_url, command_timeout=600)
    try:
        await ensure_schema(conn)
        await prepare_staging_tables(conn)
        for bp, manifest, chunk_count in validated:
            print(f"[{bp.batch_id}] starting database ingestion")
            for rows in batched_iterable(iter_judgment_rows(bp, manifest), batch_size):
                async with conn.transaction():
                    await upsert_judgments(conn, rows)
            for rows in batched_iterable(iter_page_rows(bp, manifest), batch_size):
                async with conn.transaction():
                    await upsert_pages(conn, rows)
            print(f"[{bp.batch_id}] upserted judgments and pages")

            for index, rows in enumerate(
                batched_iterable(iter_chunk_rows(bp, set(manifest)), batch_size), start=1
            ):
                async with conn.transaction():
                    await upsert_chunks_staged(conn, rows)
                if index % 100 == 0:
                    print(f"[{bp.batch_id}] upserted chunk batches: {index}")

            vector_batch_size = min(batch_size, 500)
            updates = iter_embedding_updates(
                bp,
                (row[0] for row in iter_chunk_rows(bp, set(manifest))),
                dimensions,
            )
            for index, rows in enumerate(batched_iterable(updates, vector_batch_size), start=1):
                async with conn.transaction():
                    await update_embeddings_staged(conn, rows)
                if index % 100 == 0:
                    print(f"[{bp.batch_id}] updated embedding batches: {index}")
            await verify_database_batch(conn, list(manifest), chunk_count)
            print(f"[{bp.batch_id}] complete")
        await conn.execute("ANALYZE public.judgments, public.judgment_pages, public.chunks")
    finally:
        await conn.close()


def cli() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest one or more finalized OCR batches.")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("/home/shauray/judgment-ocr-data/r2-batches"),
        help="Directory containing batch-NN subdirectories (default: the R2 download root).",
    )
    parser.add_argument(
        "--batch",
        action="append",
        dest="batches",
        help="Batch id to ingest (repeatable). Defaults to every complete batch under --root.",
    )
    parser.add_argument("--dimensions", type=int, default=384)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate batch files and chunk/vector alignment without writing to PostgreSQL.",
    )
    return parser.parse_args()


async def main() -> None:
    args = cli()
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be positive")

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    settings = get_settings()
    batches = discover_batches(args.root, args.batches)
    if not batches:
        raise SystemExit(f"No complete batches found under {args.root}")
    print(f"discovered {len(batches)} batch(es): {', '.join(b.batch_id for b in batches)}")
    await ingest(settings, batches, args.dimensions, args.batch_size, args.validate_only)


if __name__ == "__main__":
    asyncio.run(main())
