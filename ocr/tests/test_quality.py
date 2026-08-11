from judgment_ocr.quality import text_metrics


def test_clean_text_scores_better_than_corrupted_text() -> None:
    clean = "The appeal is allowed and the judgment of the High Court is set aside."
    corrupt = "Th3 appea| !s a11owed @@@ jn Jncome-tax."

    assert text_metrics(clean)["quality_score"] > text_metrics(corrupt)["quality_score"]
