"""Build structural statute and Constitution artifacts for hybrid retrieval."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import fitz

LEGAL_CORPUS_SCHEMA_VERSION = 1
DEFAULT_CORPUS_VERSION = "legal-primary-2026-09-11"
UNIT_IDENTIFIER = re.compile(r"^\[?(\d{1,3}(?:-[A-Z]{1,2}|[A-Z]{0,2}))\.\s*")
STRUCTURE_HEADING = re.compile(r"^(?:CHAPTER|PART)\s+[IVXLC]+\b", re.IGNORECASE)
SCHEDULE_HEADING = re.compile(
    r"\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|"
    r"NINTH|TENTH|ELEVENTH|TWELFTH)\s+SCHEDULE\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class LegalDocument:
    id: str
    source_kind: str
    title: str
    short_title: str
    jurisdiction: str
    authority: str
    act_number: str | None
    enacted_on: str | None
    effective_from: str | None
    current_through: str | None
    language: str
    source_url: str
    canonical_url: str
    source_sha256: str
    corpus_version: str
    aliases: tuple[str, ...]
    source_filename: str
    commencement_note: str | None = None

    def record(self) -> dict[str, Any]:
        value = asdict(self)
        value["aliases"] = list(self.aliases)
        return value


def _sha256(path: Path) -> str:
    with path.open("rb") as input_file:
        return hashlib.file_digest(input_file, "sha256").hexdigest()


def _normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value.replace("\u00ad", ""))
    return re.sub(r"\s+", " ", value).strip()


def _bold(span: dict[str, Any]) -> bool:
    return bool(int(span.get("flags", 0)) & 16) or "bold" in str(
        span.get("font", "")
    ).lower()


def heading_identifier(
    spans: Iterable[dict[str, Any]], minimum_font_size: float
) -> str | None:
    """Return a leading bold statutory identifier, ignoring superscript notes."""
    visible = [
        span
        for span in spans
        if float(span.get("size", 0)) >= minimum_font_size
        and str(span.get("text", "")).strip()
    ]
    first_content = next(
        (
            span
            for span in visible
            if any(character.isalnum() for character in str(span.get("text", "")))
        ),
        None,
    )
    if first_content is None or not _bold(first_content):
        return None
    # Some official PDFs split the bold number and bold heading with a regular-font
    # punctuation span (for example: bold "347", regular ". ", bold title).
    match = UNIT_IDENTIFIER.match(
        _normalized("".join(str(span.get("text", "")) for span in visible))
    )
    return match.group(1) if match else None


def _noise_line(text: str, document_id: str) -> bool:
    folded = text.casefold()
    if re.fullmatch(r"\[?\d{1,3}\]?", text):
        return True
    if document_id == "bnss-2023" and (
        "the bharatiya nagarik suraksha sanhita, 2023" in folded
        or folded == "sections"
    ):
        return True
    return document_id == "constitution-of-india" and (
        folded == "the constitution of india"
        or folded.startswith("(part ")
        or folded.startswith("(article ")
    )


def _page_lines(
    page: fitz.Page, minimum_font_size: float, document_id: str
) -> list[tuple[str, list[dict[str, Any]]]]:
    output: list[tuple[str, list[dict[str, Any]]]] = []
    page_dict = page.get_text("dict", sort=True)
    for block in page_dict.get("blocks", []):
        for line in block.get("lines", []):
            spans = list(line.get("spans", []))
            visible = [
                span
                for span in spans
                if float(span.get("size", 0)) >= minimum_font_size
            ]
            text = _normalized("".join(str(span.get("text", "")) for span in visible))
            if not text or _noise_line(text, document_id):
                continue
            output.append((text, spans))
    return output


def _heading_from_text(identifier: str, text: str) -> str:
    match = re.match(
        rf"^\[?{re.escape(identifier)}\.\s*(.+?)(?:\.?[—–-])",
        text,
    )
    if match:
        return match.group(1).strip().rstrip(".")
    without_number = re.sub(
        rf"^\[?{re.escape(identifier)}\.\s*", "", text, count=1
    )
    return without_number[:240].strip().rstrip(".")


def _identifier_sort_key(identifier: str) -> tuple[int, int]:
    match = re.fullmatch(r"(\d{1,3})-?([A-Z]{0,2})", identifier)
    if not match:
        raise ValueError(f"Invalid legal unit identifier: {identifier}")
    suffix = match.group(2)
    suffix_value = 0
    for character in suffix:
        suffix_value = suffix_value * 27 + ord(character) - ord("A") + 1
    return int(match.group(1)), suffix_value


def _finalized_unit(
    current: dict[str, Any], document: LegalDocument, unit_kind: str
) -> dict[str, Any]:
    text = _normalized(" ".join(current.pop("lines")))
    identifier = str(current["unit_number"])
    return {
        **current,
        "id": f"{document.id}:{unit_kind}:{identifier.lower()}",
        "document_id": document.id,
        "unit_kind": unit_kind,
        "heading": _heading_from_text(identifier, text),
        "text": text,
        "language": document.language,
        "source_sha256": document.source_sha256,
    }


def pdf_numbered_units(
    document: LegalDocument,
    pdf_path: Path,
    *,
    unit_kind: str,
    first_page: int,
    last_page: int,
    minimum_font_size: float,
    expected_identifiers: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Extract bold section/article headings and their text from a tagged PDF."""
    units: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    parent_label: str | None = None
    structure_pending: str | None = None
    last_key = (-1, -1)
    expected_index = 0

    with fitz.open(pdf_path) as pdf:
        if first_page < 1 or last_page > len(pdf) or first_page > last_page:
            raise ValueError(
                f"Invalid page range {first_page}-{last_page} for {pdf_path}"
            )
        for pdf_page in range(first_page, last_page + 1):
            for text, spans in _page_lines(
                pdf[pdf_page - 1], minimum_font_size, document.id
            ):
                if STRUCTURE_HEADING.match(text):
                    structure_pending = text
                    continue
                if structure_pending and text.isupper() and len(text) <= 180:
                    parent_label = f"{structure_pending}: {text}"
                    structure_pending = None
                    continue

                identifier = heading_identifier(spans, minimum_font_size)
                if identifier and expected_identifiers is not None:
                    expected = (
                        expected_identifiers[expected_index]
                        if expected_index < len(expected_identifiers)
                        else None
                    )
                    if identifier != expected:
                        identifier = None
                elif identifier:
                    key = _identifier_sort_key(identifier)
                    if key <= last_key:
                        identifier = None

                if identifier:
                    if current:
                        units.append(_finalized_unit(current, document, unit_kind))
                    key = _identifier_sort_key(identifier)
                    last_key = key
                    if expected_identifiers is not None:
                        expected_index += 1
                    current = {
                        "unit_number": identifier,
                        "parent_label": parent_label,
                        "pdf_page_start": pdf_page,
                        "pdf_page_end": pdf_page,
                        "sort_order": key[0] * 1000 + key[1],
                        "lines": [text],
                    }
                    continue

                if current:
                    current["lines"].append(text)
                    current["pdf_page_end"] = pdf_page

    if current:
        units.append(_finalized_unit(current, document, unit_kind))
    if expected_identifiers is not None and expected_index != len(expected_identifiers):
        missing = expected_identifiers[expected_index : expected_index + 5]
        raise ValueError(f"Failed to find expected {unit_kind} identifiers: {missing}")
    if not units:
        raise ValueError(f"No {unit_kind} units found in {pdf_path}")
    return units


