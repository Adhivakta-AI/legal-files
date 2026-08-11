"""Generate portable, resumable embedding shards for finalized chunks."""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import math
from pathlib import Path
from typing import Any

import numpy as np

EMBEDDING_SCHEMA_VERSION = 1
DEFAULT_MODEL = "BAAI/bge-small-en-v1.5"
LOGGER = logging.getLogger(__name__)


def _read_chunks(path: Path) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as input_file:
        return [json.loads(line) for line in input_file if line.strip()]


def _sha256(path: Path) -> str:
    with path.open("rb") as input_file:
        return hashlib.file_digest(input_file, "sha256").hexdigest()


def _valid_shard(path: Path, expected_ids: list[str], dimensions: int) -> bool:
    if not path.is_file():
        return False
    try:
        with np.load(path, allow_pickle=False) as shard:
            ids = shard["ids"].tolist()
            vectors = shard["vectors"]
            return (
                ids == expected_ids
                and vectors.shape == (len(expected_ids), dimensions)
                and vectors.dtype == np.float32
                and np.isfinite(vectors).all()
            )
    except (OSError, ValueError, KeyError):
        return False


def embed_chunks(
    chunks_path: Path,
    output_root: Path,
    cache_dir: Path,
    model_name: str = DEFAULT_MODEL,
    dimensions: int = 384,
    shard_size: int = 1000,
    batch_size: int = 128,
    threads: int | None = None,
    parallel: int | None = None,
    device: str = "cpu",
) -> dict[str, Any]:
    chunks = _read_chunks(chunks_path)
    if len({chunk["id"] for chunk in chunks}) != len(chunks):
        raise ValueError("Chunk IDs must be unique")

    shards_root = output_root / "shards"
    shards_root.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    shard_count = math.ceil(len(chunks) / shard_size)
    processed = 0
    reused = 0
    pending: list[tuple[int, list[dict[str, Any]], list[str], Path]] = []

    for shard_index in range(shard_count):
        start = shard_index * shard_size
        selected = chunks[start : start + shard_size]
        ids = [str(chunk["id"]) for chunk in selected]
        destination = shards_root / f"part-{shard_index:05d}.npz"
        if _valid_shard(destination, ids, dimensions):
            LOGGER.info("Reusing embedding shard %s/%s", shard_index + 1, shard_count)
            reused += len(selected)
            continue
        pending.append((shard_index, selected, ids, destination))

    if pending:
        try:
            from fastembed import TextEmbedding
        except ImportError as error:
            raise RuntimeError(
                "Embedding dependencies are not installed. Run "
                "`uv sync --extra embedding-gpu`."
            ) from error

        providers = None
        if device == "cuda":
            import onnxruntime as ort

            ort.preload_dlls(directory="")
            providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        elif device != "cpu":
            raise ValueError(f"Unsupported embedding device: {device}")
        model = TextEmbedding(
            model_name=model_name,
            cache_dir=str(cache_dir),
            threads=threads,
            providers=providers,
        )
        documents = (
            str(chunk["text"]) for _, selected, _, _ in pending for chunk in selected
        )
        embedded = iter(
            model.embed(
                documents,
                batch_size=batch_size,
                parallel=parallel,
            )
        )

    for shard_index, selected, ids, destination in pending:
        LOGGER.info("Embedding shard %s/%s", shard_index + 1, shard_count)
        vectors = np.asarray(
            [next(embedded) for _ in selected],
            dtype=np.float32,
        )
        if vectors.shape != (len(selected), dimensions):
            raise ValueError(
                f"Unexpected embedding shape {vectors.shape}; "
                f"expected {(len(selected), dimensions)}"
            )
        if not np.isfinite(vectors).all():
            raise ValueError(f"Non-finite vectors in shard {shard_index}")

        temporary = destination.with_suffix(".npz.tmp")
        with temporary.open("wb") as output_file:
            np.savez(output_file, ids=np.asarray(ids), vectors=vectors)
        temporary.replace(destination)
        processed += len(selected)

    summary = {
        "schema_version": EMBEDDING_SCHEMA_VERSION,
        "model": model_name,
        "dimensions": dimensions,
        "dtype": "float32",
        "normalized": True,
        "device": device,
        "chunks_path": str(chunks_path),
        "chunks_sha256": _sha256(chunks_path),
        "chunk_count": len(chunks),
        "shard_size": shard_size,
        "shard_count": shard_count,
        "parallel_workers": parallel,
        "processed": processed,
        "reused": reused,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary
