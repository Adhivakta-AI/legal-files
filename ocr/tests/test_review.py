import asyncio
import gzip
import json

import httpx
import pymupdf

from judgment_ocr.review import create_app


def test_review_api_renders_page_and_persists_verification(tmp_path) -> None:
    pdf_root = tmp_path / "pdfs"
    extraction_root = tmp_path / "extraction"
    results_root = tmp_path / "results"
    reviews_root = tmp_path / "reviews"
    pdf_path = pdf_root / "year=1950" / "case.pdf"
    extraction_path = extraction_root / "documents" / "PILOT-0001.json.gz"
    result_path = results_root / "pages" / "PILOT-0001" / "page-0001.json.gz"
    tasks_path = tmp_path / "tasks.jsonl"
    for path in (pdf_path, extraction_path, result_path):
        path.parent.mkdir(parents=True, exist_ok=True)

    document = pymupdf.open()
    page = document.new_page(width=420, height=600)
    page.insert_text((40, 60), "Supreme Court sample judgment")
    document.save(pdf_path)
    document.close()

    task = {
        "gold_id": "GOLD-001",
        "gold_bucket": "flagged",
        "sample_id": "PILOT-0001",
        "era": "1950-1969",
        "decision_year": 1950,
        "pdf_page": 1,
        "ocr_action": "reocr",
        "embedded_quality_score": 0.7,
        "severity": "severe",
        "pdf_relative_path": "year=1950/case.pdf",
        "extraction_relative_path": "documents/PILOT-0001.json.gz",
        "pdf_url": "https://example.test/case.pdf",
        "source_sha256": "abc123",
    }
    tasks_path.write_text(json.dumps(task) + "\n", encoding="utf-8")
    with gzip.open(extraction_path, "wt", encoding="utf-8") as output_file:
        json.dump(
            {
                "source_sha256": "abc123",
                "pages": [{"text": "Embedded sample"}],
            },
            output_file,
        )
    with gzip.open(result_path, "wt", encoding="utf-8") as output_file:
        json.dump(
            {
                "task": task,
                "render": {"width_pixels": 420},
                "embedded": {
                    "text": "Embedded sample",
                    "metrics": {"quality_score": 0.7},
                },
                "candidates": [
                    {
                        "engine": "paddle",
                        "text": "Correct sample\nA\nMore text\nB",
                        "lines": [
                            {"text": "Correct sample", "bbox": [20, 20, 300, 40]},
                            {"text": "A", "bbox": [390, 20, 410, 40]},
                            {"text": "More text", "bbox": [20, 50, 300, 70]},
                            {"text": "B", "bbox": [390, 50, 410, 70]},
                        ],
                        "mean_confidence": 0.98,
                        "metrics": {"quality_score": 0.96},
                        "elapsed_seconds": 1.2,
                    }
                ],
            },
            output_file,
        )

    app = create_app(
        tasks_path,
        pdf_root,
        extraction_root,
        results_root,
        reviews_root,
    )

    async def exercise_api() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            tasks = (await client.get("/api/tasks")).json()
            assert tasks["counts"]["ready"] == 1
            detail = (await client.get("/api/tasks/0")).json()
            assert detail["candidates"][0]["engine"] == "paddle"
            assert detail["candidates"][0]["text"] == "Correct sample\nMore text"
            assert detail["candidates"][0]["removed_margin_markers"] == ["A", "B"]
            image = await client.get("/api/tasks/0/image?dpi=96")
            assert image.status_code == 200
            assert image.headers["content-type"] == "image/png"
            assert image.content.startswith(b"\x89PNG")

            response = await client.put(
                "/api/tasks/0/review",
                json={
                    "selected_source": "paddle",
                    "corrected_text": "Correct sample judgment",
                    "checks": {
                        "party_names": True,
                        "judge_names": True,
                        "citations": True,
                        "section_numbers": True,
                        "paragraph_order": True,
                    },
                    "verified": True,
                    "notes": "Checked against the rendered page.",
                },
            )

            assert response.status_code == 200
            counts = (await client.get("/api/tasks")).json()["counts"]
            assert counts["verified"] == 1

    asyncio.run(exercise_api())
    review = json.loads(
        (reviews_root / "pages" / "PILOT-0001" / "page-0001.json").read_text(
            encoding="utf-8"
        )
    )
    assert review["corrected_text"] == "Correct sample judgment"
    assert review["source_sha256"] == "abc123"
