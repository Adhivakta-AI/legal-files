"""Render PDF pages and persist OCR candidates without altering source PDFs."""

from __future__ import annotations

import gzip
import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any

import pymupdf
from PIL import Image

from judgment_ocr.engines import create_engines
from judgment_ocr.postprocess import clean_layout_text, clean_spatial_candidate
from judgment_ocr.quality import text_metrics

LOGGER = logging.getLogger(__name__)
SCHEMA_VERSION = 2


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _load_embedded_page(extraction_root: Path, task: dict[str, Any]) -> dict[str, Any]:
    path = extraction_root / task["extraction_relative_path"]
    with gzip.open(path, "rt", encoding="utf-8") as input_file:
        record = json.load(input_file)
    if record["source_sha256"] != task["source_sha256"]:
        raise ValueError(f"Source changed for {task['sample_id']}")
    return record["pages"][int(task["pdf_page"]) - 1]


def _render_page(pdf_path: Path, page_number: int, dpi: int) -> Image.Image:
    with pymupdf.open(pdf_path) as document:
        page = document[page_number - 1]
        pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
    return Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)


def _result_path(output_root: Path, task: dict[str, Any]) -> Path:
    return (
        output_root
        / "pages"
        / task["sample_id"]
        / f"page-{int(task['pdf_page']):04d}.json.gz"
    )


def _write_gzip_json(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    with gzip.open(temporary_path, "wt", encoding="utf-8") as output_file:
        json.dump(record, output_file, ensure_ascii=False)
    temporary_path.replace(path)


def _can_reuse(
    path: Path, task: dict[str, Any], dpi: int, engine_names: list[str]
) -> bool:
    try:
        with gzip.open(path, "rt", encoding="utf-8") as input_file:
            record = json.load(input_file)
    except (OSError, json.JSONDecodeError, KeyError):
        return False

    candidates = record.get("candidates", [])
    return (
        record.get("schema_version") == SCHEMA_VERSION
        and record.get("task", {}).get("source_sha256") == task["source_sha256"]
        and record.get("render", {}).get("dpi") == dpi
        and [candidate.get("engine") for candidate in candidates] == engine_names
        and all("error" not in candidate for candidate in candidates)
    )


def run_tasks(
    tasks_path: Path,
    pdf_root: Path,
    extraction_root: Path,
    output_root: Path,
    engine_names: list[str],
    device: str,
    dpi: int,
    force: bool,
    max_pages: int | None,
    worker_id: str | None = None,
) -> dict[str, Any]:
    tasks = _load_jsonl(tasks_path)
    if max_pages is not None:
        tasks = tasks[:max_pages]
    engines = create_engines(engine_names, device)
    counts: Counter[str] = Counter()

    for position, task in enumerate(tasks, start=1):
        destination = _result_path(output_root, task)
        if not force and _can_reuse(destination, task, dpi, engine_names):
            counts["reused"] += 1
            continue

        LOGGER.info(
            "Processing %s page %s (%s/%s)",
            task["sample_id"],
            task["pdf_page"],
            position,
            len(tasks),
        )
        pdf_path = pdf_root / task["pdf_relative_path"]
        if not pdf_path.is_file():
            raise FileNotFoundError(pdf_path)
        embedded_page = _load_embedded_page(extraction_root, task)
        image = _render_page(pdf_path, int(task["pdf_page"]), dpi)

        candidates = []
        for engine in engines:
            try:
                candidate = engine.recognize(image)
                candidates.append(clean_spatial_candidate(candidate, image.width))
            except Exception as error:  # Keep the other engine's useful result.
                LOGGER.exception("%s failed for %s", engine.name, task["sample_id"])
                candidates.append(
                    {
                        "engine": engine.name,
                        "error": f"{type(error).__name__}: {error}",
                    }
                )
                counts[f"{engine.name}_failed"] += 1

        embedded_text, embedded_markers = clean_layout_text(embedded_page["text"])
        embedded = {
            "text": embedded_text,
            "metrics": text_metrics(embedded_text),
        }
        if embedded_markers:
            embedded["raw_text"] = embedded_page["text"]
            embedded["removed_margin_markers"] = embedded_markers

        record = {
            "schema_version": SCHEMA_VERSION,
            "task": task,
            "render": {
                "dpi": dpi,
                "width_pixels": image.width,
                "height_pixels": image.height,
            },
            "embedded": embedded,
            "candidates": candidates,
            "selection": None,
            "review_required": True,
        }
        _write_gzip_json(destination, record)
        counts["processed"] += 1

    summary = {
        "task_count": len(tasks),
        "dpi": dpi,
        "device": device,
        "engines": engine_names,
        "counts": dict(sorted(counts.items())),
    }
    output_root.mkdir(parents=True, exist_ok=True)
    summary_name = f"run-summary-{worker_id}.json" if worker_id else "run-summary.json"
    (output_root / summary_name).write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary
