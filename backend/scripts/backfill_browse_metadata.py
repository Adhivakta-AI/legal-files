"""Backfill SCC-style browse metadata into Cloudflare D1 from the OCR manifests.

Migration 0003 adds descriptive columns to `judgments` plus the `judges` /
`judgment_judges` relation and the `judgments_meta_fts` index. This script reads
every `manifest.jsonl` under the batch root and:

  1. seeds `judges` with every distinct bench member,
  2. for each judgment that exists in D1:
       - UPDATEs petitioner / respondent / neutral_citation / cnr /
         disposal_nature / available_languages / era / bench_size,
       - rewrites its `judgment_judges` rows,
  3. rebuilds `judgments_meta_fts`.

Every write is idempotent (UPDATE by id, DELETE+INSERT for the bench, ON
CONFLICT DO NOTHING for judges), so re-running after a failure is safe. Progress
is checkpointed per batch so a resumed run skips finished manifests.

Env (backend/.env): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN,
CLOUDFLARE_D1_DATABASE_ID. Override the source path with CLOUDFLARE_BATCH_ROOT.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import time
from typing import Any
import urllib.error
import urllib.request

from dotenv import load_dotenv


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BATCH_ROOT = Path("/home/shauray/judgment-ocr-data/r2-batches")
DEFAULT_CHECKPOINT = BACKEND_ROOT / ".browse-backfill-checkpoint.json"
STATEMENTS_PER_REQUEST = 100
JUDGE_SPLIT = re.compile(r"\s*,\s*")
WHITESPACE = re.compile(r"\s+")

META_COLUMNS = (
    "petitioner",
    "respondent",
    "neutral_citation",
    "cnr",
    "disposal_nature",
    "available_languages",
    "era",
)


@dataclass(frozen=True)
class CloudflareConfig:
    account_id: str
    api_token: str
    d1_database_id: str

    @classmethod
    def from_environment(cls) -> "CloudflareConfig":
        load_dotenv(BACKEND_ROOT / ".env")
        values = {
            "account_id": os.getenv("CLOUDFLARE_ACCOUNT_ID", ""),
            "api_token": os.getenv("CLOUDFLARE_API_TOKEN", ""),
            "d1_database_id": os.getenv("CLOUDFLARE_D1_DATABASE_ID", ""),
        }
        missing = [name for name, value in values.items() if not value]
        if missing:
            raise RuntimeError("Missing Cloudflare settings: " + ", ".join(missing))
        return cls(**values)


class CloudflareD1:
    def __init__(self, config: CloudflareConfig) -> None:
        self.query_url = (
            f"https://api.cloudflare.com/client/v4/accounts/{config.account_id}"
            f"/d1/database/{config.d1_database_id}/query"
        )
        self.headers = {
            "Authorization": f"Bearer {config.api_token}",
            "Content-Type": "application/json",
        }

    def _post(self, payload: dict[str, Any], *, attempts: int = 6) -> dict[str, Any]:
        body = json.dumps(payload, ensure_ascii=False).encode()
        for attempt in range(attempts):
            request = urllib.request.Request(
                self.query_url, data=body, headers=self.headers, method="POST"
            )
            try:
                with urllib.request.urlopen(request, timeout=180) as response:
                    parsed = json.load(response)
                if not parsed.get("success", False):
                    raise RuntimeError(f"D1 returned success=false: {parsed.get('errors')}")
                return parsed
            except urllib.error.HTTPError as exc:
                retryable = exc.code == 429 or 500 <= exc.code < 600
                if not retryable or attempt == attempts - 1:
                    detail = exc.read().decode("utf-8", "replace")[:500]
                    raise RuntimeError(f"D1 HTTP {exc.code}: {detail}") from exc
            except urllib.error.URLError as exc:
                if attempt == attempts - 1:
                    raise RuntimeError("D1 network failure") from exc
            time.sleep(min(2**attempt, 20))
        raise AssertionError("unreachable")

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"sql": sql}
        if params is not None:
            payload["params"] = list(params)
        result = self._post(payload)["result"]
        first = result[0] if result else {}
        return first.get("results", []) if isinstance(first, dict) else []

    def batch(self, statements: Sequence[dict[str, Any]]) -> None:
        for start in range(0, len(statements), STATEMENTS_PER_REQUEST):
            group = statements[start : start + STATEMENTS_PER_REQUEST]
            parsed = self._post({"batch": list(group)})
            results = parsed.get("result") or []
            if len(results) != len(group) or not all(
                item.get("success", False) for item in results
            ):
                raise RuntimeError("One or more D1 batch statements failed")


def clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = WHITESPACE.sub(" ", value).strip()
    return trimmed or None


def parse_judges(value: Any) -> list[str]:
    text = clean(value)
    if not text:
        return []
    seen: dict[str, None] = {}
    for part in JUDGE_SPLIT.split(text):
        name = WHITESPACE.sub(" ", part).strip().strip(".").strip()
        if name:
            seen.setdefault(name, None)
    return list(seen)


def read_manifest(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if line.strip():
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Invalid JSON at {path}:{line_number}") from exc


def discover_manifests(root: Path) -> list[Path]:
    return sorted(root.glob("*/manifest.jsonl"))


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_checkpoint(path: Path, data: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def existing_judgment_ids(db: CloudflareD1) -> set[str]:
    ids: set[str] = set()
    last = ""
    while True:
        rows = db.execute(
            "SELECT id FROM judgments WHERE id > ? ORDER BY id LIMIT 5000", [last]
        )
        if not rows:
            break
        for row in rows:
            ids.add(row["id"])
        last = rows[-1]["id"]
        if len(rows) < 5000:
            break
    return ids


def seed_judges(db: CloudflareD1, manifests: list[Path]) -> int:
    names: set[str] = set()
    for path in manifests:
        for record in read_manifest(path):
            names.update(parse_judges(record.get("judge")))
    statements = [
        {"sql": "INSERT INTO judges(name) VALUES (?) ON CONFLICT(name) DO NOTHING", "params": [name]}
        for name in sorted(names)
    ]
    db.batch(statements)
    return len(names)


def judgment_statements(record: dict[str, Any]) -> list[dict[str, Any]]:
    judgment_id = record.get("sample_id")
    if not isinstance(judgment_id, str) or not judgment_id:
        return []

    judges = parse_judges(record.get("judge"))
    meta = {column: clean(record.get(_manifest_key(column))) for column in META_COLUMNS}

    statements: list[dict[str, Any]] = [
        {
            "sql": """
                UPDATE judgments SET
                    petitioner = ?,
                    respondent = ?,
                    neutral_citation = ?,
                    cnr = ?,
                    disposal_nature = ?,
                    available_languages = ?,
                    era = ?,
                    bench_size = ?
                WHERE id = ?
            """,
            "params": [
                meta["petitioner"],
                meta["respondent"],
                meta["neutral_citation"],
                meta["cnr"],
                meta["disposal_nature"],
                meta["available_languages"],
                meta["era"],
                len(judges) or None,
                judgment_id,
            ],
        },
        {
            "sql": "DELETE FROM judgment_judges WHERE judgment_id = ?",
            "params": [judgment_id],
        },
    ]
    for seat, name in enumerate(judges):
        statements.append(
            {
                "sql": """
                    INSERT INTO judgment_judges(judgment_id, judge_id, seat)
                    SELECT ?, id, ? FROM judges WHERE name = ?
                    ON CONFLICT(judgment_id, judge_id) DO NOTHING
                """,
                "params": [judgment_id, seat, name],
            }
        )
    return statements


def _manifest_key(column: str) -> str:
    return "case_id" if column == "neutral_citation" else column


def backfill(
    db: CloudflareD1,
    manifests: list[Path],
    known_ids: set[str],
    checkpoint_path: Path,
    checkpoint: dict[str, Any],
    flush_every: int,
) -> tuple[int, int]:
    updated = 0
    skipped = 0
    pending: list[dict[str, Any]] = []

    def flush() -> None:
        if pending:
            db.batch(pending)
            pending.clear()

    for path in manifests:
        key = path.parent.name
        if checkpoint.get(key) == "done":
            continue
        processed_in_batch = 0
        for record in read_manifest(path):
            if record.get("sample_id") not in known_ids:
                skipped += 1
                continue
            pending.extend(judgment_statements(record))
            updated += 1
            processed_in_batch += 1
            if len(pending) >= flush_every:
                flush()
        flush()
        checkpoint[key] = "done"
        save_checkpoint(checkpoint_path, checkpoint)
        print(f"[{key}] backfilled {processed_in_batch:,} judgments")

    return updated, skipped


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--batch-root",
        type=Path,
        default=Path(os.getenv("CLOUDFLARE_BATCH_ROOT", DEFAULT_BATCH_ROOT)),
    )
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument(
        "--flush-every",
        type=int,
        default=400,
        help="Approximate number of D1 statements to buffer before POSTing.",
    )
    parser.add_argument(
        "--skip-judge-seed",
        action="store_true",
        help="Assume `judges` is already populated (resume mode).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.batch_root.is_dir():
        raise SystemExit(f"Batch root not found: {args.batch_root}")

    manifests = discover_manifests(args.batch_root)
    if not manifests:
        raise SystemExit(f"No manifest.jsonl under {args.batch_root}")
    print(f"discovered {len(manifests)} manifest(s): {', '.join(p.parent.name for p in manifests)}")

    db = CloudflareD1(CloudflareConfig.from_environment())
    checkpoint = load_checkpoint(args.checkpoint)

    print("loading existing judgment ids from D1 ...")
    known_ids = existing_judgment_ids(db)
    print(f"  {len(known_ids):,} judgments in D1")

    if args.skip_judge_seed or checkpoint.get("_judges_seeded"):
        print("skipping judge seed")
    else:
        print("seeding judges ...")
        count = seed_judges(db, manifests)
        checkpoint["_judges_seeded"] = True
        save_checkpoint(args.checkpoint, checkpoint)
        print(f"  {count:,} distinct judges")

    updated, skipped = backfill(
        db, manifests, known_ids, args.checkpoint, checkpoint, args.flush_every
    )

    print("rebuilding judgments_meta_fts ...")
    db.execute("INSERT INTO judgments_meta_fts(judgments_meta_fts) VALUES('rebuild')")

    print(f"done: {updated:,} judgments backfilled, {skipped:,} manifest rows skipped (not in D1)")


if __name__ == "__main__":
    main()
