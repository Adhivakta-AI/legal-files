from __future__ import annotations

import argparse
import asyncio
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys
from typing import Any, TypeVar

import asyncpg
import numpy as np
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Settings, get_settings  # noqa: E402
from app.embeddings import to_pgvector_literal  # noqa: E402


EXPECTED_JUDGMENTS = 500
EXPECTED_PAGES = 8146
EXPECTED_CHUNKS = 31368
EXPECTED_EMBEDDING_SHARDS = 32
EXPECTED_DIMENSIONS = 384
EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5"
EXPECTED_CHUNKS_SHA256 = "408c6315280128983d5d17f2e994ad84493f105c2a9d5e2e1d9ec8500dec4cf7"
T = TypeVar("T")


@dataclass(frozen=True)
class PilotPaths:
    manifest_path: Path
    documents_dir: Path
    chunks_path: Path
    embeddings_dir: Path


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def parse_languages(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value).split(",") if item.strip()]


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def read_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("rt", encoding="utf-8") as fh:
        for line_number, line in enumerate(fh, start=1):
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid JSON in {path}:{line_number}") from exc


def read_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def read_gzip_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line_number, line in enumerate(fh, start=1):
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid JSON in {path}:{line_number}") from exc


def require_files(paths: PilotPaths) -> None:
    required_files = [paths.manifest_path, paths.chunks_path]
    for file_path in required_files:
        if not file_path.exists():
            raise FileNotFoundError(f"Required file is missing: {file_path}")
    if not paths.documents_dir.is_dir():
        raise FileNotFoundError(f"Documents directory is missing: {paths.documents_dir}")
    if not paths.embeddings_dir.is_dir():
        raise FileNotFoundError(f"Embeddings shard directory is missing: {paths.embeddings_dir}")


def load_manifest(path: Path) -> dict[str, dict[str, Any]]:
    records = list(read_jsonl(path))
    if len(records) != EXPECTED_JUDGMENTS:
        raise ValueError(f"Manifest has {len(records)} records; expected {EXPECTED_JUDGMENTS}")
    by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        sample_id = record.get("sample_id")
        if not sample_id:
            raise ValueError("Manifest record missing sample_id")
        if sample_id in by_id:
            raise ValueError(f"Duplicate manifest sample_id: {sample_id}")
        by_id[sample_id] = record
    return by_id


def judgment_row(record: dict[str, Any], source_sha256: str | None) -> tuple[Any, ...]:
    metadata = dict(record)
    return (
        record["sample_id"],
        record.get("title") or "",
        record.get("petitioner"),
        record.get("respondent"),
        record.get("description"),
        record.get("judge"),
        record.get("author_judge"),
        record.get("citation"),
        record.get("case_id"),
        record.get("cnr"),
        parse_date(record.get("decision_date")),
        record.get("decision_year"),
        record.get("disposal_nature"),
        record.get("court") or "Supreme Court of India",
        parse_languages(record.get("available_languages")),
        record.get("era"),
        record.get("path"),
        record.get("nc_display"),
        record.get("storage_year"),
        record["pdf_key"],
        record.get("pdf_s3_uri"),
        record["pdf_url"],
        record.get("metadata_key"),
        record.get("pdf_size_bytes"),
        record.get("pdf_etag"),
        source_sha256,
        "ready" if record.get("pdf_exists", True) else "missing_pdf",
        record.get("validation_error"),
        json_dumps(metadata),
    )