def preamble_unit(
    document: LegalDocument,
    pdf_path: Path,
    *,
    pdf_page: int,
    minimum_font_size: float,
) -> dict[str, Any]:
    with fitz.open(pdf_path) as pdf:
        text = _normalized(
            " ".join(
                value
                for value, _ in _page_lines(
                    pdf[pdf_page - 1], minimum_font_size, document.id
                )
            )
        )
    marker = text.find("WE, THE PEOPLE OF INDIA")
    if marker < 0:
        raise ValueError("Constitution preamble marker was not found")
    text = text[marker:]
    return {
        "id": f"{document.id}:preamble:preamble",
        "document_id": document.id,
        "unit_kind": "preamble",
        "unit_number": "Preamble",
        "parent_label": None,
        "heading": "Preamble",
        "text": text,
        "pdf_page_start": pdf_page,
        "pdf_page_end": pdf_page,
        "sort_order": 1,
        "language": document.language,
        "source_sha256": document.source_sha256,
    }


def schedule_page_units(
    document: LegalDocument,
    pdf_path: Path,
    *,
    first_page: int,
    last_page: int,
    minimum_font_size: float,
) -> list[dict[str, Any]]:
    units: list[dict[str, Any]] = []
    schedule = "Schedule"
    with fitz.open(pdf_path) as pdf:
        for pdf_page in range(first_page, last_page + 1):
            text = _normalized(
                " ".join(
                    value
                    for value, _ in _page_lines(
                        pdf[pdf_page - 1], minimum_font_size, document.id
                    )
                )
            )
            match = SCHEDULE_HEADING.search(text)
            if match:
                schedule = f"{match.group(1).title()} Schedule"
            if len(text) < 40:
                continue
            units.append(
                {
                    "id": f"{document.id}:schedule-page:{pdf_page}",
                    "document_id": document.id,
                    "unit_kind": "schedule_page",
                    "unit_number": f"{schedule}, PDF page {pdf_page}",
                    "parent_label": schedule,
                    "heading": schedule,
                    "text": text,
                    "pdf_page_start": pdf_page,
                    "pdf_page_end": pdf_page,
                    "sort_order": 1_000_000 + pdf_page,
                    "language": document.language,
                    "source_sha256": document.source_sha256,
                }
            )
    return units


