from judgment_ocr.legal_corpus import (
    _word_windows,
    heading_identifier,
)


def test_heading_identifier_requires_a_leading_bold_identifier() -> None:
    spans = [
        {"text": "21A.", "font": "Times-Bold", "flags": 16, "size": 10},
        {"text": " Right to education.", "font": "Times-Bold", "flags": 16, "size": 10},
        {"text": "—The State shall", "font": "Times", "flags": 4, "size": 10},
    ]
    assert heading_identifier(spans, 9) == "21A"
    assert heading_identifier([{**spans[0], "font": "Times", "flags": 4}], 9) is None


def test_heading_identifier_ignores_small_superscript_note() -> None:
    spans = [
        {"text": "1", "font": "Times", "flags": 4, "size": 7},
        {"text": "[239.", "font": "Times-Bold", "flags": 16, "size": 10},
        {"text": " Administration.", "font": "Times-Bold", "flags": 16, "size": 10},
    ]
    assert heading_identifier(spans, 9) == "239"


def test_heading_identifier_handles_regular_font_period_between_bold_spans() -> None:
    spans = [
        {"text": "347", "font": "Times-Bold", "flags": 16, "size": 11},
        {"text": ". ", "font": "Times", "flags": 4, "size": 11},
        {"text": "Local inspection", "font": "Times-Bold", "flags": 16, "size": 11},
        {"text": ".—Body", "font": "Times", "flags": 4, "size": 11},
    ]
    assert heading_identifier(spans, 10) == "347"


def test_heading_identifier_preserves_official_hyphenated_article() -> None:
    spans = [
        {"text": "[371-I.", "font": "Times-Bold", "flags": 16, "size": 9},
        {"text": " Special provision.", "font": "Times-Bold", "flags": 16, "size": 9},
        {"text": "—Text", "font": "Times", "flags": 4, "size": 9},
    ]
    assert heading_identifier(spans, 8.5) == "371-I"


def test_word_windows_overlap() -> None:
    text = " ".join(f"word-{index}" for index in range(12))
    assert _word_windows(text, max_words=8, overlap_words=2) == [
        "word-0 word-1 word-2 word-3 word-4 word-5 word-6 word-7",
        "word-6 word-7 word-8 word-9 word-10 word-11",
    ]
