"""Resumably upload finalized OCR chunks to Cloudflare D1 and Vectorize.

The source chunk stream and NPZ vector shards must be in identical ID order.
Each checkpoint advances only after both D1 and Vectorize accept a group, so a
retry is safe: D1 chunk inserts ignore existing IDs and Vectorize uses upsert.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
import gzip
import json
import mimetypes
import os
from pathlib import Path
import time
from typing import Any
import urllib.error
import urllib.request
import uuid

import numpy as np
from dotenv import load_dotenv


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BATCH_ROOT = Path("/home/shauray/judgment-ocr-data/r2-batches")
DEFAULT_CHECKPOINT = BACKEND_ROOT / ".cloudflare-ingest-checkpoint.json"
VECTOR_DIMENSIONS = 384
VECTOR_GROUP_SIZE = 5_000
D1_ROWS_PER_STATEMENT = 10
D1_STATEMENTS_PER_REQUEST = 100


@dataclass(frozen=True)
class CloudflareConfig:
    account_id: str
    api_token: str
    d1_database_id: str
    vectorize_index: str

    @classmethod
    def from_environment(cls) -> "CloudflareConfig":
        load_dotenv(BACKEND_ROOT / ".env")
        values = {
            "account_id": os.getenv("CLOUDFLARE_ACCOUNT_ID", ""),
            "api_token": os.getenv("CLOUDFLARE_API_TOKEN", ""),
            "d1_database_id": os.getenv("CLOUDFLARE_D1_DATABASE_ID", ""),
            "vectorize_index": os.getenv("CLOUDFLARE_VECTORIZE_INDEX", ""),
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise RuntimeError("Missing Cloudflare settings: " + ", ".join(missing))
        return cls(**values)


@dataclass(frozen=True)
class SourceRow:
    chunk: dict[str, Any]
    vector: np.ndarray


class CloudflareAPI:
    def __init__(self, config: CloudflareConfig) -> None:
        self.config = config
        self.account_base = (
            f"https://api.cloudflare.com/client/v4/accounts/{config.account_id}"
        )
        self.headers = {
            "Authorization": f"Bearer {config.api_token}",
            "Content-Type": "application/json",
        }

    def _request(
        self,
        method: str,
        url: str,
        *,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
        attempts: int = 6,
    ) -> dict[str, Any]:
        request_headers = dict(self.headers)
        if headers:
            request_headers.update(headers)
        for attempt in range(attempts):
            request = urllib.request.Request(
                url, data=body, headers=request_headers, method=method
            )
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    payload = json.load(response)
                if not payload.get("success", False):
                    raise RuntimeError("Cloudflare API returned success=false")
                return payload
            except urllib.error.HTTPError as exc:
                retryable = exc.code == 429 or 500 <= exc.code < 600
                if not retryable or attempt == attempts - 1:
                    try:
                        payload = json.load(exc)
                        errors = payload.get("errors") or []
                        message = errors[0].get("message") if errors else None
                    except Exception:
                        message = None
                    raise RuntimeError(
                        f"Cloudflare API HTTP {exc.code}: {message or exc.reason}"
                    ) from exc
            except urllib.error.URLError as exc:
                if attempt == attempts - 1:
                    raise RuntimeError("Cloudflare API network failure") from exc
            time.sleep(min(2**attempt, 20))
        raise AssertionError("unreachable")

    def d1_batch(self, statements: Sequence[dict[str, Any]]) -> None:
        if not statements:
            return
        url = (
            f"{self.account_base}/d1/database/"
            f"{self.config.d1_database_id}/query"
        )
        payload = self._request(
            "POST",
            url,
            body=json.dumps({"batch": list(statements)}, ensure_ascii=False).encode(),
        )
        results = payload.get("result") or []
        if len(results) != len(statements) or not all(
            item.get("success", False) for item in results
        ):
            raise RuntimeError("One or more D1 batch statements failed")

    def upsert_vectors(self, rows: Sequence[SourceRow], batch_id: str) -> None:
        lines: list[str] = []
        for row in rows:
            chunk = row.chunk
            metadata: dict[str, Any] = {
                "judgment_id": chunk["sample_id"],
                "batch_id": batch_id,
                "pdf_page": chunk["pdf_page"],
            }
            decision_year = chunk.get("decision_year")
            if isinstance(decision_year, int):
                metadata["decision_year"] = decision_year
            lines.append(
                json.dumps(
                    {
                        "id": chunk["id"],
                        "values": row.vector.astype(float).tolist(),
                        "metadata": metadata,
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
            )
        ndjson = ("\n".join(lines) + "\n").encode()
        boundary = "----parcha-" + uuid.uuid4().hex
        filename = "vectors.ndjson"
        content_type = mimetypes.guess_type(filename)[0] or "application/x-ndjson"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="vectors"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode() + ndjson + f"\r\n--{boundary}--\r\n".encode()
        url = (
            f"{self.account_base}/vectorize/v2/indexes/"
            f"{self.config.vectorize_index}/upsert"
        )
        payload = self._request(
            "POST",
            url,
            body=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        result = payload.get("result") or {}
        accepted_count = result.get("count")
        if accepted_count is not None and accepted_count != len(rows):
            raise RuntimeError(
                f"Vectorize accepted {accepted_count} vectors; expected {len(rows)}"
            )
        if accepted_count is None and not result.get("mutationId"):
            raise RuntimeError("Vectorize returned neither a count nor a mutation ID")


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid JSON at {path}:{line_number}") from exc


def read_chunks(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid JSON at {path}:{line_number}") from exc


def read_vectors(shards_dir: Path) -> Iterator[tuple[str, np.ndarray]]:
    shard_paths = sorted(shards_dir.glob("*.npz"))
    if not shard_paths:
        raise FileNotFoundError(f"No NPZ shards found in {shards_dir}")
    for shard_path in shard_paths:
        with np.load(shard_path, allow_pickle=False) as shard:
            ids = shard["ids"]
            vectors = np.asarray(shard["vectors"], dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape != (len(ids), VECTOR_DIMENSIONS):
            raise ValueError(f"Invalid vector shape in {shard_path}: {vectors.shape}")
        if not np.isfinite(vectors).all():
            raise ValueError(f"Non-finite vector found in {shard_path}")
        for chunk_id, vector in zip(ids, vectors, strict=True):
            norm = float(np.linalg.norm(vector))
            if not np.isfinite(norm) or norm == 0:
                raise ValueError(f"Invalid vector norm for {chunk_id}")
            if abs(norm - 1.0) > 1e-3:
                vector = vector / norm
            yield str(chunk_id), vector


def source_rows(batch_dir: Path, offset: int) -> Iterator[SourceRow]:
    chunks = read_chunks(batch_dir / "final" / "chunks.jsonl.gz")
    vectors = read_vectors(batch_dir / "embeddings" / "shards")
    for index, (chunk, (vector_id, vector)) in enumerate(zip(chunks, vectors, strict=True)):
        if chunk.get("id") != vector_id:
            raise ValueError(
                f"Chunk/vector mismatch at index {index}: {chunk.get('id')} != {vector_id}"
            )
        if index >= offset:
            yield SourceRow(chunk=chunk, vector=vector)


def groups(rows: Iterable[SourceRow], size: int) -> Iterator[list[SourceRow]]:
    group: list[SourceRow] = []
    for row in rows:
        group.append(row)
        if len(group) == size:
            yield group
            group = []
    if group:
        yield group


def load_checkpoint(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(key): int(value) for key, value in data.items()}


def save_checkpoint(path: Path, checkpoint: dict[str, int]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(checkpoint, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def manifest_judgments(path: Path) -> dict[str, dict[str, Any]]:
    return {str(row["sample_id"]): row for row in read_jsonl(path)}


def judgment_statements(
    rows: Sequence[SourceRow], manifest: dict[str, dict[str, Any]], batch_id: str
) -> list[dict[str, Any]]:
    unique_ids = dict.fromkeys(str(row.chunk["sample_id"]) for row in rows)
    sql = """
        INSERT INTO judgments(
            id, title, citation, decision_date, decision_year, judge,
            court, pdf_url, pdf_key, batch_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,
            citation=excluded.citation,
            decision_date=excluded.decision_date,
            decision_year=excluded.decision_year,
            judge=excluded.judge,
            court=excluded.court,
            pdf_url=excluded.pdf_url,
            pdf_key=excluded.pdf_key,
            batch_id=excluded.batch_id
    """
    statements: list[dict[str, Any]] = []
    for judgment_id in unique_ids:
        item = manifest.get(judgment_id)
        if item is None:
            raise ValueError(f"Judgment {judgment_id} is missing from the manifest")
        statements.append(
            {
                "sql": sql,
                "params": [
                    judgment_id,
                    item.get("title") or "",
                    item.get("citation"),
                    item.get("decision_date"),
                    item.get("decision_year"),
                    item.get("judge"),
                    item.get("court") or "Supreme Court of India",
                    item.get("pdf_url") or "",
                    item.get("pdf_key"),
                    batch_id,
                ],
            }
        )
    return statements


def chunk_statements(rows: Sequence[SourceRow], batch_id: str) -> list[dict[str, Any]]:
    statements: list[dict[str, Any]] = []
    for start in range(0, len(rows), D1_ROWS_PER_STATEMENT):
        subset = rows[start : start + D1_ROWS_PER_STATEMENT]
        placeholders = ",".join(["(?, ?, ?, ?, ?, ?, ?, ?, ?)"] * len(subset))
        params: list[Any] = []
        for row in subset:
            chunk = row.chunk
            params.extend(
                [
                    chunk["id"],
                    chunk["sample_id"],
                    chunk["pdf_page"],
                    chunk["paragraph_index"],
                    chunk.get("paragraph_number"),
                    chunk["part_index"],
                    chunk["text"],
                    chunk["text_source"],
                    batch_id,
                ]
            )
        statements.append(
            {
                "sql": (
                    "INSERT INTO chunks("
                    "id, judgment_id, pdf_page, paragraph_index, paragraph_number, "
                    "part_index, text, text_source, batch_id"
                    f") VALUES {placeholders} ON CONFLICT(id) DO NOTHING"
                ),
                "params": params,
            }
        )
    return statements


def send_d1_statements(api: CloudflareAPI, statements: Sequence[dict[str, Any]]) -> None:
    for start in range(0, len(statements), D1_STATEMENTS_PER_REQUEST):
        api.d1_batch(statements[start : start + D1_STATEMENTS_PER_REQUEST])


def update_remote_progress(
    api: CloudflareAPI, batch_id: str, offset: int, complete: bool
) -> None:
    api.d1_batch(
        [
            {
                "sql": """
                    INSERT INTO ingestion_batches(
                        batch_id, chunk_count, vector_count, status, updated_at
                    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(batch_id) DO UPDATE SET
                        chunk_count=excluded.chunk_count,
                        vector_count=excluded.vector_count,
                        status=excluded.status,
                        updated_at=CURRENT_TIMESTAMP
                """,
                "params": [batch_id, offset, offset, "complete" if complete else "running"],
            }
        ]
    )


def ingest_batch(
    api: CloudflareAPI,
    batch_root: Path,
    batch_id: str,
    checkpoint_path: Path,
    checkpoint: dict[str, int],
    limit: int | None,
) -> int:
    batch_dir = batch_root / batch_id
    manifest_path = batch_dir / "manifest.jsonl"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Missing manifest: {manifest_path}")
    manifest = manifest_judgments(manifest_path)
    offset = checkpoint.get(batch_id, 0)
    processed = 0
    stream: Iterable[SourceRow] = source_rows(batch_dir, offset)

    for row_group in groups(stream, VECTOR_GROUP_SIZE):
        if limit is not None:
            remaining = limit - processed
            if remaining <= 0:
                break
            row_group = row_group[:remaining]
        if not row_group:
            break

        send_d1_statements(api, judgment_statements(row_group, manifest, batch_id))
        send_d1_statements(api, chunk_statements(row_group, batch_id))
        api.upsert_vectors(row_group, batch_id)

        offset += len(row_group)
        processed += len(row_group)
        checkpoint[batch_id] = offset
        save_checkpoint(checkpoint_path, checkpoint)
        update_remote_progress(api, batch_id, offset, complete=False)
        print(f"[{batch_id}] uploaded {offset:,} chunks/vectors")

        if limit is not None and processed >= limit:
            break

    complete = limit is None
    update_remote_progress(api, batch_id, offset, complete=complete)
    return processed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--batch-root",
        type=Path,
        default=Path(os.getenv("CLOUDFLARE_BATCH_ROOT", DEFAULT_BATCH_ROOT)),
    )
    parser.add_argument("--batch-id", action="append", dest="batch_ids")
    parser.add_argument("--limit", type=int, help="Maximum rows per selected batch")
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.limit is not None and args.limit <= 0:
        raise SystemExit("--limit must be positive")
    if args.batch_ids:
        batch_ids = args.batch_ids
    else:
        batch_ids = sorted(
            path.name
            for path in args.batch_root.iterdir()
            if path.is_dir() and (path / "completion" / "COMPLETE.json").is_file()
        )
    if not batch_ids:
        raise SystemExit("No completed batches found")

    checkpoint = load_checkpoint(args.checkpoint)
    api = CloudflareAPI(CloudflareConfig.from_environment())
    total = 0
    for batch_id in batch_ids:
        total += ingest_batch(
            api,
            args.batch_root,
            batch_id,
            args.checkpoint,
            checkpoint,
            args.limit,
        )
    print(f"Uploaded {total:,} chunks/vectors in this run")


if __name__ == "__main__":
    main()
