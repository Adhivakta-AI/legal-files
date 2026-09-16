"""Resumably ingest structural legal units into D1 and Cloudflare Vectorize."""

from __future__ import annotations

import argparse
import gzip
import json
import os
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv
from ingest_cloudflare import CloudflareAPI, CloudflareConfig, read_vectors

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHECKPOINT = BACKEND_ROOT / ".legal-corpus-ingest-checkpoint.json"
D1_STATEMENTS_PER_REQUEST = 20
D1_CHUNK_ROWS_PER_STATEMENT = 7
VECTOR_GROUP_SIZE = 1_000


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as input_file:
        return [json.loads(line) for line in input_file if line.strip()]


def read_gzip_jsonl(path: Path) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as input_file:
        return [json.loads(line) for line in input_file if line.strip()]


def groups(values: Iterable[Any], size: int) -> Iterator[list[Any]]:
    group: list[Any] = []
    for value in values:
        group.append(value)
        if len(group) == size:
            yield group
            group = []
    if group:
        yield group


def send_statements(
    api: CloudflareAPI, statements: Sequence[dict[str, Any]]
) -> None:
    for start in range(0, len(statements), D1_STATEMENTS_PER_REQUEST):
        api.d1_batch(statements[start : start + D1_STATEMENTS_PER_REQUEST])