def load_documents(
    documents_dir: Path, manifest: dict[str, dict[str, Any]]
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    document_paths = sorted(documents_dir.glob("PILOT-*.json.gz"))
    if len(document_paths) != EXPECTED_JUDGMENTS:
        raise ValueError(f"Found {len(document_paths)} documents; expected {EXPECTED_JUDGMENTS}")

    judgment_rows: list[tuple[Any, ...]] = []
    page_rows: list[tuple[Any, ...]] = []
    seen = set()

    for document_path in document_paths:
        document = read_gzip_json(document_path)
        sample_id = document.get("sample_id")
        if sample_id not in manifest:
            raise ValueError(f"Document {document_path.name} is not in manifest: {sample_id}")
        if sample_id in seen:
            raise ValueError(f"Duplicate document sample_id: {sample_id}")
        seen.add(sample_id)

        metadata = dict(manifest[sample_id])
        metadata.update(document.get("metadata") or {})
        judgment_rows.append(judgment_row(metadata, document.get("source_sha256")))

        page_numbers = set()
        for page in document.get("pages") or []:
            page_number = page.get("pdf_page")
            if not isinstance(page_number, int) or page_number <= 0:
                raise ValueError(f"Invalid pdf_page in {document_path.name}: {page_number}")
            if page_number in page_numbers:
                raise ValueError(f"Duplicate page {sample_id} p{page_number}")
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

    if set(manifest) != seen:
        missing = sorted(set(manifest) - seen)[:10]
        raise ValueError(f"Documents missing for manifest IDs: {missing}")
    if len(page_rows) != EXPECTED_PAGES:
        raise ValueError(f"Found {len(page_rows)} pages; expected {EXPECTED_PAGES}")
    return judgment_rows, page_rows


def load_chunks(path: Path, manifest_ids: set[str]) -> tuple[list[tuple[Any, ...]], list[str]]:
    rows: list[tuple[Any, ...]] = []
    ids: list[str] = []
    seen = set()

    for chunk in read_gzip_jsonl(path):
        chunk_id = chunk.get("id")
        sample_id = chunk.get("sample_id")
        if not chunk_id or not sample_id:
            raise ValueError("Chunk missing id or sample_id")
        if sample_id not in manifest_ids:
            raise ValueError(f"Chunk references unknown judgment: {sample_id}")
        if chunk_id in seen:
            raise ValueError(f"Duplicate chunk id: {chunk_id}")
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

    if len(rows) != EXPECTED_CHUNKS:
        raise ValueError(f"Found {len(rows)} chunks; expected {EXPECTED_CHUNKS}")
    return rows, ids


def sha256_file_contents(path: Path) -> str:
    hasher = hashlib.sha256()
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def load_embedding_updates(embeddings_dir: Path, expected_chunk_ids: Sequence[str]) -> list[tuple[Any, ...]]:
    shard_paths = sorted(embeddings_dir.glob("*.npz"))
    if len(shard_paths) != EXPECTED_EMBEDDING_SHARDS:
        raise ValueError(
            f"Found {len(shard_paths)} embedding shards in {embeddings_dir}; "
            f"expected {EXPECTED_EMBEDDING_SHARDS}"
        )

    expected_ids = list(expected_chunk_ids)
    actual_ids: list[str] = []
    updates: list[tuple[Any, ...]] = []

    for shard_path in shard_paths:
        with np.load(shard_path, allow_pickle=False) as shard:
            if "ids" not in shard or "vectors" not in shard:
                raise ValueError(f"{shard_path} must contain ids and vectors arrays")
            ids = [str(value) for value in shard["ids"].tolist()]
            vectors = np.asarray(shard["vectors"], dtype=np.float32)

        if vectors.ndim != 2 or vectors.shape[1] != EXPECTED_DIMENSIONS:
            raise ValueError(f"{shard_path} vector shape is {vectors.shape}; expected (*, 384)")
        if len(ids) != vectors.shape[0]:
            raise ValueError(f"{shard_path} has {len(ids)} ids but {vectors.shape[0]} vectors")
        if not np.isfinite(vectors).all():
            raise ValueError(f"{shard_path} contains non-finite vector values")

        actual_ids.extend(ids)
        for chunk_id, vector in zip(ids, vectors, strict=True):
            norm = float(np.linalg.norm(vector))
            if not math.isfinite(norm) or norm == 0:
                raise ValueError(f"Invalid vector norm for {chunk_id}: {norm}")
            if abs(norm - 1.0) > 1e-3:
                vector = vector / norm
            updates.append((chunk_id, to_pgvector_literal(vector.astype(float).tolist())))

    if len(updates) != EXPECTED_CHUNKS:
        raise ValueError(f"Found {len(updates)} vectors; expected {EXPECTED_CHUNKS}")
    if actual_ids != expected_ids:
        for index, (expected, actual) in enumerate(zip(expected_ids, actual_ids, strict=False)):
            if expected != actual:
                raise ValueError(
                    f"Chunk/vector ID mismatch at index {index}: expected {expected}, got {actual}"
                )
        raise ValueError("Chunk/vector ID sets differ")

    return updates


def batched(rows: Sequence[T], size: int) -> Iterable[Sequence[T]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


async def ensure_schema(conn: asyncpg.Connection) -> None:
    row = await conn.fetchrow(
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
    missing = [key for key, value in dict(row).items() if not value]
    if missing:
        raise RuntimeError(
            "Database schema is missing required objects: "
            + ", ".join(missing)
            + ". Run scripts/apply_schema.py first."
        )


async def upsert_judgments(conn: asyncpg.Connection, rows: Sequence[tuple[Any, ...]]) -> None:
    sql = """
    INSERT INTO public.judgments (
      id, title, petitioner, respondent, description, judge, author_judge,
      citation, case_id, cnr, decision_date, decision_year, disposal_nature,
      court, available_languages, era, source_path, nc_display, storage_year,
      pdf_key, pdf_s3_uri, pdf_url, metadata_key, pdf_size_bytes, pdf_etag,
      source_sha256, processing_status, validation_error, metadata
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
      $20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      petitioner = EXCLUDED.petitioner,
      respondent = EXCLUDED.respondent,
      description = EXCLUDED.description,
      judge = EXCLUDED.judge,
      author_judge = EXCLUDED.author_judge,
      citation = EXCLUDED.citation,
      case_id = EXCLUDED.case_id,
      cnr = EXCLUDED.cnr,
      decision_date = EXCLUDED.decision_date,
      decision_year = EXCLUDED.decision_year,
      disposal_nature = EXCLUDED.disposal_nature,
      court = EXCLUDED.court,
      available_languages = EXCLUDED.available_languages,
      era = EXCLUDED.era,
      source_path = EXCLUDED.source_path,
      nc_display = EXCLUDED.nc_display,
      storage_year = EXCLUDED.storage_year,
      pdf_key = EXCLUDED.pdf_key,
      pdf_s3_uri = EXCLUDED.pdf_s3_uri,
      pdf_url = EXCLUDED.pdf_url,
      metadata_key = EXCLUDED.metadata_key,
      pdf_size_bytes = EXCLUDED.pdf_size_bytes,
      pdf_etag = EXCLUDED.pdf_etag,
      source_sha256 = EXCLUDED.source_sha256,
      processing_status = EXCLUDED.processing_status,
      validation_error = EXCLUDED.validation_error,
      metadata = EXCLUDED.metadata
    """
    await conn.executemany(sql, rows)


async def upsert_pages(conn: asyncpg.Connection, rows: Sequence[tuple[Any, ...]]) -> None:
    sql = """
    INSERT INTO public.judgment_pages (
      judgment_id, pdf_page, text, text_source, confidence, quality_score,
      removed_margin_markers, needs_review
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (judgment_id, pdf_page) DO UPDATE SET
      text = EXCLUDED.text,
      text_source = EXCLUDED.text_source,
      confidence = EXCLUDED.confidence,
      quality_score = EXCLUDED.quality_score,
      removed_margin_markers = EXCLUDED.removed_margin_markers,
      needs_review = EXCLUDED.needs_review
    """
    await conn.executemany(sql, rows)


async def upsert_chunks(conn: asyncpg.Connection, rows: Sequence[tuple[Any, ...]]) -> None:
    sql = """
    INSERT INTO public.chunks (
      id, judgment_id, pdf_page, paragraph_index, paragraph_number, part_index,
      text, text_source
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO UPDATE SET
      judgment_id = EXCLUDED.judgment_id,
      pdf_page = EXCLUDED.pdf_page,
      paragraph_index = EXCLUDED.paragraph_index,
      paragraph_number = EXCLUDED.paragraph_number,
      part_index = EXCLUDED.part_index,
      text = EXCLUDED.text,
      text_source = EXCLUDED.text_source
    """
    await conn.executemany(sql, rows)


async def update_embeddings(conn: asyncpg.Connection, rows: Sequence[tuple[Any, ...]]) -> None:
    sql = """
    UPDATE public.chunks
    SET embedding = $2::vector,
        embedding_model = $3,
        embedded_at = now()
    WHERE id = $1
    """
    await conn.executemany(sql, [(chunk_id, vector, EMBEDDING_MODEL) for chunk_id, vector in rows])


async def verify_database_counts(conn: asyncpg.Connection) -> None:
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
        "judgments": EXPECTED_JUDGMENTS,
        "judgment_pages": EXPECTED_PAGES,
        "chunks": EXPECTED_CHUNKS,
        "embedded_chunks": EXPECTED_CHUNKS,
    }
    for key, expected_value in expected.items():
        if counts[key] != expected_value:
            raise RuntimeError(f"{key} count is {counts[key]}, expected {expected_value}")
    print(f"verified_counts={counts}")


def validate_inputs(paths: PilotPaths) -> tuple[
    list[tuple[Any, ...]], list[tuple[Any, ...]], list[tuple[Any, ...]], list[tuple[Any, ...]]
]:
    require_files(paths)

    manifest = load_manifest(paths.manifest_path)
    print(f"loaded manifest: {len(manifest)} judgments")

    judgment_rows, page_rows = load_documents(paths.documents_dir, manifest)
    print(f"loaded documents: {len(judgment_rows)} judgments, {len(page_rows)} pages")

    chunk_rows, chunk_ids = load_chunks(paths.chunks_path, set(manifest))
    print(f"loaded chunks: {len(chunk_rows)}")
    observed_sha = sha256_file_contents(paths.chunks_path)
    print(f"chunks sha256 observed={observed_sha} handoff={EXPECTED_CHUNKS_SHA256}")

    embedding_updates = load_embedding_updates(paths.embeddings_dir, chunk_ids)
    print(f"loaded embeddings: {len(embedding_updates)} vectors")

    return judgment_rows, page_rows, chunk_rows, embedding_updates


async def ingest(settings: Settings, paths: PilotPaths, batch_size: int, validate_only: bool) -> None:
    judgment_rows, page_rows, chunk_rows, embedding_updates = validate_inputs(paths)

    if validate_only:
        print("validation complete; database ingestion skipped")
        return

    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required. Put it in backend/.env or export it.")

    conn = await asyncpg.connect(settings.database_url, command_timeout=300)
    try:
        await ensure_schema(conn)
        async with conn.transaction():
            for batch in batched(judgment_rows, batch_size):
                await upsert_judgments(conn, batch)
            print("upserted judgments")

            for batch in batched(page_rows, batch_size):
                await upsert_pages(conn, batch)
            print("upserted pages")

            for batch in batched(chunk_rows, batch_size):
                await upsert_chunks(conn, batch)
            print("upserted chunk text")

            # Vector updates are wider and more expensive. Keep batches smaller even if
            # the caller chooses a large text batch size.
            vector_batch_size = min(batch_size, 500)
            for index, batch in enumerate(batched(embedding_updates, vector_batch_size), start=1):
                await update_embeddings(conn, batch)
                if index % 10 == 0:
                    print(f"updated embedding batches: {index}")
            print("updated embeddings")

        await verify_database_counts(conn)
    finally:
        await conn.close()


def cli() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest the 500-judgment pilot corpus.")
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--documents-dir", type=Path, default=None)
    parser.add_argument("--chunks", type=Path, default=None)
    parser.add_argument("--embeddings-dir", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=1000)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate local pilot files and chunk/vector alignment without writing to PostgreSQL.",
    )
    return parser.parse_args()


def paths_from_args(settings: Settings, args: argparse.Namespace) -> PilotPaths:
    return PilotPaths(
        manifest_path=args.manifest or settings.pilot_manifest_path,
        documents_dir=args.documents_dir or settings.pilot_documents_dir,
        chunks_path=args.chunks or settings.pilot_chunks_path,
        embeddings_dir=args.embeddings_dir or settings.pilot_embeddings_dir,
    )


async def main() -> None:
    args = cli()
    if args.batch_size < 1:
        raise SystemExit("--batch-size must be positive")

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    settings = get_settings()
    await ingest(settings, paths_from_args(settings, args), args.batch_size, args.validate_only)


if __name__ == "__main__":
    asyncio.run(main())
