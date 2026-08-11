import gzip
import json

from judgment_ocr.runner import SCHEMA_VERSION, _can_reuse, run_tasks


def test_reuse_requires_successful_matching_candidates(tmp_path) -> None:
    path = tmp_path / "result.json.gz"
    task = {"source_sha256": "abc"}
    record = {
        "schema_version": SCHEMA_VERSION,
        "task": task,
        "render": {"dpi": 300},
        "candidates": [{"engine": "paddle"}, {"engine": "tesseract"}],
    }
    with gzip.open(path, "wt", encoding="utf-8") as output_file:
        json.dump(record, output_file)

    assert _can_reuse(path, task, 300, ["paddle", "tesseract"])
    record["candidates"][0]["error"] = "failed"
    with gzip.open(path, "wt", encoding="utf-8") as output_file:
        json.dump(record, output_file)
    assert not _can_reuse(path, task, 300, ["paddle", "tesseract"])


def test_worker_run_writes_distinct_summary(tmp_path) -> None:
    tasks = tmp_path / "tasks.jsonl"
    tasks.write_text("", encoding="utf-8")

    run_tasks(
        tasks_path=tasks,
        pdf_root=tmp_path,
        extraction_root=tmp_path,
        output_root=tmp_path / "results",
        engine_names=["tesseract"],
        device="cpu",
        dpi=300,
        force=False,
        max_pages=None,
        worker_id="03",
    )

    assert (tmp_path / "results" / "run-summary-03.json").is_file()