def document_statements(documents: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    sql = """
        INSERT INTO legal_documents(
            id, source_kind, title, short_title, jurisdiction, authority,
            act_number, enacted_on, effective_from, current_through, language,
            source_url, canonical_url, source_sha256, corpus_version,
            metadata_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            source_kind=excluded.source_kind,
            title=excluded.title,
            short_title=excluded.short_title,
            jurisdiction=excluded.jurisdiction,
            authority=excluded.authority,
            act_number=excluded.act_number,
            enacted_on=excluded.enacted_on,
            effective_from=excluded.effective_from,
            current_through=excluded.current_through,
            language=excluded.language,
            source_url=excluded.source_url,
            canonical_url=excluded.canonical_url,
            source_sha256=excluded.source_sha256,
            corpus_version=excluded.corpus_version,
            metadata_json=excluded.metadata_json,
            updated_at=CURRENT_TIMESTAMP
    """
    return [
        {
            "sql": sql,
            "params": [
                document["id"],
                document["source_kind"],
                document["title"],
                document["short_title"],
                document["jurisdiction"],
                document["authority"],
                document.get("act_number"),
                document.get("enacted_on"),
                document.get("effective_from"),
                document.get("current_through"),
                document["language"],
                document["source_url"],
                document["canonical_url"],
                document["source_sha256"],
                document["corpus_version"],
                json.dumps(
                    {
                        "aliases": document.get("aliases", []),
                        "source_filename": document.get("source_filename"),
                        "commencement_note": document.get("commencement_note"),
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            ],
        }
        for document in documents
    ]


def unit_statements(units: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    sql = """
        INSERT INTO legal_units(
            id, document_id, unit_kind, unit_number, parent_label, heading,
            text, pdf_page_start, pdf_page_end, sort_order, language,
            source_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            document_id=excluded.document_id,
            unit_kind=excluded.unit_kind,
            unit_number=excluded.unit_number,
            parent_label=excluded.parent_label,
            heading=excluded.heading,
            text=excluded.text,
            pdf_page_start=excluded.pdf_page_start,
            pdf_page_end=excluded.pdf_page_end,
            sort_order=excluded.sort_order,
            language=excluded.language,
            source_sha256=excluded.source_sha256
    """
    return [
        {
            "sql": sql,
            "params": [
                unit["id"],
                unit["document_id"],
                unit["unit_kind"],
                unit["unit_number"],
                unit.get("parent_label"),
                unit["heading"],
                unit["text"],
                unit.get("pdf_page_start"),
                unit.get("pdf_page_end"),
                unit["sort_order"],
                unit["language"],
                unit["source_sha256"],
            ],
        }
        for unit in units
    ]


def chunk_statements(chunks: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    statements: list[dict[str, Any]] = []
    # D1 currently accepts at most 100 bound parameters per statement.
    # Each legal chunk contributes 14 parameters, so seven rows (98 params)
    # is the largest safe multi-row upsert.
    for chunk_group in groups(chunks, D1_CHUNK_ROWS_PER_STATEMENT):
        row = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        placeholders = ",".join([row] * len(chunk_group))
        params: list[Any] = []
        for chunk in chunk_group:
            params.extend(
                [
                    chunk["id"],
                    chunk["document_id"],
                    chunk["unit_id"],
                    chunk["part_index"],
                    chunk["unit_kind"],
                    chunk["unit_number"],
                    chunk.get("parent_label"),
                    chunk["heading"],
                    chunk["text"],
                    chunk["search_text"],
                    chunk.get("pdf_page_start"),
                    chunk.get("pdf_page_end"),
                    chunk["language"],
                    chunk["corpus_version"],
                ]
            )
        statements.append(
            {
                "sql": (
                    "INSERT INTO legal_chunks("
                    "id, document_id, unit_id, part_index, unit_kind, unit_number, "
                    "parent_label, heading, text, search_text, pdf_page_start, "
                    "pdf_page_end, language, corpus_version"
                    f") VALUES {placeholders} ON CONFLICT(id) DO UPDATE SET "
                    "document_id=excluded.document_id, unit_id=excluded.unit_id, "
                    "part_index=excluded.part_index, unit_kind=excluded.unit_kind, "
                    "unit_number=excluded.unit_number, parent_label=excluded.parent_label, "
                    "heading=excluded.heading, text=excluded.text, "
                    "search_text=excluded.search_text, "
                    "pdf_page_start=excluded.pdf_page_start, "
                    "pdf_page_end=excluded.pdf_page_end, language=excluded.language, "
                    "corpus_version=excluded.corpus_version"
                ),
                "params": params,
            }
        )
    return statements


def progress_statement(
    *,
    batch_id: str,
    corpus_version: str,
    document_count: int,
    unit_count: int,
    chunk_count: int,
    vector_count: int,
    status: str,
) -> dict[str, Any]:
    return {
        "sql": """
            INSERT INTO legal_ingestion_batches(
                batch_id, corpus_version, document_count, unit_count,
                chunk_count, vector_count, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(batch_id) DO UPDATE SET
                corpus_version=excluded.corpus_version,
                document_count=excluded.document_count,
                unit_count=excluded.unit_count,
                chunk_count=excluded.chunk_count,
                vector_count=excluded.vector_count,
                status=excluded.status,
                updated_at=CURRENT_TIMESTAMP
        """,
        "params": [
            batch_id,
            corpus_version,
            document_count,
            unit_count,
            chunk_count,
            vector_count,
            status,
        ],
    }


def load_checkpoint(path: Path, batch_id: str) -> int:
    if not path.is_file():
        return 0
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("batch_id") != batch_id:
        return 0
    return int(value.get("processed", 0))


def save_checkpoint(path: Path, batch_id: str, processed: int) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps({"batch_id": batch_id, "processed": processed}, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def validate_artifacts(
    corpus_root: Path,
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[tuple[str, np.ndarray]],
]:
    summary = json.loads((corpus_root / "summary.json").read_text(encoding="utf-8"))
    documents = read_jsonl(corpus_root / "documents.jsonl")
    units = read_gzip_jsonl(corpus_root / "units.jsonl.gz")
    chunks = read_gzip_jsonl(corpus_root / "chunks.jsonl.gz")
    vectors = list(read_vectors(corpus_root / "embeddings" / "shards"))

    if summary.get("document_count") != len(documents):
        raise ValueError("Document count does not match the corpus summary")
    if summary.get("unit_count") != len(units):
        raise ValueError("Unit count does not match the corpus summary")
    if summary.get("chunk_count") != len(chunks):
        raise ValueError("Chunk count does not match the corpus summary")
    if len(vectors) != len(chunks):
        raise ValueError("Embedding count does not match the legal chunks")
    document_ids = {document["id"] for document in documents}
    unit_ids = {unit["id"] for unit in units}
    if len(document_ids) != len(documents) or len(unit_ids) != len(units):
        raise ValueError("Document and legal unit IDs must be unique")
    for unit in units:
        if unit["document_id"] not in document_ids:
            raise ValueError(f"Unknown document for legal unit {unit['id']}")
    for chunk, (vector_id, _) in zip(chunks, vectors, strict=True):
        if chunk["unit_id"] not in unit_ids:
            raise ValueError(f"Unknown legal unit for chunk {chunk['id']}")
        if chunk["id"] != vector_id:
            raise ValueError(f"Chunk/vector mismatch: {chunk['id']} != {vector_id}")
    return summary, documents, units, chunks, vectors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-root", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.limit is not None and args.limit <= 0:
        raise SystemExit("--limit must be positive")
    summary, documents, units, chunks, vectors = validate_artifacts(args.corpus_root)
    corpus_version = str(summary["corpus_version"])
    batch_id = f"{corpus_version}:{summary['chunk_count']}"
    offset = load_checkpoint(args.checkpoint, batch_id)
    if offset > len(chunks):
        raise ValueError("Checkpoint is beyond the end of the legal chunk stream")

    print(
        json.dumps(
            {
                "event": "legal_corpus.validated",
                "documents": len(documents),
                "units": len(units),
                "chunks": len(chunks),
                "resume_at": offset,
                "batch_id": batch_id,
            }
        )
    )
    if args.dry_run:
        return

    load_dotenv(BACKEND_ROOT / ".env")
    vector_index = os.getenv(
        "CLOUDFLARE_LEGAL_VECTORIZE_INDEX", "parcha-legal-provisions"
    )
    config = replace(
        CloudflareConfig.from_environment(), vectorize_index=vector_index
    )
    api = CloudflareAPI(config)

    send_statements(api, document_statements(documents))
    send_statements(api, unit_statements(units))

    selected_end = len(chunks)
    if args.limit is not None:
        selected_end = min(len(chunks), offset + args.limit)
    processed = offset
    while processed < selected_end:
        end = min(selected_end, processed + VECTOR_GROUP_SIZE)
        chunk_group = chunks[processed:end]
        vector_group = vectors[processed:end]
        send_statements(api, chunk_statements(chunk_group))
        api.upsert_vector_records(
            [
                {
                    "id": chunk["id"],
                    "values": vector.astype(float).tolist(),
                    "metadata": {
                        "document_id": chunk["document_id"],
                        "unit_id": chunk["unit_id"],
                        "source_kind": chunk["source_kind"],
                        "unit_kind": chunk["unit_kind"],
                        "unit_number": str(chunk["unit_number"])[:200],
                        "language": chunk["language"],
                        "corpus_version": corpus_version,
                    },
                }
                for chunk, (vector_id, vector) in zip(
                    chunk_group, vector_group, strict=True
                )
                if vector_id == chunk["id"]
            ]
        )
        processed = end
        save_checkpoint(args.checkpoint, batch_id, processed)
        api.d1_batch(
            [
                progress_statement(
                    batch_id=batch_id,
                    corpus_version=corpus_version,
                    document_count=len(documents),
                    unit_count=len(units),
                    chunk_count=processed,
                    vector_count=processed,
                    status="complete" if processed == len(chunks) else "running",
                )
            ]
        )
        print(
            json.dumps(
                {
                    "event": "legal_corpus.uploaded",
                    "processed": processed,
                    "total": len(chunks),
                }
            )
        )


if __name__ == "__main__":
    main()
