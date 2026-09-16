"""Deterministic parser for Supreme Court Reports upstream metadata.

The upstream JSON contains a ``raw_html`` field.  This module deliberately
does not use an LLM: coram, author marker, bench strength, CNR, and case number
are labelled fields and can be extracted reproducibly.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from html import unescape
from html.parser import HTMLParser
import re
from typing import Any


WHITESPACE = re.compile(r"\s+")
TAG = re.compile(r"<[^>]+>")
CORAM = re.compile(
    r"<strong\b[^>]*>\s*Coram\s*:\s*(.*?)</strong\s*>",
    re.IGNORECASE | re.DOTALL,
)
AUTHOR_SUP = re.compile(
    r"<sup\b(?=[^>]*\bdata-tooltip\s*=\s*(['\"])Author\1)[^>]*>.*?</sup\s*>",
    re.IGNORECASE | re.DOTALL,
)
CASE_NUMBER_HTML = re.compile(
    r"Case\s*No\s*:\s*</span\s*>\s*<font\b[^>]*>(.*?)</font\s*>",
    re.IGNORECASE | re.DOTALL,
)
BENCH_HTML = re.compile(
    r"Bench\s*:\s*</span\s*>\s*<font\b[^>]*>\s*(\d+)\s*Judges?\b",
    re.IGNORECASE | re.DOTALL,
)
CNR_INPUT = re.compile(
    r"<input\b(?=[^>]*\bid\s*=\s*(['\"]?)cnr\1)"
    r"(?=[^>]*\bvalue\s*=\s*(?:['\"]([^'\"]+)['\"]|([^\s>]+)))[^>]*>",
    re.IGNORECASE | re.DOTALL,
)
AUTHOR_MARKER = "[[AUTHOR]]"
OCR_CORAM = re.compile(
    r"\[([^\[\]\n]{3,400}?),\s*(?:J\.?\s*J\.?|JJ|J)\.?\s*\]",
    re.IGNORECASE,
)
OCR_CASE_NUMBER = re.compile(
    r"\(([^()\n]{0,80}\bNo(?:s)?\.?\s*[A-Za-z0-9./()& -]+?\s+of\s+\d{4})\)",
    re.IGNORECASE,
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data:
            self.parts.append(data)

    def text(self) -> str:
        return clean_text(" ".join(self.parts)) or ""


@dataclass(frozen=True)
class ParsedJudgmentMetadata:
    judges: tuple[str, ...]
    author_judges: tuple[str, ...]
    bench_size: int | None
    case_number: str | None
    cnr: str | None
    status: str
    warnings: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["judges"] = list(self.judges)
        value["author_judges"] = list(self.author_judges)
        value["warnings"] = list(self.warnings)
        return value


@dataclass(frozen=True)
class OpeningPageMetadata:
    judges: tuple[str, ...]
    author_judges: tuple[str, ...]
    case_number: str | None


def clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = WHITESPACE.sub(" ", unescape(value)).strip(" \t\r\n,;")
    return text or None


def html_text(value: str) -> str:
    parser = _TextExtractor()
    parser.feed(value)
    parser.close()
    return parser.text()


def normalize_judge_name(value: str) -> str | None:
    text = clean_text(value)
    if not text:
        return None
    text = re.sub(r"\s*\*+\s*$", "", text).strip()
    text = re.sub(r"\s*,?\s*(?:C\.?J\.?I\.?|J\.?J\.?|J\.?)\s*$", "", text, flags=re.I)
    return clean_text(text)


def parse_opening_page(text: str) -> OpeningPageMetadata:
    """Extract title-page coram/order and case number from existing OCR text."""
    judges: list[str] = []
    authors: list[str] = []
    coram = OCR_CORAM.search(text)
    if coram:
        content = re.sub(
            r"(?:,\s*)?(?:C\.?\s*J\.?\s*I?\.?|J\.?)\s*(?=,|$)",
            " ",
            coram.group(1),
            flags=re.IGNORECASE,
        )
        for raw_part in re.split(r"\s+(?:and|&)\s+|\s*,\s*", content, flags=re.I):
            is_author = "*" in raw_part
            name = normalize_judge_name(raw_part)
            if not name or name in judges:
                continue
            judges.append(name)
            if is_author:
                authors.append(name)

    case_match = OCR_CASE_NUMBER.search(text)
    case_number = clean_text(case_match.group(1)) if case_match else None
    return OpeningPageMetadata(tuple(judges), tuple(authors), case_number)


def _name_tokens(value: str) -> tuple[str, ...]:
    return tuple(re.findall(r"[A-Z]+", value.upper()))


def judge_names_equivalent(left: str, right: str) -> bool:
    left_tokens = _name_tokens(left)
    right_tokens = _name_tokens(right)
    if not left_tokens or not right_tokens:
        return False
    if left_tokens == right_tokens:
        return True
    if len(left_tokens) >= 2 and len(right_tokens) >= 2 and left_tokens[-2:] == right_tokens[-2:]:
        return True
    if left_tokens[-1] != right_tokens[-1]:
        return False
    shorter, longer = sorted((left_tokens[:-1], right_tokens[:-1]), key=len)
    return bool(shorter) and all(
        any(
            short == long
            or (len(short) == 1 and short[0] == long[0])
            or (len(long) == 1 and short[0] == long[0])
            for long in longer
        )
        for short in shorter
        if short
    )


def _same_bench(upstream: tuple[str, ...], opening: tuple[str, ...]) -> bool:
    if len(upstream) != len(opening):
        return False
    remaining = list(opening)
    for upstream_name in upstream:
        match_index = next(
            (
                index
                for index, opening_name in enumerate(remaining)
                if judge_names_equivalent(upstream_name, opening_name)
            ),
            None,
        )
        if match_index is None:
            return False
        remaining.pop(match_index)
    return not remaining


def reconcile_with_opening_page(
    upstream: ParsedJudgmentMetadata, opening: OpeningPageMetadata
) -> ParsedJudgmentMetadata:
    """Prefer PDF display names/order after validating membership upstream."""
    warnings = list(upstream.warnings)
    judges = upstream.judges
    authors = upstream.author_judges
    status = upstream.status

    if opening.judges:
        if _same_bench(upstream.judges, opening.judges):
            judges = opening.judges
            authors = opening.author_judges
            if upstream.author_judges and opening.author_judges and not _same_bench(
                upstream.author_judges, opening.author_judges
            ):
                warnings.append("upstream_author_marker_disagrees_with_pdf")
        else:
            warnings.append("ocr_coram_mismatch")
            # Older scans contain OCR spelling errors and punctuation that can
            # look like extra/missing names. Keep the internally consistent,
            # labelled upstream coram, but surface the discrepancy for audit.

    return ParsedJudgmentMetadata(
        judges=judges,
        author_judges=authors,
        bench_size=upstream.bench_size,
        case_number=opening.case_number or upstream.case_number,
        cnr=upstream.cnr,
        status=status,
        warnings=tuple(dict.fromkeys(warnings)),
    )


def _parse_coram(raw_html: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    match = CORAM.search(raw_html)
    if not match:
        return (), ()

    marked = AUTHOR_SUP.sub(f" {AUTHOR_MARKER} ", match.group(1))
    text = html_text(marked)
    judges: list[str] = []
    authors: list[str] = []
    for raw_part in re.split(r"\s*,\s*", text):
        is_author = AUTHOR_MARKER in raw_part
        name = normalize_judge_name(raw_part.replace(AUTHOR_MARKER, ""))
        if not name or name in judges:
            continue
        judges.append(name)
        if is_author:
            authors.append(name)
    return tuple(judges), tuple(authors)


def _parse_case_number(raw_html: str, plain_text: str) -> str | None:
    match = CASE_NUMBER_HTML.search(raw_html)
    if match:
        return clean_text(html_text(match.group(1)))
    match = re.search(
        r"\bCase\s*No\s*:\s*(.+?)(?=\s*\|\s*(?:Disposal|Bench)\b|$)",
        plain_text,
        re.IGNORECASE,
    )
    return clean_text(match.group(1)) if match else None


def _parse_bench_size(raw_html: str, plain_text: str) -> int | None:
    match = BENCH_HTML.search(raw_html)
    if not match:
        match = re.search(r"\bBench\s*:\s*(\d+)\s*Judges?\b", plain_text, re.I)
    return int(match.group(1)) if match else None


def _parse_cnr(raw_html: str) -> str | None:
    match = CNR_INPUT.search(raw_html)
    if not match:
        return None
    return clean_text(match.group(2) or match.group(3))


def parse_upstream_metadata(payload: dict[str, Any]) -> ParsedJudgmentMetadata:
    raw_html = payload.get("raw_html")
    if not isinstance(raw_html, str) or not raw_html.strip():
        return ParsedJudgmentMetadata((), (), None, None, None, "invalid", ("missing_raw_html",))

    plain_text = html_text(raw_html)
    judges, authors = _parse_coram(raw_html)
    bench_size = _parse_bench_size(raw_html, plain_text)
    case_number = _parse_case_number(raw_html, plain_text)
    cnr = _parse_cnr(raw_html)

    warnings: list[str] = []
    if not judges:
        warnings.append("missing_coram")
    if bench_size is None:
        warnings.append("missing_bench_size")
    elif judges and bench_size != len(judges):
        warnings.append("bench_coram_count_mismatch")
    if not case_number:
        warnings.append("missing_case_number")
    if authors and any(author not in judges for author in authors):
        warnings.append("author_not_in_coram")

    blocking = {
        "missing_coram",
        "missing_bench_size",
        "bench_coram_count_mismatch",
        "author_not_in_coram",
    }
    status = "verified" if not blocking.intersection(warnings) else "needs_review"
    return ParsedJudgmentMetadata(
        judges=judges,
        author_judges=authors,
        bench_size=bench_size,
        case_number=case_number,
        cnr=cnr,
        status=status,
        warnings=tuple(warnings),
    )
