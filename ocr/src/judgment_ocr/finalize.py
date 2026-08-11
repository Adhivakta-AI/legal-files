"""Build fallback tasks and canonical text artifacts for search ingestion."""

from __future__ import annotations

import gzip
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from judgment_ocr.postprocess import clean_layout_text, clean_spatial_candidate
from judgment_ocr.runner import _load_embedded_page, _load_jsonl, _result_path

FINAL_SCHEMA_VERSION = 1
NUMBERED_PARAGRAPH = re.compile(r"^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+")
ALPHABETIC_WORD = re.compile(r"[A-Za-z]{2,}")


def _read_result(root: Path, task: dict[str, Any]) -> dict[str, Any] | None:
    path = _result_path(root, task)
    if not path.is_file():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as input_file:
        result = json.load(input_file)
    if result.get("task", {}).get("source_sha256") != task["source_sha256"]:
        raise ValueError(f"OCR source changed for {task['sample_id']}")
    return result


def _candidate(result: dict[str, Any] | None, engine: str) -> dict[str, Any] | None:
    if not result:
        return None
    page_width = int(result.get("render", {}).get("width_pixels", 0))
    for value in result.get("candidates", []):
        if value.get("engine") == engine:
            return clean_spatial_candidate(value, page_width) if page_width else value
    return None


def fallback_reasons(
    candidate: dict[str, Any] | None, confidence_threshold: float
) -> list[str]:
    if candidate is None:
        return ["missing_tesseract_candidate"]
    if candidate.get("error"):
        return ["tesseract_error"]

    reasons = []
    text = str(candidate.get("text", "")).strip()
    confidence = candidate.get("mean_confidence")
    if len(text) < 40:
        reasons.append("too_little_text")
    if confidence is None:
        reasons.append("missing_confidence")
    else:
        confidence_value = float(confidence)
        if 0 < confidence_value <= 1:
            confidence_value *= 100
        if confidence_value < confidence_threshold:
            reasons.append("low_confidence")
    return reasons


