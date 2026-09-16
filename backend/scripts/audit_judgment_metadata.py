"""Fetch and audit authoritative judgment metadata without changing production.

The output is JSONL: one row per manifest judgment, including the current
manifest values, parsed upstream fields, and validation status.  Cached source
JSON makes repeated audits cheap and reviewable.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import json
import os
from pathlib import Path
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from judgment_metadata import (
    parse_opening_page,
    parse_upstream_metadata,
    reconcile_with_opening_page,
)


DEFAULT_BATCH_ROOT = Path("/home/shauray/judgment-ocr-data/r2-batches")
DEFAULT_CACHE = Path("/tmp/parcha-upstream-metadata-cache")
DEFAULT_OUTPUT = Path("/tmp/parcha-judgment-metadata-audit.jsonl")
SOURCE_BASE = "https://indian-supreme-court-judgments.s3.amazonaws.com/"


def manifests(root: Path) -> list[Path]:
    return sorted(root.glob("batch-*/manifest.jsonl"))


def records(paths: list[Path], sample_ids: set[str], limit: int | None) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for path in paths:
        with path.open("rt", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                record = json.loads(line)
                if sample_ids and record.get("sample_id") not in sample_ids:
                    continue
                record["_manifest"] = str(path)
                record["_line"] = line_number
                result.append(record)
                if limit is not None and len(result) >= limit:
                    return result
    return result


def cache_path(cache_root: Path, metadata_key: str) -> Path:
    relative = Path(metadata_key)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Unsafe metadata key: {metadata_key}")
    return cache_root / relative


def fetch_json(metadata_key: str, cache_root: Path, attempts: int = 4) -> dict[str, Any]:
    cached = cache_path(cache_root, metadata_key)
    if cached.is_file():
        return json.loads(cached.read_text(encoding="utf-8"))

    url = SOURCE_BASE + quote(metadata_key, safe="/")
    request = Request(url, headers={"User-Agent": "ParchaMetadataAudit/1.0"})
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=45) as response:
                payload = json.load(response)
            cached.parent.mkdir(parents=True, exist_ok=True)
            temporary = cached.with_suffix(cached.suffix + ".tmp")
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            temporary.replace(cached)
            return payload
        except HTTPError as exc:
            if exc.code != 429 and not 500 <= exc.code < 600:
                raise
            if attempt == attempts - 1:
                raise
        except URLError:
            if attempt == attempts - 1:
                raise
        time.sleep(min(2**attempt, 12))
    raise AssertionError("unreachable")


def audit(record: dict[str, Any], cache_root: Path) -> dict[str, Any]:
    judgment_id = record.get("sample_id")
    metadata_key = record.get("metadata_key")
    base = {
        "judgment_id": judgment_id,
        "metadata_key": metadata_key,
        "manifest": record.get("_manifest"),
        "manifest_line": record.get("_line"),
        "current": {
            "judge": record.get("judge"),
            "author_judge": record.get("author_judge"),
            "cnr": record.get("cnr"),
        },
    }
    if not isinstance(metadata_key, str) or not metadata_key:
        return {**base, "parsed": None, "fetch_error": "missing_metadata_key"}
    try:
        upstream = parse_upstream_metadata(fetch_json(metadata_key, cache_root))
        opening = None
        manifest = record.get("_manifest")
        if isinstance(manifest, str) and isinstance(judgment_id, str):
            document = Path(manifest).parent / "final" / "documents" / f"{judgment_id}.json.gz"
            if document.is_file():
                with gzip.open(document, "rt", encoding="utf-8") as handle:
                    source = json.load(handle)
                pages = source.get("pages") if isinstance(source, dict) else None
                if isinstance(pages, list):
                    opening_text = "\n".join(
                        page.get("text", "")
                        for page in pages[:2]
                        if isinstance(page, dict) and isinstance(page.get("text"), str)
                    )
                    opening = parse_opening_page(opening_text)
        parsed = reconcile_with_opening_page(upstream, opening) if opening else upstream
        return {
            **base,
            "parsed": parsed.to_dict(),
            "upstream_parsed": upstream.to_dict(),
            "ocr_opening": (
                {
                    "judges": list(opening.judges),
                    "author_judges": list(opening.author_judges),
                    "case_number": opening.case_number,
                }
                if opening
                else None
            ),
            "source_url": SOURCE_BASE + quote(metadata_key, safe="/"),
            "cnr_matches_manifest": not parsed.cnr or parsed.cnr == record.get("cnr"),
        }
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        return {**base, "parsed": None, "fetch_error": f"{type(exc).__name__}: {exc}"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-root", type=Path, default=DEFAULT_BATCH_ROOT)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--sample-id", action="append", default=[])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    paths = manifests(args.batch_root)
    if not paths:
        raise SystemExit(f"No manifests found under {args.batch_root}")
    selected = records(paths, set(args.sample_id), args.limit)
    if not selected:
        raise SystemExit("No matching manifest records")
    if args.workers < 1 or args.workers > 32:
        raise SystemExit("--workers must be between 1 and 32")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    counts: dict[str, int] = {}
    with args.output.open("wt", encoding="utf-8") as output:
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            for index, result in enumerate(
                executor.map(lambda row: audit(row, args.cache_dir), selected), 1
            ):
                output.write(json.dumps(result, ensure_ascii=False) + "\n")
                status = (
                    result.get("parsed", {}).get("status")
                    if isinstance(result.get("parsed"), dict)
                    else "fetch_error"
                )
                counts[str(status)] = counts.get(str(status), 0) + 1
                if index % 500 == 0:
                    print(
                        json.dumps(
                            {
                                "event": "audit.progress",
                                "processed": index,
                                "total": len(selected),
                            }
                        )
                    )

    print(
        json.dumps(
            {
                "event": "audit.complete",
                "records": len(selected),
                "counts": counts,
                "output": str(args.output),
                "cache": str(args.cache_dir),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
