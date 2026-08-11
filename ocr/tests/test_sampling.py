from judgment_ocr.sampling import (
    DEFAULT_ACTIONS,
    build_gold_set,
    select_balanced_pages,
)


def test_selection_uses_at_most_one_page_per_document() -> None:
    candidates = [
        {
            "sample_id": "A",
            "era": "1950-1969",
            "pdf_page": page,
            "embedded_quality_score": score,
            "severity": "severe",
        }
        for page, score in [(1, 0.7), (2, 0.5)]
    ]
    candidates.append(
        {
            "sample_id": "B",
            "era": "1970-1989",
            "pdf_page": 1,
            "embedded_quality_score": 0.8,
            "severity": "poor",
        }
    )

    selected = select_balanced_pages(candidates, limit=2, seed="test")

    assert {item["sample_id"] for item in selected} == {"A", "B"}
    assert next(item for item in selected if item["sample_id"] == "A")["pdf_page"] == 2


def test_selection_balances_eras_before_taking_another_page() -> None:
    candidates = []
    for era in ("1950-1969", "1970-1989", "1990-2009", "2010-2019"):
        for index in range(3):
            candidates.append(
                {
                    "sample_id": f"{era}-{index}",
                    "era": era,
                    "pdf_page": 1,
                    "embedded_quality_score": 0.7,
                    "severity": "severe",
                }
            )

    selected = select_balanced_pages(candidates, limit=4, seed="test")

    assert {item["era"] for item in selected} == {
        "1950-1969",
        "1970-1989",
        "1990-2009",
        "2010-2019",
    }


def test_gold_set_combines_balanced_flagged_and_clean_pages(
    monkeypatch, tmp_path
) -> None:
    flagged_eras = ("1950-1969", "1970-1989", "1990-2009", "2010-2019")
    clean_eras = (*flagged_eras, "2020-onward")

    def candidates(eras, count_per_era, action):
        return [
            {
                "sample_id": f"{action}-{era}-{index}",
                "era": era,
                "pdf_page": 1,
                "ocr_action": action,
                "embedded_quality_score": 0.7 if action == "reocr" else 0.98,
                "severity": "severe" if action == "reocr" else "borderline",
            }
            for era in eras
            for index in range(count_per_era)
        ]

    flagged = candidates(flagged_eras, 20, "reocr")
    clean = candidates(clean_eras, 4, "keep")

    def fake_load_candidates(_root, actions):
        return flagged if actions == DEFAULT_ACTIONS else clean

    monkeypatch.setattr("judgment_ocr.sampling.load_candidates", fake_load_candidates)

    records = build_gold_set(tmp_path, flagged_count=80, clean_count=20, seed="x")

    assert len(records) == 100
    assert sum(record["gold_bucket"] == "flagged" for record in records) == 80
    assert sum(record["gold_bucket"] == "clean" for record in records) == 20
    assert {record["gold_id"] for record in records} == {
        f"GOLD-{index:03d}" for index in range(1, 101)
    }