def build_fallback_queue(
    tasks_path: Path,
    tesseract_root: Path,
    output_path: Path,
    confidence_threshold: float = 75.0,
) -> dict[str, Any]:
    tasks = _load_jsonl(tasks_path)
    selected = []
    missing_results = []
    reason_counts: Counter[str] = Counter()
    for task in tasks:
        result = _read_result(tesseract_root, task)
        if result is None:
            missing_results.append(
                f"{task['sample_id']}:page-{int(task['pdf_page']):04d}"
            )
            continue
        reasons = fallback_reasons(
            _candidate(result, "tesseract"), confidence_threshold
        )
        if reasons:
            selected.append({**task, "fallback_reasons": reasons})
            reason_counts.update(reasons)

    if missing_results:
        preview = ", ".join(missing_results[:5])
        raise ValueError(
            f"Tesseract run is incomplete: {len(missing_results)} results missing "
            f"({preview})"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as output_file:
        for task in selected:
            output_file.write(json.dumps(task, ensure_ascii=False) + "\n")
    return {
        "input_pages": len(tasks),
        "fallback_pages": len(selected),
        "fallback_rate": round(len(selected) / len(tasks), 6) if tasks else 0.0,
        "confidence_threshold": confidence_threshold,
        "reason_counts": dict(sorted(reason_counts.items())),
        "output": str(output_path),
    }


def _select_page_text(
    task: dict[str, Any],
    extraction_root: Path,
    tesseract_root: Path,
    paddle_root: Path | None,
) -> dict[str, Any]:
    embedded_page = _load_embedded_page(extraction_root, task)
    if task["ocr_action"] == "keep":
        text, removed = clean_layout_text(embedded_page["text"])
        return {
            "text": text,
            "source": "embedded",
            "confidence": None,
            "quality_score": embedded_page.get("quality_score"),
            "removed_margin_markers": removed,
            "needs_review": False,
        }

    tesseract_result = _read_result(tesseract_root, task)
    tesseract = _candidate(tesseract_result, "tesseract")
    paddle = (
        _candidate(_read_result(paddle_root, task), "paddle") if paddle_root else None
    )

    if tesseract and not tesseract.get("error"):
        chosen = tesseract
        source = "tesseract"
        confidence = tesseract.get("mean_confidence")
        tesseract_is_weak = bool(fallback_reasons(tesseract, confidence_threshold=75.0))
        if paddle and not paddle.get("error") and tesseract_is_weak:
            paddle_quality = float(paddle.get("metrics", {}).get("quality_score", 0))
            tesseract_quality = float(
                tesseract.get("metrics", {}).get("quality_score", 0)
            )
            if paddle_quality >= tesseract_quality - 0.03:
                chosen = paddle
                source = "paddle"
                confidence = paddle.get("mean_confidence")
    elif paddle and not paddle.get("error"):
        chosen = paddle
        source = "paddle"
        confidence = paddle.get("mean_confidence")
    else:
        raise ValueError(
            f"No successful OCR for {task['sample_id']} page {task['pdf_page']}"
        )

    return {
        "text": str(chosen.get("text", "")),
        "source": source,
        "confidence": confidence,
        "quality_score": chosen.get("metrics", {}).get("quality_score"),
        "removed_margin_markers": chosen.get("removed_margin_markers", []),
        "needs_review": bool(fallback_reasons(chosen, confidence_threshold=75.0)),
    }


def _paragraphs(text: str) -> list[tuple[str | None, str]]:
    paragraphs: list[tuple[str | None, str]] = []
    current_lines: list[str] = []
    current_number: str | None = None

    def flush() -> None:
        nonlocal current_lines, current_number
        value = " ".join(part.strip() for part in current_lines if part.strip())
        value = re.sub(r"\s+", " ", value).strip()
        if value:
            paragraphs.append((current_number, value))
        current_lines = []
        current_number = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            flush()
            continue
        match = NUMBERED_PARAGRAPH.match(line)
        if match:
            flush()
            current_number = match.group(1) or match.group(2)
        if current_lines and current_lines[-1].endswith("-") and line[:1].islower():
            current_lines[-1] = current_lines[-1][:-1] + line
        else:
            current_lines.append(line)
    flush()
    return paragraphs


def _chunk_paragraph(
    text: str, max_words: int = 220, overlap_words: int = 30
) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [text]
    chunks = []
    start = 0
    while start < len(words):
        end = min(start + max_words, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start = end - overlap_words
    return chunks


def _is_searchable_chunk(text: str) -> bool:
    return len(text) >= 20 and len(ALPHABETIC_WORD.findall(text)) >= 2


def finalize_documents(
    manifest_path: Path,
    extraction_root: Path,
    tasks_path: Path,
    tesseract_root: Path,
    paddle_root: Path | None,
    output_root: Path,
) -> dict[str, Any]:
    manifest = {record["sample_id"]: record for record in _load_jsonl(manifest_path)}
    tasks_by_document: dict[str, dict[int, dict[str, Any]]] = {}
    for task in _load_jsonl(tasks_path):
        tasks_by_document.setdefault(task["sample_id"], {})[int(task["pdf_page"])] = (
            task
        )

    documents_root = output_root / "documents"
    documents_root.mkdir(parents=True, exist_ok=True)
    chunks_path = output_root / "chunks.jsonl.gz"
    source_counts: Counter[str] = Counter()
    chunk_count = 0
    skipped_fragment_count = 0
    page_count = 0
    review_count = 0

    with gzip.open(chunks_path, "wt", encoding="utf-8") as chunks_file:
        for sample_id in sorted(manifest):
            extraction_path = extraction_root / "documents" / f"{sample_id}.json.gz"
            with gzip.open(extraction_path, "rt", encoding="utf-8") as input_file:
                extraction = json.load(input_file)

            pages = []
            for embedded_page in extraction["pages"]:
                pdf_page = int(embedded_page["pdf_page"])
                task = tasks_by_document.get(sample_id, {}).get(pdf_page)
                if task:
                    final_page = _select_page_text(
                        task, extraction_root, tesseract_root, paddle_root
                    )
                else:
                    text, removed = clean_layout_text(embedded_page["text"])
                    final_page = {
                        "text": text,
                        "source": "embedded",
                        "confidence": None,
                        "quality_score": embedded_page.get("quality_score"),
                        "removed_margin_markers": removed,
                        "needs_review": False,
                    }

                page_record = {"pdf_page": pdf_page, **final_page}
                pages.append(page_record)
                source_counts[final_page["source"]] += 1
                page_count += 1
                review_count += int(final_page["needs_review"])

                for paragraph_index, (paragraph_number, paragraph) in enumerate(
                    _paragraphs(final_page["text"]), start=1
                ):
                    for part_index, chunk_text in enumerate(
                        _chunk_paragraph(paragraph), start=1
                    ):
                        if not _is_searchable_chunk(chunk_text):
                            skipped_fragment_count += 1
                            continue
                        chunk_id = (
                            f"{sample_id}:p{pdf_page:04d}:"
                            f"para{paragraph_index:04d}:part{part_index:02d}"
                        )
                        chunk = {
                            "id": chunk_id,
                            "sample_id": sample_id,
                            "pdf_page": pdf_page,
                            "paragraph_index": paragraph_index,
                            "paragraph_number": paragraph_number,
                            "part_index": part_index,
                            "text": chunk_text,
                            "text_source": final_page["source"],
                            "title": manifest[sample_id].get("title"),
                            "decision_date": manifest[sample_id].get("decision_date"),
                            "decision_year": manifest[sample_id].get("decision_year"),
                            "era": manifest[sample_id].get("era"),
                            "judge": manifest[sample_id].get("judge"),
                            "citation": manifest[sample_id].get("citation"),
                            "pdf_url": manifest[sample_id].get("pdf_url"),
                        }
                        chunks_file.write(json.dumps(chunk, ensure_ascii=False) + "\n")
                        chunk_count += 1

            document_record = {
                "schema_version": FINAL_SCHEMA_VERSION,
                "sample_id": sample_id,
                "source_sha256": extraction["source_sha256"],
                "metadata": manifest[sample_id],
                "pages": pages,
            }
            destination = documents_root / f"{sample_id}.json.gz"
            temporary = destination.with_suffix(".json.gz.tmp")
            with gzip.open(temporary, "wt", encoding="utf-8") as output_file:
                json.dump(document_record, output_file, ensure_ascii=False)
            temporary.replace(destination)

    summary = {
        "schema_version": FINAL_SCHEMA_VERSION,
        "documents": len(manifest),
        "pages": page_count,
        "chunks": chunk_count,
        "skipped_nonsearchable_fragments": skipped_fragment_count,
        "pages_by_source": dict(sorted(source_counts.items())),
        "pages_needing_review": review_count,
        "chunks_path": str(chunks_path),
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary
