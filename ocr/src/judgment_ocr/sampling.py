"""Build deterministic, era-balanced page task lists."""

from __future__ import annotations

import gzip
import hashlib
import json
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

DEFAULT_ACTIONS = frozenset({"ocr", "reocr"})
KEEP_ACTIONS = frozenset({"keep"})


def _severity(quality_score: float) -> str:
    if quality_score < 0.75:
        return "severe"
    if quality_score < 0.9:
        return "poor"
    return "borderline"


def _stable_order(task: dict[str, Any], seed: str) -> str:
    value = f"{seed}:{task['sample_id']}:{task['pdf_page']}"
    return hashlib.sha256(value.encode()).hexdigest()


def _pdf_relative_path(record: dict[str, Any]) -> str:
    local_path = Path(record["local_path"])
    parts = local_path.parts
    if "pdfs" in parts:
        return Path(*parts[parts.index("pdfs") + 1 :]).as_posix()
    return f"year={record['decision_year']}/{local_path.name}"


def load_candidates(
    extraction_root: Path, actions: frozenset[str] = DEFAULT_ACTIONS
) -> list[dict[str, Any]]:
    documents_dir = extraction_root / "documents"
    if not documents_dir.is_dir():
        message = f"Extraction documents directory not found: {documents_dir}"
        raise FileNotFoundError(message)

    candidates = []
    for record_path in sorted(documents_dir.glob("*.json.gz")):
        with gzip.open(record_path, "rt", encoding="utf-8") as input_file:
            record = json.load(input_file)
        for page in record["pages"]:
            if page["ocr_action"] not in actions:
                continue
            candidates.append(
                {
                    "sample_id": record["sample_id"],
                    "era": record["era"],
                    "decision_year": record["decision_year"],
                    "pdf_page": page["pdf_page"],
                    "ocr_action": page["ocr_action"],
                    "embedded_quality_score": page["quality_score"],
                    "severity": _severity(float(page["quality_score"])),
                    "pdf_relative_path": _pdf_relative_path(record),
                    "extraction_relative_path": record_path.relative_to(
                        extraction_root
                    ).as_posix(),
                    "pdf_url": record["pdf_url"],
                    "source_sha256": record["source_sha256"],
                }
            )
    return candidates


def select_balanced_pages(
    candidates: list[dict[str, Any]], limit: int, seed: str
) -> list[dict[str, Any]]:
    if limit < 1:
        raise ValueError("limit must be positive")

    # Avoid filling a benchmark with many pages from one unusually bad judgment.
    first_page_per_document: dict[str, dict[str, Any]] = {}
    for candidate in sorted(
        candidates,
        key=lambda item: (
            item["sample_id"],
            float(item["embedded_quality_score"]),
            item["pdf_page"],
        ),
    ):
        first_page_per_document.setdefault(candidate["sample_id"], candidate)

    groups: dict[tuple[str, str], deque[dict[str, Any]]] = defaultdict(deque)
    for candidate in first_page_per_document.values():
        groups[(candidate["era"], candidate["severity"])].append(candidate)

    for key, values in groups.items():
        groups[key] = deque(sorted(values, key=lambda item: _stable_order(item, seed)))

    eras = sorted({era for era, _ in groups})
    severities = ("severe", "poor", "borderline")
    severity_offsets = {era: 0 for era in eras}
    selected = []
    while len(selected) < limit:
        made_progress = False
        for era in eras:
            if len(selected) >= limit:
                break
            for step in range(len(severities)):
                offset = (severity_offsets[era] + step) % len(severities)
                group = groups[(era, severities[offset])]
                if group:
                    selected.append(group.popleft())
                    severity_offsets[era] = (offset + 1) % len(severities)
                    made_progress = True
                    break
        if not made_progress:
            break

    return sorted(selected, key=lambda item: (item["era"], item["sample_id"]))


def build_gold_set(
    extraction_root: Path,
    flagged_count: int,
    clean_count: int,
    seed: str,
) -> list[dict[str, Any]]:
    flagged = select_balanced_pages(
        load_candidates(extraction_root, DEFAULT_ACTIONS),
        flagged_count,
        f"{seed}:flagged",
    )
    clean = select_balanced_pages(
        load_candidates(extraction_root, KEEP_ACTIONS),
        clean_count,
        f"{seed}:clean",
    )
    if len(flagged) != flagged_count or len(clean) != clean_count:
        raise ValueError(
            "Not enough distinct judgments to build the requested gold set"
        )

    records = [
        {**record, "gold_bucket": bucket}
        for bucket, selected in (("flagged", flagged), ("clean", clean))
        for record in selected
    ]
    records.sort(key=lambda item: _stable_order(item, f"{seed}:review-order"))
    for index, record in enumerate(records, start=1):
        record["gold_id"] = f"GOLD-{index:03d}"
    return records


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(f"{path.suffix}.tmp")
    with temporary_path.open("w", encoding="utf-8") as output_file:
        for record in records:
            output_file.write(json.dumps(record, ensure_ascii=False) + "\n")
    temporary_path.replace(path)
