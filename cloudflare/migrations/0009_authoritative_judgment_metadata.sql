-- Full coram and labelled case-number metadata parsed from the existing
-- Supreme Court Reports upstream metadata JSON. The original PDF remains the
-- source document; these fields only enrich Browse and the PDF side panel.

PRAGMA foreign_keys = ON;

ALTER TABLE judgments ADD COLUMN case_number TEXT;
ALTER TABLE judgments ADD COLUMN metadata_source TEXT;
ALTER TABLE judgments ADD COLUMN metadata_checked_at TEXT;

CREATE INDEX IF NOT EXISTS judgments_case_number_idx ON judgments(case_number);

CREATE TABLE IF NOT EXISTS judgment_authors (
    judgment_id TEXT NOT NULL,
    judge_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (judgment_id, judge_id),
    FOREIGN KEY (judgment_id) REFERENCES judgments(id) ON DELETE CASCADE,
    FOREIGN KEY (judge_id) REFERENCES judges(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS judgment_authors_judge_id_idx
    ON judgment_authors(judge_id);
