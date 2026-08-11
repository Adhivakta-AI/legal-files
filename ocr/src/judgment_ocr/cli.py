"""Command-line entry point for the OCR benchmark."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from judgment_ocr.batch import (
    download_batch,
    extract_batch,
    partition_tasks,
    verify_batch,
)
from judgment_ocr.embedding import DEFAULT_MODEL
from judgment_ocr.finalize import build_fallback_queue, finalize_documents
from judgment_ocr.runner import run_tasks
from judgment_ocr.sampling import (
    DEFAULT_ACTIONS,
    build_gold_set,
    load_candidates,
    select_balanced_pages,
    write_jsonl,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="judgment-ocr")
    parser.add_argument("--verbose", action="store_true")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sample = subparsers.add_parser("sample", help="create a balanced page task list")
    sample.add_argument("--extraction-root", type=Path, required=True)
    sample.add_argument("--output", type=Path, required=True)
    sample.add_argument("--limit", type=int, default=100)
    sample.add_argument("--seed", default="judgment-ocr-gold-v1")
    sample.add_argument(
        "--actions",
        default=",".join(sorted(DEFAULT_ACTIONS)),
        help="comma-separated page actions to include",
    )

    queue = subparsers.add_parser("queue", help="create a task list for every page")
    queue.add_argument("--extraction-root", type=Path, required=True)
    queue.add_argument("--output", type=Path, required=True)
    queue.add_argument(
        "--actions",
        default=",".join(sorted(DEFAULT_ACTIONS)),
        help="comma-separated page actions to include",
    )

    gold = subparsers.add_parser("gold", help="create a review-ready gold set")
    gold.add_argument("--extraction-root", type=Path, required=True)
    gold.add_argument("--output", type=Path, required=True)
    gold.add_argument("--flagged", type=int, default=80)
    gold.add_argument("--clean", type=int, default=20)
    gold.add_argument("--seed", default="judgment-ocr-gold-v1")

    run = subparsers.add_parser("run", help="run local OCR engines on page tasks")
    run.add_argument("--tasks", type=Path, required=True)
    run.add_argument("--pdf-root", type=Path, required=True)
    run.add_argument("--extraction-root", type=Path, required=True)
    run.add_argument("--output-root", type=Path, required=True)
    run.add_argument("--engines", default="paddle,tesseract")
    run.add_argument("--device", default="cpu")
    run.add_argument("--dpi", type=int, default=300)
    run.add_argument("--force", action="store_true")
    run.add_argument("--max-pages", type=int)
    run.add_argument("--worker-id")

    download = subparsers.add_parser(
        "download", help="download and verify PDFs from a batch manifest"
    )
    download.add_argument("--manifest", type=Path, required=True)
    download.add_argument("--pdf-root", type=Path, required=True)
    download.add_argument("--audit-root", type=Path, required=True)
    download.add_argument("--workers", type=int, default=8)

    extract = subparsers.add_parser(
        "extract", help="extract embedded PDF text and classify pages"
    )
    extract.add_argument("--manifest", type=Path, required=True)
    extract.add_argument("--downloads", type=Path, required=True)
    extract.add_argument("--extraction-root", type=Path, required=True)
    extract.add_argument("--workers", type=int, default=2)

    partition = subparsers.add_parser(
        "partition", help="split a page task list across OCR workers"
    )
    partition.add_argument("--tasks", type=Path, required=True)
    partition.add_argument("--output-root", type=Path, required=True)
    partition.add_argument("--workers", type=int, required=True)

    verify = subparsers.add_parser(
        "verify-batch", help="validate finalized batch output and write checksums"
    )
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--extraction-root", type=Path, required=True)
    verify.add_argument("--final-root", type=Path, required=True)
    verify.add_argument("--output-root", type=Path, required=True)

    review = subparsers.add_parser("review", help="serve the local review app")
    review.add_argument("--tasks", type=Path, required=True)
    review.add_argument("--pdf-root", type=Path, required=True)
    review.add_argument("--extraction-root", type=Path, required=True)
    review.add_argument("--results-root", type=Path, required=True)
    review.add_argument("--reviews-root", type=Path, required=True)
    review.add_argument("--host", default="127.0.0.1")
    review.add_argument("--port", type=int, default=8000)

    fallback = subparsers.add_parser(
        "fallback", help="create the Paddle queue from completed Tesseract results"
    )
    fallback.add_argument("--tasks", type=Path, required=True)
    fallback.add_argument("--tesseract-root", type=Path, required=True)
    fallback.add_argument("--output", type=Path, required=True)
    fallback.add_argument("--confidence-threshold", type=float, default=75.0)

    finalize = subparsers.add_parser(
        "finalize", help="assemble canonical page text and search chunks"
    )
    finalize.add_argument("--manifest", type=Path, required=True)
    finalize.add_argument("--extraction-root", type=Path, required=True)
    finalize.add_argument("--tasks", type=Path, required=True)
    finalize.add_argument("--tesseract-root", type=Path, required=True)
    finalize.add_argument("--paddle-root", type=Path)
    finalize.add_argument("--output-root", type=Path, required=True)

    embed = subparsers.add_parser(
        "embed", help="generate resumable local embedding shards"
    )
    embed.add_argument("--chunks", type=Path, required=True)
    embed.add_argument("--output-root", type=Path, required=True)
    embed.add_argument("--cache-dir", type=Path, required=True)
    embed.add_argument("--model", default=DEFAULT_MODEL)
    embed.add_argument("--dimensions", type=int, default=384)
    embed.add_argument("--shard-size", type=int, default=1000)
    embed.add_argument("--batch-size", type=int, default=128)
    embed.add_argument("--threads", type=int)
    embed.add_argument("--parallel", type=int)
    embed.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    if args.command == "download":
        print(
            json.dumps(
                download_batch(
                    args.manifest, args.pdf_root, args.audit_root, args.workers
                ),
                indent=2,
            )
        )
        return

    if args.command == "extract":
        print(
            json.dumps(
                extract_batch(
                    args.manifest,
                    args.downloads,
                    args.extraction_root,
                    args.workers,
                ),
                indent=2,
            )
        )
        return

    if args.command == "partition":
        print(
            json.dumps(
                partition_tasks(args.tasks, args.output_root, args.workers), indent=2
            )
        )
        return

    if args.command == "verify-batch":
        print(
            json.dumps(
                verify_batch(
                    args.manifest,
                    args.extraction_root,
                    args.final_root,
                    args.output_root,
                ),
                indent=2,
            )
        )
        return

    if args.command == "sample":
        actions = frozenset(action.strip() for action in args.actions.split(","))
        candidates = load_candidates(args.extraction_root, actions)
        selected = select_balanced_pages(candidates, args.limit, args.seed)
        write_jsonl(args.output, selected)
        print(
            json.dumps(
                {
                    "candidate_pages": len(candidates),
                    "selected_pages": len(selected),
                    "output": str(args.output),
                },
                indent=2,
            )
        )
        return

    if args.command == "queue":
        actions = frozenset(action.strip() for action in args.actions.split(","))
        candidates = load_candidates(args.extraction_root, actions)
        candidates.sort(
            key=lambda item: (item["era"], item["sample_id"], item["pdf_page"])
        )
        write_jsonl(args.output, candidates)
        print(
            json.dumps(
                {"queued_pages": len(candidates), "output": str(args.output)},
                indent=2,
            )
        )
        return

    if args.command == "gold":
        records = build_gold_set(
            args.extraction_root,
            flagged_count=args.flagged,
            clean_count=args.clean,
            seed=args.seed,
        )
        write_jsonl(args.output, records)
        print(
            json.dumps(
                {
                    "selected_pages": len(records),
                    "flagged_pages": args.flagged,
                    "clean_pages": args.clean,
                    "output": str(args.output),
                },
                indent=2,
            )
        )
        return

    if args.command == "review":
        import uvicorn

        from judgment_ocr.review import create_app

        app = create_app(
            tasks_path=args.tasks,
            pdf_root=args.pdf_root,
            extraction_root=args.extraction_root,
            results_root=args.results_root,
            reviews_root=args.reviews_root,
        )
        uvicorn.run(app, host=args.host, port=args.port)
        return

    if args.command == "fallback":
        summary = build_fallback_queue(
            tasks_path=args.tasks,
            tesseract_root=args.tesseract_root,
            output_path=args.output,
            confidence_threshold=args.confidence_threshold,
        )
        print(json.dumps(summary, indent=2))
        return

    if args.command == "finalize":
        summary = finalize_documents(
            manifest_path=args.manifest,
            extraction_root=args.extraction_root,
            tasks_path=args.tasks,
            tesseract_root=args.tesseract_root,
            paddle_root=args.paddle_root,
            output_root=args.output_root,
        )
        print(json.dumps(summary, indent=2))
        return

    if args.command == "embed":
        from judgment_ocr.embedding import embed_chunks

        summary = embed_chunks(
            chunks_path=args.chunks,
            output_root=args.output_root,
            cache_dir=args.cache_dir,
            model_name=args.model,
            dimensions=args.dimensions,
            shard_size=args.shard_size,
            batch_size=args.batch_size,
            threads=args.threads,
            parallel=args.parallel,
            device=args.device,
        )
        print(json.dumps(summary, indent=2))
        return

    engine_names = [name.strip() for name in args.engines.split(",") if name.strip()]
    summary = run_tasks(
        tasks_path=args.tasks,
        pdf_root=args.pdf_root,
        extraction_root=args.extraction_root,
        output_root=args.output_root,
        engine_names=engine_names,
        device=args.device,
        dpi=args.dpi,
        force=args.force,
        max_pages=args.max_pages,
        worker_id=args.worker_id,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