def _word_windows(
    text: str, max_words: int = 220, overlap_words: int = 30
) -> list[str]:
    words = text.split()
    if len(words) <= max_words:
        return [text]
    output: list[str] = []
    start = 0
    while start < len(words):
        end = min(start + max_words, len(words))
        output.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start = end - overlap_words
    return output


def chunks_from_units(
    documents: list[LegalDocument], units: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    document_by_id = {document.id: document for document in documents}
    chunks: list[dict[str, Any]] = []
    for unit in units:
        document = document_by_id[unit["document_id"]]
        prefix = " · ".join(
            part
            for part in (
                document.title,
                f"{unit['unit_kind'].title()} {unit['unit_number']}",
                unit.get("parent_label"),
                unit["heading"],
                "; ".join(document.aliases),
                document.commencement_note,
            )
            if part
        )
        for part_index, text in enumerate(_word_windows(unit["text"]), start=1):
            embedding_text = f"{prefix}\n{text}"
            chunks.append(
                {
                    "id": f"{unit['id']}:part:{part_index:02d}",
                    "document_id": document.id,
                    "document_title": document.title,
                    "source_kind": document.source_kind,
                    "unit_id": unit["id"],
                    "unit_kind": unit["unit_kind"],
                    "unit_number": unit["unit_number"],
                    "parent_label": unit.get("parent_label"),
                    "heading": unit["heading"],
                    "part_index": part_index,
                    "text": text,
                    "search_text": embedding_text,
                    "embedding_text": embedding_text,
                    "pdf_page_start": unit.get("pdf_page_start"),
                    "pdf_page_end": unit.get("pdf_page_end"),
                    "language": document.language,
                    "effective_from": document.effective_from,
                    "commencement_note": document.commencement_note,
                    "current_through": document.current_through,
                    "source_url": document.source_url,
                    "canonical_url": document.canonical_url,
                    "corpus_version": document.corpus_version,
                }
            )
    return chunks


def _write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output_file:
        for record in records:
            output_file.write(json.dumps(record, ensure_ascii=False) + "\n")


def _write_gzip_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as output_file:
        for record in records:
            output_file.write(json.dumps(record, ensure_ascii=False) + "\n")


def build_legal_corpus(
    *,
    bns_pdf: Path,
    bnss_pdf: Path,
    constitution_pdf: Path,
    output_root: Path,
    corpus_version: str = DEFAULT_CORPUS_VERSION,
) -> dict[str, Any]:
    documents = [
        LegalDocument(
            id="bns-2023",
            source_kind="statute",
            title="The Bharatiya Nyaya Sanhita, 2023",
            short_title="BNS",
            jurisdiction="India",
            authority="Parliament of India",
            act_number="45 of 2023",
            enacted_on="2023-12-25",
            effective_from="2024-07-01",
            current_through="2025-10-06",
            language="en",
            source_url=(
                "https://www.indiacode.nic.in/bitstream/123456789/20062/1/"
                "a2023-45.pdf"
            ),
            canonical_url="https://www.indiacode.nic.in/handle/123456789/20062",
            source_sha256=_sha256(bns_pdf),
            corpus_version=corpus_version,
            aliases=("BNS", "Bharatiya Nyaya Sanhita", "new penal code"),
            source_filename=bns_pdf.name,
            commencement_note=(
                "In force from 1 July 2024 except section 106(2), under "
                "S.O. 850(E) dated 23 February 2024."
            ),
        ),
        LegalDocument(
            id="bnss-2023",
            source_kind="statute",
            title="The Bharatiya Nagarik Suraksha Sanhita, 2023",
            short_title="BNSS",
            jurisdiction="India",
            authority="Parliament of India",
            act_number="46 of 2023",
            enacted_on="2023-12-25",
            effective_from="2024-07-01",
            current_through="2025-10-06",
            language="en",
            source_url=(
                "https://www.indiacode.nic.in/handle/123456789/20099"
                "?view_type=browse"
            ),
            canonical_url=(
                "https://www.indiacode.nic.in/handle/123456789/20099"
                "?view_type=browse"
            ),
            source_sha256=_sha256(bnss_pdf),
            corpus_version=corpus_version,
            aliases=(
                "BNSS",
                "Bharatiya Nagarik Suraksha Sanhita",
                "new criminal procedure code",
            ),
            source_filename=bnss_pdf.name,
            commencement_note=(
                "In force from 1 July 2024 except the First Schedule entry "
                "relating to BNS section 106(2)."
            ),
        ),
        LegalDocument(
            id="constitution-of-india",
            source_kind="constitution",
            title="The Constitution of India",
            short_title="Constitution",
            jurisdiction="India",
            authority="Ministry of Law and Justice, Legislative Department",
            act_number=None,
            enacted_on="1949-11-26",
            effective_from="1950-01-26",
            current_through="2026-05-01",
            language="en",
            source_url=(
                "https://www.legislative.gov.in/static/uploads/2025/07/"
                "88cca69e868e50b217f855be2fb8bdba.pdf"
            ),
            canonical_url="https://legislative.gov.in/constitution-of-india/",
            source_sha256=_sha256(constitution_pdf),
            corpus_version=corpus_version,
            aliases=("Constitution of India", "Indian Constitution", "COI"),
            source_filename=constitution_pdf.name,
        ),
    ]
    document_by_id = {document.id: document for document in documents}

    units = pdf_numbered_units(
        document_by_id["bns-2023"],
        bns_pdf,
        unit_kind="section",
        first_page=16,
        last_page=111,
        minimum_font_size=10,
        expected_identifiers=[str(value) for value in range(1, 359)],
    )
    units.extend(
        pdf_numbered_units(
            document_by_id["bnss-2023"],
            bnss_pdf,
            unit_kind="section",
            first_page=18,
            last_page=174,
            minimum_font_size=10,
            expected_identifiers=[str(value) for value in range(1, 532)],
        )
    )
    units.extend(
        schedule_page_units(
            document_by_id["bnss-2023"],
            bnss_pdf,
            first_page=175,
            last_page=281,
            minimum_font_size=10,
        )
    )
    units.append(
        preamble_unit(
            document_by_id["constitution-of-india"],
            constitution_pdf,
            pdf_page=32,
            minimum_font_size=8.5,
        )
    )
    constitution_articles = pdf_numbered_units(
        document_by_id["constitution-of-india"],
        constitution_pdf,
        unit_kind="article",
        first_page=33,
        last_page=283,
        minimum_font_size=8.5,
    )
    if constitution_articles[0]["unit_number"] != "1":
        raise ValueError("The first Constitution article is not Article 1")
    if constitution_articles[-1]["unit_number"] != "395":
        raise ValueError("The last Constitution article is not Article 395")
    units.extend(constitution_articles)
    units.extend(
        schedule_page_units(
            document_by_id["constitution-of-india"],
            constitution_pdf,
            first_page=284,
            last_page=381,
            minimum_font_size=8.5,
        )
    )

    if len({unit["id"] for unit in units}) != len(units):
        raise ValueError("Legal unit IDs must be unique")
    chunks = chunks_from_units(documents, units)
    if len({chunk["id"] for chunk in chunks}) != len(chunks):
        raise ValueError("Legal chunk IDs must be unique")

    output_root.mkdir(parents=True, exist_ok=True)
    documents_path = output_root / "documents.jsonl"
    units_path = output_root / "units.jsonl.gz"
    chunks_path = output_root / "chunks.jsonl.gz"
    _write_jsonl(documents_path, (document.record() for document in documents))
    _write_gzip_jsonl(units_path, units)
    _write_gzip_jsonl(chunks_path, chunks)

    unit_counts = Counter(
        f"{unit['document_id']}:{unit['unit_kind']}" for unit in units
    )
    chunk_counts = Counter(chunk["document_id"] for chunk in chunks)
    summary = {
        "schema_version": LEGAL_CORPUS_SCHEMA_VERSION,
        "corpus_version": corpus_version,
        "document_count": len(documents),
        "unit_count": len(units),
        "chunk_count": len(chunks),
        "unit_counts": dict(sorted(unit_counts.items())),
        "chunk_counts": dict(sorted(chunk_counts.items())),
        "documents_path": str(documents_path),
        "units_path": str(units_path),
        "chunks_path": str(chunks_path),
    }
    (output_root / "summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    return summary
