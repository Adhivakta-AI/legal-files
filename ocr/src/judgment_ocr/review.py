"""Local API for visually verifying OCR candidates against rendered PDF pages."""

from __future__ import annotations

import gzip
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

import pymupdf
from fastapi import FastAPI, HTTPException, Query
from fastapi import Path as ApiPath
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from judgment_ocr.postprocess import clean_layout_text, clean_spatial_candidate
from judgment_ocr.quality import text_metrics
from judgment_ocr.runner import _load_embedded_page, _load_jsonl

REVIEW_SCHEMA_VERSION = 1
WEB_ROOT = Path(__file__).with_name("web")


class VerificationChecks(BaseModel):
    party_names: bool = False
    judge_names: bool = False
    citations: bool = False
    section_numbers: bool = False
    paragraph_order: bool = False


class ReviewPayload(BaseModel):
    selected_source: Literal["embedded", "paddle", "tesseract", "manual"]
    corrected_text: str
    checks: VerificationChecks = Field(default_factory=VerificationChecks)
    verified: bool = False
    notes: Annotated[str, Field(max_length=4000)] = ""


class ReviewStore:
    def __init__(
        self,
        tasks_path: Path,
        pdf_root: Path,
        extraction_root: Path,
        results_root: Path,
        reviews_root: Path,
    ) -> None:
        self.tasks = _load_jsonl(tasks_path)
        self.pdf_root = pdf_root.resolve()
        self.extraction_root = extraction_root.resolve()
        self.results_root = results_root.resolve()
        self.reviews_root = reviews_root.resolve()
        self.reviews_root.mkdir(parents=True, exist_ok=True)

    def task(self, index: int) -> dict[str, Any]:
        if index < 0 or index >= len(self.tasks):
            raise HTTPException(status_code=404, detail="Task not found")
        return self.tasks[index]

    @staticmethod
    def _page_name(task: dict[str, Any], suffix: str) -> str:
        return f"page-{int(task['pdf_page']):04d}.{suffix}"

    def result_path(self, task: dict[str, Any]) -> Path:
        return (
            self.results_root
            / "pages"
            / task["sample_id"]
            / self._page_name(task, "json.gz")
        )

    def review_path(self, task: dict[str, Any]) -> Path:
        return (
            self.reviews_root
            / "pages"
            / task["sample_id"]
            / self._page_name(task, "json")
        )

    def pdf_path(self, task: dict[str, Any]) -> Path:
        path = (self.pdf_root / task["pdf_relative_path"]).resolve()
        if not path.is_relative_to(self.pdf_root) or not path.is_file():
            raise HTTPException(status_code=404, detail="PDF not found")
        return path

    def read_result(self, task: dict[str, Any]) -> dict[str, Any] | None:
        path = self.result_path(task)
        if not path.is_file():
            return None
        try:
            with gzip.open(path, "rt", encoding="utf-8") as input_file:
                result = json.load(input_file)
        except (OSError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=500, detail="Invalid OCR result") from error
        if result.get("task", {}).get("source_sha256") != task["source_sha256"]:
            raise HTTPException(status_code=409, detail="OCR source hash mismatch")
        return result

    def read_review(self, task: dict[str, Any]) -> dict[str, Any] | None:
        path = self.review_path(task)
        if not path.is_file():
            return None
        try:
            review = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise HTTPException(
                status_code=500, detail="Invalid review file"
            ) from error
        if review.get("source_sha256") != task["source_sha256"]:
            raise HTTPException(status_code=409, detail="Review source hash mismatch")
        return review

    def status(self, task: dict[str, Any]) -> str:
        review = self.read_review(task)
        if review:
            return "verified" if review.get("verified") else "draft"
        return "ready" if self.result_path(task).is_file() else "pending"

    def task_summary(self, index: int, task: dict[str, Any]) -> dict[str, Any]:
        return {
            "index": index,
            "gold_id": task.get("gold_id"),
            "sample_id": task["sample_id"],
            "era": task["era"],
            "decision_year": task["decision_year"],
            "pdf_page": task["pdf_page"],
            "gold_bucket": task.get("gold_bucket"),
            "severity": task["severity"],
            "status": self.status(task),
        }

    def task_detail(self, index: int) -> dict[str, Any]:
        task = self.task(index)
        result = self.read_result(task)
        review = self.read_review(task)
        embedded = (
            dict(result["embedded"])
            if result
            else {
                "text": _load_embedded_page(self.extraction_root, task)["text"],
                "metrics": {
                    "quality_score": task["embedded_quality_score"],
                },
            }
        )
        embedded_text, removed_markers = clean_layout_text(embedded["text"])
        if removed_markers:
            embedded["raw_text"] = embedded.get("raw_text", embedded["text"])
            embedded["text"] = embedded_text
            embedded["metrics"] = text_metrics(embedded_text)
            embedded["removed_margin_markers"] = removed_markers

        candidates = []
        if result:
            page_width = int(result.get("render", {}).get("width_pixels", 0))
            candidates = [
                {
                    key: candidate.get(key)
                    for key in (
                        "engine",
                        "text",
                        "raw_text",
                        "mean_confidence",
                        "metrics",
                        "elapsed_seconds",
                        "error",
                        "removed_margin_markers",
                    )
                    if key in candidate
                }
                for raw_candidate in result.get("candidates", [])
                for candidate in [
                    clean_spatial_candidate(raw_candidate, page_width)
                    if page_width
                    else raw_candidate
                ]
            ]
        return {
            "summary": self.task_summary(index, task),
            "task": task,
            "embedded": embedded,
            "candidates": candidates,
            "review": review,
            "image_url": f"/api/tasks/{index}/image",
        }

    def save_review(self, index: int, payload: ReviewPayload) -> dict[str, Any]:
        task = self.task(index)
        path = self.review_path(task)
        existing = self.read_review(task)
        now = datetime.now(UTC).isoformat()
        record = {
            "schema_version": REVIEW_SCHEMA_VERSION,
            "gold_id": task.get("gold_id"),
            "sample_id": task["sample_id"],
            "pdf_page": task["pdf_page"],
            "source_sha256": task["source_sha256"],
            "selected_source": payload.selected_source,
            "corrected_text": payload.corrected_text,
            "checks": payload.checks.model_dump(),
            "verified": payload.verified,
            "notes": payload.notes,
            "created_at": existing.get("created_at", now) if existing else now,
            "updated_at": now,
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = path.with_suffix(".json.tmp")
        temporary_path.write_text(
            json.dumps(record, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary_path.replace(path)
        return record

    def image_path(self, index: int, dpi: int) -> Path:
        task = self.task(index)
        cache_path = (
            self.reviews_root
            / "images"
            / task["sample_id"]
            / f"page-{int(task['pdf_page']):04d}-{task['source_sha256'][:12]}-{dpi}.png"
        )
        if cache_path.is_file():
            return cache_path

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = cache_path.with_suffix(".png.tmp")
        with pymupdf.open(self.pdf_path(task)) as document:
            page = document[int(task["pdf_page"]) - 1]
            pixmap = page.get_pixmap(
                dpi=dpi,
                colorspace=pymupdf.csRGB,
                alpha=False,
            )
            temporary_path.write_bytes(pixmap.tobytes("png"))
        temporary_path.replace(cache_path)
        return cache_path


def create_app(
    tasks_path: Path,
    pdf_root: Path,
    extraction_root: Path,
    results_root: Path,
    reviews_root: Path,
) -> FastAPI:
    store = ReviewStore(
        tasks_path=tasks_path,
        pdf_root=pdf_root,
        extraction_root=extraction_root,
        results_root=results_root,
        reviews_root=reviews_root,
    )
    app = FastAPI(title="Judgment OCR Review", docs_url=None, redoc_url=None)

    @app.get("/api/tasks")
    async def list_tasks() -> dict[str, Any]:
        tasks = [
            store.task_summary(index, task) for index, task in enumerate(store.tasks)
        ]
        counts = {status: 0 for status in ("pending", "ready", "draft", "verified")}
        for task in tasks:
            counts[task["status"]] += 1
        return {"tasks": tasks, "counts": counts, "total": len(tasks)}

    @app.get("/api/tasks/{index}")
    async def get_task(index: Annotated[int, ApiPath(ge=0)]) -> dict[str, Any]:
        return store.task_detail(index)

    @app.get("/api/tasks/{index}/image")
    async def get_image(
        index: Annotated[int, ApiPath(ge=0)],
        dpi: Annotated[int, Query(ge=72, le=200)] = 144,
    ) -> Response:
        return Response(
            content=store.image_path(index, dpi).read_bytes(),
            media_type="image/png",
        )

    @app.put("/api/tasks/{index}/review")
    async def save_review(
        index: Annotated[int, ApiPath(ge=0)], payload: ReviewPayload
    ) -> dict[str, Any]:
        return store.save_review(index, payload)

    @app.get("/", response_class=HTMLResponse)
    async def index() -> HTMLResponse:
        return HTMLResponse((WEB_ROOT / "index.html").read_text(encoding="utf-8"))

    @app.get("/styles.css")
    async def styles() -> Response:
        return Response((WEB_ROOT / "styles.css").read_bytes(), media_type="text/css")

    @app.get("/app.js")
    async def script() -> Response:
        return Response(
            (WEB_ROOT / "app.js").read_bytes(),
            media_type="application/javascript",
            headers={"Cache-Control": "no-store"},
        )

    return app
