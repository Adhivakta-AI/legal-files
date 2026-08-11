"""Portable batch preparation and verification for multi-machine OCR runs."""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import os
import uuid
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import pymupdf

from judgment_ocr.quality import text_metrics

LOGGER = logging.getLogger(__name__)
EXTRACTION_SCHEMA_VERSION = 2
MIN_TEXT_CHARS = 40
FULL_PAGE_IMAGE_RATIO = 0.8
GOOD_OCR_SCORE = 0.95
DOWNLOAD_CHUNK_SIZE = 1024 * 1024


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records = [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not records:
        raise ValueError(f"No records found in {path}")
    return records


def _pdf_relative_path(record: dict[str, Any]) -> Path:
    key = str(record.get("pdf_key", ""))
    if key.startswith("data/pdf/"):
        return Path(key.removeprefix("data/pdf/"))
    return Path(f"year={int(record['storage_year'])}") / Path(key).name


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as input_file:
        for chunk in iter(lambda: input_file.read(DOWNLOAD_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_one(record: dict[str, Any], pdf_root: Path) -> dict[str, Any]:
    destination = pdf_root / _pdf_relative_path(record)
    expected_size = int(record.get("pdf_size_bytes") or 0)
    if destination.is_file() and (
        not expected_size or destination.stat().st_size == expected_size
    ):
        return {
            "sample_id": record["sample_id"],
            "local_path": str(destination),
            "size_bytes": destination.stat().st_size,
            "sha256": _file_sha256(destination),
            "status": "reused",
            "error": None,
        }

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.part")
    digest = hashlib.sha256()
    size = 0
    try:
        request = Request(
            str(record["pdf_url"]),
            headers={"User-Agent": "judgment-search-ocr/1.0"},
        )
        with urlopen(request, timeout=120) as response, temporary.open("wb") as output:
            while chunk := response.read(DOWNLOAD_CHUNK_SIZE):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if expected_size and size != expected_size:
            raise ValueError(f"Expected {expected_size} bytes, downloaded {size}")
        os.replace(temporary, destination)
        return {
            "sample_id": record["sample_id"],
            "local_path": str(destination),
            "size_bytes": size,
            "sha256": digest.hexdigest(),
            "status": "downloaded",
            "error": None,
        }
    except Exception as error:
        temporary.unlink(missing_ok=True)
        return {
            "sample_id": record["sample_id"],
            "local_path": str(destination),
            "size_bytes": None,
            "sha256": None,
            "status": "failed",
            "error": f"{type(error).__name__}: {error}",
        }


def download_batch(
    manifest_path: Path, pdf_root: Path, audit_root: Path, workers: int
) -> dict[str, Any]:
    if workers < 1:
        raise ValueError("workers must be positive")
    records = load_jsonl(manifest_path)
    sample_ids = [str(record["sample_id"]) for record in records]
    if len(sample_ids) != len(set(sample_ids)):
        raise ValueError("Manifest sample IDs must be unique")

    results = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(_download_one, record, pdf_root): record
            for record in records
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            result = future.result()
            results.append(result)
            if result["status"] == "failed":
                LOGGER.error("%s: %s", result["sample_id"], result["error"])
            if completed % 25 == 0 or completed == len(records):
                LOGGER.info("Downloaded or reused %s/%s PDFs", completed, len(records))

    results.sort(key=lambda item: str(item["sample_id"]))
    audit_root.mkdir(parents=True, exist_ok=True)
    downloads_path = audit_root / "downloads.jsonl"
    with downloads_path.open("w", encoding="utf-8") as output_file:
        for result in results:
            output_file.write(json.dumps(result, ensure_ascii=True) + "\n")
    counts = Counter(str(result["status"]) for result in results)
    summary = {
        "completed_at": datetime.now(UTC).isoformat(),
        "documents": len(records),
        "counts": dict(sorted(counts.items())),
        "verified_bytes": sum(int(result["size_bytes"] or 0) for result in results),
        "downloads_path": str(downloads_path),
    }
    (audit_root / "download-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    if counts["failed"]:
        raise RuntimeError(f"{counts['failed']} PDF downloads failed")
    return summary


def _image_coverage(page: pymupdf.Page) -> float:
    page_area = page.rect.get_area()
    if not page_area:
        return 0.0
    maximum = 0.0
    seen_xrefs = set()
    for image in page.get_images(full=True):
        xref = image[0]
        if xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)
        for rectangle in page.get_image_rects(xref):
            intersection = rectangle & page.rect
            if not intersection.is_empty:
                maximum = max(maximum, intersection.get_area() / page_area)
    return min(maximum, 1.0)


def _page_fonts(page: pymupdf.Page) -> tuple[list[str], bool]:
    fonts = {
        str(span["font"])
        for block in page.get_text("dict").get("blocks", [])
        for line in block.get("lines", [])
        for span in line.get("spans", [])
        if span.get("font")
    }
    ordered = sorted(fonts)
    return ordered, any("ocr" in font.lower() for font in ordered)


def _classify_pages(pages: list[dict[str, Any]]) -> str:
    missing = sum(int(page["text_chars"]) < MIN_TEXT_CHARS for page in pages)
    scanned = sum(bool(page["is_full_page_scan"]) for page in pages)
    document_score = float(
        text_metrics("\n".join(str(page["text"]) for page in pages))["quality_score"]
    )
    if missing == len(pages):
        return "ocr_required"
    if scanned:
        if document_score < GOOD_OCR_SCORE:
            return "reocr_recommended"
        if missing:
            return "selective_ocr_required"
        return "existing_ocr_usable"
    return "selective_ocr_required" if missing else "digital_text"


def _extract_one(
    manifest_record: dict[str, Any],
    download: dict[str, Any],
    extraction_root: Path,
) -> tuple[dict[str, Any], bool]:
    destination = (
        extraction_root
        / "documents"
        / f"{manifest_record['sample_id']}.json.gz"
    )
    source_sha256 = str(download["sha256"])
    if destination.is_file():
        try:
            with gzip.open(destination, "rt", encoding="utf-8") as input_file:
                existing = json.load(input_file)
            if (
                existing.get("schema_version") == EXTRACTION_SCHEMA_VERSION
                and existing.get("source_sha256") == source_sha256
            ):
                return existing, True
        except (OSError, json.JSONDecodeError):
            pass

    pages = []
    with pymupdf.open(download["local_path"]) as pdf:
        for index, page in enumerate(pdf):
            text = page.get_text("text", sort=True)
            fonts, hidden_ocr = _page_fonts(page)
            coverage = _image_coverage(page)
            pages.append(
                {
                    "pdf_page": index + 1,
                    "width_points": round(page.rect.width, 3),
                    "height_points": round(page.rect.height, 3),
                    "rotation": page.rotation,
                    "max_image_coverage": round(coverage, 6),
                    "is_full_page_scan": coverage >= FULL_PAGE_IMAGE_RATIO,
                    "has_hidden_ocr_font": hidden_ocr,
                    "fonts": fonts,
                    **text_metrics(text),
                    "text": text,
                }
            )
    if not pages:
        raise ValueError(f"PDF has no pages: {download['local_path']}")
    route = _classify_pages(pages)
    for page in pages:
        if int(page["text_chars"]) < MIN_TEXT_CHARS:
            page["ocr_action"] = "ocr"
        elif route == "reocr_recommended" and page["is_full_page_scan"]:
            page["ocr_action"] = "reocr"
        else:
            page["ocr_action"] = "keep"

    record = {
        "schema_version": EXTRACTION_SCHEMA_VERSION,
        "sample_id": manifest_record["sample_id"],
        "era": manifest_record.get("era", "unknown"),
        "decision_year": int(manifest_record["decision_year"]),
        "path": manifest_record.get("path"),
        "pdf_url": manifest_record["pdf_url"],
        "local_path": str(download["local_path"]),
        "source_sha256": source_sha256,
        "page_count": len(pages),
        "document_route": route,
        "pages": pages,
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".json.gz.tmp")
    with gzip.open(temporary, "wt", encoding="utf-8") as output_file:
        json.dump(record, output_file, ensure_ascii=True)
    temporary.replace(destination)
    return record, False


def extract_batch(
    manifest_path: Path,
    downloads_path: Path,
    extraction_root: Path,
    workers: int,
) -> dict[str, Any]:
    if workers < 1:
        raise ValueError("workers must be positive")
    manifest = load_jsonl(manifest_path)
    downloads = {
        str(record["sample_id"]): record for record in load_jsonl(downloads_path)
    }
    missing = [
        str(record["sample_id"])
        for record in manifest
        if str(record["sample_id"]) not in downloads
        or downloads[str(record["sample_id"])]["status"] == "failed"
    ]
    if missing:
        raise ValueError(f"Missing successful downloads for {len(missing)} documents")

    results = []
    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(
                _extract_one,
                record,
                downloads[str(record["sample_id"])],
                extraction_root,
            ): record
            for record in manifest
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            record, reused = future.result()
            results.append((record, reused))
            if completed % 25 == 0 or completed == len(manifest):
                LOGGER.info(
                    "Extracted or reused %s/%s documents", completed, len(manifest)
                )

    routes = Counter(str(record["document_route"]) for record, _ in results)
    actions = Counter(
        str(page["ocr_action"])
        for record, _ in results
        for page in record["pages"]
    )
    summary = {
        "completed_at": datetime.now(UTC).isoformat(),
        "schema_version": EXTRACTION_SCHEMA_VERSION,
        "documents": len(results),
        "documents_reused": sum(reused for _, reused in results),
        "pages": sum(len(record["pages"]) for record, _ in results),
        "document_routes": dict(sorted(routes.items())),
        "page_actions": dict(sorted(actions.items())),
        "pages_requiring_ocr": actions["ocr"] + actions["reocr"],
    }
    extraction_root.mkdir(parents=True, exist_ok=True)
    (extraction_root / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary


def partition_tasks(
    tasks_path: Path, output_root: Path, workers: int
) -> dict[str, Any]:
    if workers < 1:
        raise ValueError("workers must be positive")
    tasks = [
        json.loads(line)
        for line in tasks_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    tasks.sort(key=lambda item: (str(item["sample_id"]), int(item["pdf_page"])))
    partitions = [[] for _ in range(workers)]
    for index, task in enumerate(tasks):
        partitions[index % workers].append(task)

    output_root.mkdir(parents=True, exist_ok=True)
    paths = []
    for index, partition in enumerate(partitions, start=1):
        path = output_root / f"part-{index:02d}.jsonl"
        with path.open("w", encoding="utf-8") as output_file:
            for task in partition:
                output_file.write(json.dumps(task, ensure_ascii=False) + "\n")
        paths.append(str(path))
    summary = {
        "task_count": len(tasks),
        "workers": workers,
        "partition_counts": [len(partition) for partition in partitions],
        "paths": paths,
    }
    (output_root / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary


def verify_batch(
    manifest_path: Path,
    extraction_root: Path,
    final_root: Path,
    output_root: Path,
) -> dict[str, Any]:
    manifest = load_jsonl(manifest_path)
    manifest_ids = {str(record["sample_id"]) for record in manifest}
    if len(manifest_ids) != len(manifest):
        raise ValueError("Manifest sample IDs must be unique")
    final_summary = json.loads(
        (final_root / "summary.json").read_text(encoding="utf-8")
    )
    if int(final_summary["documents"]) != len(manifest):
        raise ValueError("Final document count does not match manifest")

    missing_documents = [
        sample_id
        for sample_id in sorted(manifest_ids)
        if not (final_root / "documents" / f"{sample_id}.json.gz").is_file()
    ]
    if missing_documents:
        raise ValueError(f"Missing {len(missing_documents)} finalized documents")

    chunks_path = final_root / "chunks.jsonl.gz"
    chunk_ids = set()
    chunk_count = 0
    with gzip.open(chunks_path, "rt", encoding="utf-8") as input_file:
        for line in input_file:
            if not line.strip():
                continue
            chunk = json.loads(line)
            chunk_id = str(chunk["id"])
            if chunk_id in chunk_ids:
                raise ValueError(f"Duplicate chunk ID: {chunk_id}")
            if str(chunk["sample_id"]) not in manifest_ids:
                raise ValueError(f"Unknown chunk sample ID: {chunk['sample_id']}")
            if int(chunk["pdf_page"]) < 1 or not str(chunk["pdf_url"]).startswith(
                "https://"
            ):
                raise ValueError(f"Invalid chunk citation: {chunk_id}")
            chunk_ids.add(chunk_id)
            chunk_count += 1
    if chunk_count != int(final_summary["chunks"]):
        raise ValueError("Chunk count does not match final summary")

    files = [
        manifest_path,
        extraction_root / "summary.json",
        final_root / "summary.json",
        chunks_path,
    ]
    files.extend(sorted((final_root / "documents").glob("*.json.gz")))
    output_root.mkdir(parents=True, exist_ok=True)
    checksums_path = output_root / "checksums.sha256"
    common_root = manifest_path.parent
    with checksums_path.open("w", encoding="utf-8") as output_file:
        for path in files:
            try:
                display_path = path.relative_to(common_root)
            except ValueError:
                display_path = path
            output_file.write(f"{_file_sha256(path)}  {display_path}\n")

    summary = {
        "schema_version": 1,
        "completed_at": datetime.now(UTC).isoformat(),
        "status": "complete",
        "documents": len(manifest),
        "pages": int(final_summary["pages"]),
        "chunks": chunk_count,
        "pages_by_source": final_summary["pages_by_source"],
        "pages_needing_review": int(final_summary["pages_needing_review"]),
        "git_commit": os.environ.get("GIT_COMMIT", "unknown"),
        "image_id": os.environ.get("OCR_IMAGE_ID", "unknown"),
        "checksums_path": str(checksums_path),
    }
    (output_root / "COMPLETE.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary
