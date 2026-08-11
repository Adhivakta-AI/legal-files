"""Conservative cleanup for OCR layout artifacts."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from judgment_ocr.quality import text_metrics

MARGIN_MARKER = re.compile(r"^[A-H]$")
RIGHT_ATTACHED_MARKER = re.compile(r"\s+([A-H])\s*$")
LEFT_ATTACHED_MARKER = re.compile(r"^\s*([A-H])\s+")
LAYOUT_MARKER = re.compile(r"(?<!\S)([A-H])(?!\S)")


def _bbox(line: dict[str, Any]) -> tuple[float, float, float, float] | None:
    value = line.get("bbox")
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes)):
        return None
    if len(value) != 4:
        return None
    try:
        return tuple(float(coordinate) for coordinate in value)  # type: ignore[return-value]
    except (TypeError, ValueError):
        return None


def _marker_sides(lines: list[dict[str, Any]], page_width: int) -> set[str]:
    labels: dict[str, set[str]] = {"left": set(), "right": set()}
    for line in lines:
        text = str(line.get("text", "")).strip()
        box = _bbox(line)
        if not MARGIN_MARKER.fullmatch(text) or not box:
            continue
        center = (box[0] + box[2]) / 2
        if center <= page_width * 0.10:
            labels["left"].add(text)
        elif center >= page_width * 0.90:
            labels["right"].add(text)

    # Requiring a sequence prevents removal of an isolated legal exhibit label.
    return {side for side, values in labels.items() if len(values) >= 2}


def clean_spatial_candidate(
    candidate: dict[str, Any], page_width: int
) -> dict[str, Any]:
    """Remove reporter column markers only when their margin position is proven."""

    if candidate.get("error") or not isinstance(candidate.get("lines"), list):
        return candidate

    lines = candidate["lines"]
    sides = _marker_sides(lines, page_width)
    if not sides:
        return candidate

    cleaned_lines: list[str] = []
    removed: list[str] = []
    for line in lines:
        text = str(line.get("text", ""))
        stripped = text.strip()
        box = _bbox(line)
        if not box:
            cleaned_lines.append(text)
            continue

        center = (box[0] + box[2]) / 2
        if MARGIN_MARKER.fullmatch(stripped) and (
            ("left" in sides and center <= page_width * 0.10)
            or ("right" in sides and center >= page_width * 0.90)
        ):
            removed.append(stripped)
            continue

        if "right" in sides and box[2] >= page_width * 0.95:
            match = RIGHT_ATTACHED_MARKER.search(text)
            if match:
                removed.append(match.group(1))
                text = RIGHT_ATTACHED_MARKER.sub("", text).rstrip()
        if "left" in sides and box[0] <= page_width * 0.05:
            match = LEFT_ATTACHED_MARKER.match(text)
            if match:
                removed.append(match.group(1))
                text = LEFT_ATTACHED_MARKER.sub("", text).lstrip()
        if text:
            cleaned_lines.append(text)

    if not removed:
        return candidate

    cleaned = dict(candidate)
    cleaned["raw_text"] = candidate.get("raw_text", candidate.get("text", ""))
    cleaned["text"] = "\n".join(cleaned_lines)
    cleaned["metrics"] = text_metrics(cleaned["text"])
    cleaned["removed_margin_markers"] = removed
    return cleaned


def clean_layout_text(text: str) -> tuple[str, list[str]]:
    """Clean A-H markers from embedded text when whitespace proves the sequence."""

    candidates: list[tuple[int, int, str]] = []
    offset = 0
    lines = text.splitlines(keepends=True)
    for line_index, line in enumerate(lines):
        content = line.rstrip("\r\n")
        for match in LAYOUT_MARKER.finditer(content):
            before = content[: match.start()]
            after = content[match.end() :]
            at_edge = not before.strip() or not after.strip()
            spaced_out = (
                len(before) - len(before.rstrip(" ")) >= 2
                and len(after) - len(after.lstrip(" ")) >= 2
            )
            if at_edge or spaced_out:
                candidates.append((offset + match.start(), line_index, match.group(1)))
        offset += len(line)

    ordered_labels = []
    for _, _, label in candidates:
        if label not in ordered_labels:
            ordered_labels.append(label)
    label_numbers = [ord(label) for label in ordered_labels]
    if len(ordered_labels) < 4 or label_numbers != sorted(label_numbers):
        return text, []

    removed: list[str] = []
    cleaned_lines: list[str] = []
    candidate_by_line: dict[int, set[str]] = {}
    for _, line_index, label in candidates:
        candidate_by_line.setdefault(line_index, set()).add(label)

    for line_index, line in enumerate(lines):
        content = line.rstrip("\r\n")
        ending = line[len(content) :]
        labels = candidate_by_line.get(line_index, set())
        if labels:

            def replace(match: re.Match[str], labels: set[str] = labels) -> str:
                label = match.group(1)
                if label not in labels:
                    return match.group(0)
                removed.append(label)
                return ""

            content = LAYOUT_MARKER.sub(replace, content)
            content = re.sub(r" {2,}", " ", content).strip()
        cleaned_lines.append(content + ending)

    return "".join(cleaned_lines), removed
