"""Apply only verified rows from a judgment metadata audit to Cloudflare D1.

The command is a dry run unless ``--apply-d1`` is supplied. Migration 0009
must be applied first. Rows with fetch errors, coram/count conflicts, or CNR
conflicts are never written.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    from backfill_browse_metadata import (
        CloudflareConfig,
        CloudflareD1,
        existing_judgment_ids,
    )
except ModuleNotFoundError:  # Imported as backend.scripts.* by tests.
    from scripts.backfill_browse_metadata import (
        CloudflareConfig,
        CloudflareD1,
        existing_judgment_ids,
    )


ROWS_PER_WRITE = 400


def load_verified(path: Path) -> tuple[list[dict[str, Any]], dict[str, int]]:
    verified: list[dict[str, Any]] = []
    counts = {"verified": 0, "review": 0, "invalid": 0}
    with path.open("rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            parsed = row.get("parsed")
            if not isinstance(parsed, dict):
                counts["invalid"] += 1
                continue
            judges = parsed.get("judges")
            bench_size = parsed.get("bench_size")
            safe = (
                parsed.get("status") == "verified"
                and isinstance(judges, list)
                and judges
                and all(isinstance(name, str) and name.strip() for name in judges)
                and isinstance(bench_size, int)
                and bench_size == len(judges)
                and row.get("cnr_matches_manifest") is not False
                and isinstance(row.get("judgment_id"), str)
                and isinstance(row.get("source_url"), str)
            )
            if not safe:
                counts["review"] += 1
                continue
            row["_line"] = line_number
            verified.append(row)
            counts["verified"] += 1
    return verified, counts


def write_payload(rows: list[dict[str, Any]]) -> str:
    return json.dumps(
        [
            {
                "id": row["judgment_id"],
                "judges": row["parsed"]["judges"],
                "authors": row["parsed"].get("author_judges") or [],
                "judge": "; ".join(row["parsed"]["judges"]),
                "bench_size": row["parsed"]["bench_size"],
                "case_number": row["parsed"].get("case_number"),
                "cnr": row["parsed"].get("cnr"),
                "source_url": row["source_url"],
            }
            for row in rows
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def bulk_statements(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Represent a repair page as six set-based, transactional statements."""
    payload = write_payload(rows)
    repairs = "SELECT value AS item FROM json_each(?)"
    return [
        {
            "sql": f"""
                WITH repairs AS ({repairs}), names AS (
                    SELECT DISTINCT names.value AS name
                      FROM repairs, json_each(json_extract(item, '$.judges')) names
                    UNION
                    SELECT DISTINCT authors.value AS name
                      FROM repairs, json_each(json_extract(item, '$.authors')) authors
                )
                INSERT INTO judges(name)
                SELECT name FROM names WHERE name IS NOT NULL
                ON CONFLICT(name) DO NOTHING
            """,
            "params": [payload],
        },
        {
            "sql": f"""
                WITH repairs AS ({repairs})
                UPDATE judgments SET
                    judge = (SELECT json_extract(item, '$.judge') FROM repairs
                              WHERE json_extract(item, '$.id') = judgments.id),
                    bench_size = (SELECT json_extract(item, '$.bench_size') FROM repairs
                                  WHERE json_extract(item, '$.id') = judgments.id),
                    case_number = (SELECT json_extract(item, '$.case_number') FROM repairs
                                   WHERE json_extract(item, '$.id') = judgments.id),
                    cnr = COALESCE(
                        (SELECT json_extract(item, '$.cnr') FROM repairs
                          WHERE json_extract(item, '$.id') = judgments.id), cnr
                    ),
                    metadata_source = (
                        SELECT json_extract(item, '$.source_url') FROM repairs
                         WHERE json_extract(item, '$.id') = judgments.id
                    ),
                    metadata_checked_at = CURRENT_TIMESTAMP
                WHERE id IN (SELECT json_extract(item, '$.id') FROM repairs)
            """,
            "params": [payload],
        },
        {
            "sql": f"""
                WITH repairs AS ({repairs})
                DELETE FROM judgment_judges
                 WHERE judgment_id IN (SELECT json_extract(item, '$.id') FROM repairs)
            """,
            "params": [payload],
        },
        {
            "sql": f"""
                WITH repairs AS ({repairs})
                INSERT INTO judgment_judges(judgment_id, judge_id, seat)
                SELECT json_extract(item, '$.id'), judges.id, CAST(names.key AS INTEGER)
                  FROM repairs
                  JOIN json_each(json_extract(item, '$.judges')) names
                  JOIN judges ON judges.name = names.value
                 WHERE 1
                ON CONFLICT(judgment_id, judge_id) DO UPDATE SET seat = excluded.seat
            """,
            "params": [payload],
        },
        {
            "sql": f"""
                WITH repairs AS ({repairs})
                DELETE FROM judgment_authors
                 WHERE judgment_id IN (SELECT json_extract(item, '$.id') FROM repairs);
            """,
            "params": [payload],
        },
        {
            "sql": f"""
                WITH repairs AS ({repairs})
                INSERT INTO judgment_authors(judgment_id, judge_id, sort_order)
                SELECT json_extract(item, '$.id'), judges.id, CAST(authors.key AS INTEGER)
                  FROM repairs
                  JOIN json_each(json_extract(item, '$.authors')) authors
                  JOIN judges ON judges.name = authors.value
                 WHERE 1
                ON CONFLICT(judgment_id, judge_id)
                DO UPDATE SET sort_order = excluded.sort_order
            """,
            "params": [payload],
        },
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audit", type=Path)
    parser.add_argument("--apply-d1", action="store_true")
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rows, counts = load_verified(args.audit)
    if args.limit is not None:
        rows = rows[: args.limit]
    group_count = (len(rows) + ROWS_PER_WRITE - 1) // ROWS_PER_WRITE
    statement_count = group_count * len(bulk_statements(rows[:1])) if rows else 0
    print(
        json.dumps(
            {
                "event": "metadata_apply.plan",
                "audit_counts": counts,
                "eligible_rows": len(rows),
                "statements": statement_count,
                "mode": "apply" if args.apply_d1 else "dry_run",
            },
            indent=2,
        )
    )
    if not args.apply_d1:
        return

    db = CloudflareD1(CloudflareConfig.from_environment())
    known_ids = existing_judgment_ids(db)

    eligible = [row for row in rows if row["judgment_id"] in known_ids]
    applied = 0
    for start in range(0, len(eligible), ROWS_PER_WRITE):
        page = eligible[start : start + ROWS_PER_WRITE]
        db.batch(bulk_statements(page))
        applied += len(page)
        if applied % 1000 == 0:
            print(json.dumps({"event": "metadata_apply.progress", "applied": applied}))
    print(
        json.dumps(
            {
                "event": "metadata_apply.complete",
                "applied": applied,
                "skipped_missing_in_d1": len(rows) - len(eligible),
            }
        )
    )


if __name__ == "__main__":
    main()
