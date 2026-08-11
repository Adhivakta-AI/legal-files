from judgment_ocr.postprocess import clean_layout_text, clean_spatial_candidate


def test_spatial_cleanup_removes_only_verified_margin_sequence() -> None:
    candidate = {
        "engine": "paddle",
        "text": "Title\nA\nBody line\nB\nMore body H",
        "lines": [
            {"text": "Title", "bbox": [300, 10, 700, 40]},
            {"text": "A", "bbox": [955, 10, 980, 40]},
            {"text": "Body line", "bbox": [150, 50, 900, 80]},
            {"text": "B", "bbox": [955, 50, 980, 80]},
            {"text": "More body H", "bbox": [150, 90, 980, 120]},
        ],
    }

    cleaned = clean_spatial_candidate(candidate, page_width=1000)

    assert cleaned["text"] == "Title\nBody line\nMore body"
    assert cleaned["raw_text"] == candidate["text"]
    assert cleaned["removed_margin_markers"] == ["A", "B", "H"]


def test_spatial_cleanup_keeps_isolated_legal_label_without_sequence() -> None:
    candidate = {
        "text": "Exhibit\nA",
        "lines": [
            {"text": "Exhibit", "bbox": [100, 10, 300, 40]},
            {"text": "A", "bbox": [955, 50, 980, 80]},
        ],
    }

    assert clean_spatial_candidate(candidate, page_width=1000) == candidate


def test_layout_cleanup_requires_an_ordered_reporter_sequence() -> None:
    text = "Title           A\n          B       Judges\nBody C\nBody D\n"

    cleaned, removed = clean_layout_text(text)

    assert cleaned == "Title\nJudges\nBody\nBody\n"
    assert removed == ["A", "B", "C", "D"]


def test_layout_cleanup_keeps_normal_capital_letters() -> None:
    text = "A company relied on Exhibit B in paragraph C."

    assert clean_layout_text(text) == (text, [])
