import sqlite3
import unittest

from scripts.apply_judgment_metadata_audit import bulk_statements


class ApplyJudgmentMetadataAuditTests(unittest.TestCase):
    def test_bulk_statements_update_metadata_coram_and_author(self) -> None:
        db = sqlite3.connect(":memory:")
        db.executescript(
            """
            CREATE TABLE judgments (
                id TEXT PRIMARY KEY,
                judge TEXT,
                bench_size INTEGER,
                case_number TEXT,
                cnr TEXT,
                metadata_source TEXT,
                metadata_checked_at TEXT
            );
            CREATE TABLE judges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE judgment_judges (
                judgment_id TEXT NOT NULL,
                judge_id INTEGER NOT NULL,
                seat INTEGER NOT NULL,
                PRIMARY KEY (judgment_id, judge_id)
            );
            CREATE TABLE judgment_authors (
                judgment_id TEXT NOT NULL,
                judge_id INTEGER NOT NULL,
                sort_order INTEGER NOT NULL,
                PRIMARY KEY (judgment_id, judge_id)
            );
            INSERT INTO judgments(id, judge, bench_size, cnr)
            VALUES ('J1', 'OLD JUDGE', 1, 'CNR1');
            """
        )
        row = {
            "judgment_id": "J1",
            "source_url": "https://example.test/metadata.json",
            "parsed": {
                "judges": ["FIRST JUDGE", "SECOND JUDGE"],
                "author_judges": ["FIRST JUDGE"],
                "bench_size": 2,
                "case_number": "Criminal Appeal No. 1 of 2026",
                "cnr": "CNR1",
            },
        }

        for statement in bulk_statements([row]):
            db.execute(statement["sql"], statement["params"])

        judgment = db.execute(
            "SELECT judge, bench_size, case_number, metadata_source FROM judgments"
        ).fetchone()
        self.assertEqual(
            judgment,
            (
                "FIRST JUDGE; SECOND JUDGE",
                2,
                "Criminal Appeal No. 1 of 2026",
                "https://example.test/metadata.json",
            ),
        )
        coram = db.execute(
            """
            SELECT judges.name FROM judgment_judges
            JOIN judges ON judges.id = judgment_judges.judge_id
            ORDER BY judgment_judges.seat
            """
        ).fetchall()
        self.assertEqual(coram, [("FIRST JUDGE",), ("SECOND JUDGE",)])
        authors = db.execute(
            """
            SELECT judges.name FROM judgment_authors
            JOIN judges ON judges.id = judgment_authors.judge_id
            ORDER BY judgment_authors.sort_order
            """
        ).fetchall()
        self.assertEqual(authors, [("FIRST JUDGE",)])


if __name__ == "__main__":
    unittest.main()
