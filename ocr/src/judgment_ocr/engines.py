"""Local OCR engine adapters with a common result schema."""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any, Protocol

import numpy as np
import pytesseract
from PIL import Image
from pytesseract import Output

from judgment_ocr.quality import text_metrics


class OcrEngine(Protocol):
    name: str

    def recognize(self, image: Image.Image) -> dict[str, Any]: ...


class TesseractEngine:
    name = "tesseract"

    def recognize(self, image: Image.Image) -> dict[str, Any]:
        started = time.monotonic()
        data = pytesseract.image_to_data(
            image,
            lang="eng",
            config="--oem 1 --psm 3 -c preserve_interword_spaces=1",
            output_type=Output.DICT,
        )

        grouped: dict[tuple[int, int, int, int], list[int]] = defaultdict(list)
        for index, text in enumerate(data["text"]):
            if text.strip():
                key = tuple(
                    int(data[field][index])
                    for field in ("page_num", "block_num", "par_num", "line_num")
                )
                grouped[key].append(index)

        lines = []
        for indexes in grouped.values():
            words = [data["text"][index] for index in indexes]
            confidences = [
                float(data["conf"][index])
                for index in indexes
                if float(data["conf"][index]) >= 0
            ]
            left = min(int(data["left"][index]) for index in indexes)
            top = min(int(data["top"][index]) for index in indexes)
            right = max(
                int(data["left"][index]) + int(data["width"][index])
                for index in indexes
            )
            bottom = max(
                int(data["top"][index]) + int(data["height"][index])
                for index in indexes
            )
            lines.append(
                {
                    "text": " ".join(words),
                    "confidence": round(sum(confidences) / len(confidences), 4)
                    if confidences
                    else None,
                    "bbox": [left, top, right, bottom],
                }
            )

        text = "\n".join(line["text"] for line in lines)
        confidences = [line["confidence"] for line in lines if line["confidence"]]
        return {
            "engine": self.name,
            "text": text,
            "mean_confidence": round(sum(confidences) / len(confidences), 4)
            if confidences
            else None,
            "lines": lines,
            "metrics": text_metrics(text),
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }


class PaddleEngine:
    name = "paddle"

    def __init__(self, device: str = "cpu") -> None:
        from paddleocr import PaddleOCR

        self._ocr = PaddleOCR(
            text_detection_model_name="PP-OCRv5_server_det",
            text_recognition_model_name="PP-OCRv5_server_rec",
            device=device,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

    def recognize(self, image: Image.Image) -> dict[str, Any]:
        started = time.monotonic()
        results = list(self._ocr.predict(np.asarray(image)))
        if not results:
            raise RuntimeError("PaddleOCR returned no result")

        result_json = results[0].json
        payload = result_json.get("res", result_json)
        texts = [str(text) for text in payload.get("rec_texts", [])]
        scores = [float(score) for score in payload.get("rec_scores", [])]
        boxes = payload.get("rec_boxes", [])

        lines = []
        for index, text in enumerate(texts):
            box = boxes[index] if index < len(boxes) else None
            if hasattr(box, "tolist"):
                box = box.tolist()
            lines.append(
                {
                    "text": text,
                    "confidence": round(scores[index], 6)
                    if index < len(scores)
                    else None,
                    "bbox": box,
                }
            )

        text = "\n".join(texts)
        return {
            "engine": self.name,
            "text": text,
            "mean_confidence": round(sum(scores) / len(scores), 6) if scores else None,
            "lines": lines,
            "metrics": text_metrics(text),
            "elapsed_seconds": round(time.monotonic() - started, 3),
        }


def create_engines(names: list[str], device: str) -> list[OcrEngine]:
    engines: list[OcrEngine] = []
    for name in names:
        if name == "tesseract":
            engines.append(TesseractEngine())
        elif name == "paddle":
            engines.append(PaddleEngine(device=device))
        else:
            raise ValueError(f"Unknown OCR engine: {name}")
    return engines
