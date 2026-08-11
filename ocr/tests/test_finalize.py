import gzip
import json

import pytest

from judgment_ocr.finalize import (
    _chunk_paragraph,
    _is_searchable_chunk,
    _paragraphs,
    build_fallback_queue,
    fallback_reasons,
)


def test_fallback_reasons_use_hard_failure_signals() -> None:
    assert fallback_reasons(None, 75) == ["missing_tesseract_candidate"]
    assert fallback_reasons({"error": "failed"}, 75) == ["tesseract_error"]
    assert (
        fallback_reasons(
            {"text": "Readable legal text " * 10, "mean_confidence": 92}, 75
        )
        == []
    )
    assert fallback_reasons(
        {"text": "Readable legal text " * 10, "mean_confidence": 70}, 75
    ) == ["low_confidence"]
    assert (
        fallback_reasons(
            {"text": "Readable legal text " * 10, "mean_confidence": 0.92}, 75
        )
        == []
    )


def test_fallback_queue_refuses_incomplete_tesseract_run(tmp_path) -> None:
    task = {
        "sample_id": "PILOT-0001",
        "pdf_page": 1,
        "source_sha256": "abc",
    }
    tasks = tmp_path / "tasks.jsonl"
    tasks.write_text(json.dumps(task) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match="run is incomplete"):
        build_fallback_queue(tasks, tmp_path / "results", tmp_path / "fallback.jsonl")


def test_fallback_queue_selects_low_confidence_page(tmp_path) -> None:
    task = {
        "sample_id": "PILOT-0001",
        "pdf_page": 1,
        "source_sha256": "abc",
    }
    tasks = tmp_path / "tasks.jsonl"
    tasks.write_text(json.dumps(task) + "\n", encoding="utf-8")
    result_path = tmp_path / "results" / "pages" / "PILOT-0001" / "page-0001.json.gz"
    result_path.parent.mkdir(parents=True)
    with gzip.open(result_path, "wt", encoding="utf-8") as output_file:
        json.dump(
            {
                "task": task,
                "render": {"width_pixels": 1000},
                "candidates": [
                    {
                        "engine": "tesseract",
                        "text": "Readable legal text " * 10,
                        "mean_confidence": 70,
                    }
                ],
            },
            output_file,
        )

    summary = build_fallback_queue(
        tasks, tmp_path / "results", tmp_path / "fallback.jsonl"
    )

    assert summary["fallback_pages"] == 1
    record = json.loads((tmp_path / "fallback.jsonl").read_text(encoding="utf-8"))
    assert record["fallback_reasons"] == ["low_confidence"]


def test_numbered_paragraphs_and_long_chunk_overlap() -> None:
    paragraphs = _paragraphs("[1] First line\ncontinues here\n\n2. Second paragraph")
    assert paragraphs == [
        ("1", "[1] First line continues here"),
        ("2", "2. Second paragraph"),
    ]

    chunks = _chunk_paragraph(" ".join(f"word{i}" for i in range(12)), 8, 2)
    assert chunks == [
        "word0 word1 word2 word3 word4 word5 word6 word7",
        "word6 word7 word8 word9 word10 word11",
    ]


def test_search_chunks_drop_noise_but_keep_short_holdings() -> None:
    assert not _is_searchable_chunk("440")
    assert not _is_searchable_chunk("s~")
    assert not _is_searchable_chunk("[1950] S.C.R. 553.")
    assert _is_searchable_chunk("1. Appeal dismissed by this Court.")
