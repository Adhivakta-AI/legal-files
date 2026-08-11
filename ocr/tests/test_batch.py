import gzip
import json
from pathlib import Path

import pymupdf

from judgment_ocr.batch import (
    download_batch,
    extract_batch,
    partition_tasks,
    verify_batch,
)


def _write_jsonl(path, records) -> None:
    path.write_text(
        "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
    )


def test_partition_tasks_has_complete_balanced_coverage(tmp_path) -> None:
    tasks = [
        {"sample_id": f"DOC-{index // 3}", "pdf_page": index + 1}
        for index in range(11)
    ]
    tasks_path = tmp_path / "tasks.jsonl"
    _write_jsonl(tasks_path, tasks)

    summary = partition_tasks(tasks_path, tmp_path / "parts", workers=3)

    assert summary["partition_counts"] == [4, 4, 3]
    partitioned = []
    for path in summary["paths"]:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
        partitioned.extend(json.loads(line) for line in lines if line.strip())
    assert sorted(partitioned, key=lambda item: item["pdf_page"]) == tasks


def test_download_and_extract_reuse_local_pdf(tmp_path) -> None:
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((72, 72), "This is clean searchable judgment text " * 5)
    source_pdf = tmp_path / "pdfs" / "year=2000" / "english" / "case_EN.pdf"
    source_pdf.parent.mkdir(parents=True)
    pdf.save(source_pdf)
    pdf.close()

    manifest_record = {
        "sample_id": "DOC-1",
        "decision_year": 2000,
        "storage_year": 2000,
        "era": "1990-2009",
        "path": "case",
        "pdf_key": "data/pdf/year=2000/english/case_EN.pdf",
        "pdf_url": "https://example.invalid/case.pdf",
        "pdf_size_bytes": source_pdf.stat().st_size,
    }
    manifest = tmp_path / "manifest.jsonl"
    _write_jsonl(manifest, [manifest_record])

    download_summary = download_batch(
        manifest, tmp_path / "pdfs", tmp_path / "audit", workers=1
    )
    extraction_summary = extract_batch(
        manifest,
        tmp_path / "audit" / "downloads.jsonl",
        tmp_path / "extraction",
        workers=1,
    )

    assert download_summary["counts"] == {"reused": 1}
    assert extraction_summary["documents"] == 1
    assert extraction_summary["pages"] == 1
    with gzip.open(
        tmp_path / "extraction" / "documents" / "DOC-1.json.gz",
        "rt",
        encoding="utf-8",
    ) as input_file:
        record = json.load(input_file)
    assert record["sample_id"] == "DOC-1"
    assert record["pages"][0]["ocr_action"] == "keep"


def test_verify_batch_writes_completion_and_checksums(tmp_path) -> None:
    manifest = tmp_path / "manifest.jsonl"
    _write_jsonl(manifest, [{"sample_id": "DOC-1"}])
    extraction = tmp_path / "extraction"
    extraction.mkdir()
    (extraction / "summary.json").write_text("{}\n", encoding="utf-8")
    final = tmp_path / "final"
    (final / "documents").mkdir(parents=True)
    with gzip.open(final / "documents" / "DOC-1.json.gz", "wt") as output_file:
        json.dump({"sample_id": "DOC-1"}, output_file)
    chunk = {
        "id": "DOC-1:p0001:para0001:part01",
        "sample_id": "DOC-1",
        "pdf_page": 1,
        "pdf_url": "https://example.invalid/case.pdf",
    }
    with gzip.open(final / "chunks.jsonl.gz", "wt") as output_file:
        output_file.write(json.dumps(chunk) + "\n")
    (final / "summary.json").write_text(
        json.dumps(
            {
                "documents": 1,
                "pages": 1,
                "chunks": 1,
                "pages_by_source": {"embedded": 1},
                "pages_needing_review": 0,
            }
        ),
        encoding="utf-8",
    )

    summary = verify_batch(manifest, extraction, final, tmp_path / "completion")

    assert summary["status"] == "complete"
    assert summary["chunks"] == 1
    assert (tmp_path / "completion" / "checksums.sha256").is_file()
    assert (tmp_path / "completion" / "COMPLETE.json").is_file()
