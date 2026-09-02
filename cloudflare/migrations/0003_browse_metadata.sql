-- Browse/filter metadata for the SCC-style judgment browser.
-- Adds descriptive columns backfilled from the OCR batch manifests, a
-- normalized judge <-> judgment relation for bench faceting, and a metadata
-- FTS index that covers party names and citations.

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------------
-- judgments: descriptive columns (all nullable; backfilled out of band)
-- --------------------------------------------------------------------------
ALTER TABLE judgments ADD COLUMN petitioner TEXT;
ALTER TABLE judgments ADD COLUMN respondent TEXT;
ALTER TABLE judgments ADD COLUMN neutral_citation TEXT;   -- e.g. "1994 INSC 606"
ALTER TABLE judgments ADD COLUMN cnr TEXT;                 -- Case Number Record
ALTER TABLE judgments ADD COLUMN disposal_nature TEXT;     -- e.g. "Appeal(s) allowed"
ALTER TABLE judgments ADD COLUMN available_languages TEXT; -- CSV of ISO-ish codes
ALTER TABLE judgments ADD COLUMN era TEXT;                 -- e.g. "1990-2009"
ALTER TABLE judgments ADD COLUMN bench_size INTEGER;       -- count of judges on the bench

CREATE INDEX IF NOT EXISTS judgments_decision_date_idx ON judgments(decision_date);
CREATE INDEX IF NOT EXISTS judgments_disposal_nature_idx ON judgments(disposal_nature);
CREATE INDEX IF NOT EXISTS judgments_era_idx ON judgments(era);
CREATE INDEX IF NOT EXISTS judgments_bench_size_idx ON judgments(bench_size);
CREATE INDEX IF NOT EXISTS judgments_neutral_citation_idx ON judgments(neutral_citation);
CREATE INDEX IF NOT EXISTS judgments_cnr_idx ON judgments(cnr);

-- --------------------------------------------------------------------------
-- judges: one row per distinct bench member, linked many-to-many
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS judges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS judgment_judges (
    judgment_id TEXT NOT NULL,
    judge_id INTEGER NOT NULL,
    seat INTEGER NOT NULL DEFAULT 0,   -- position as listed on the manifest
    PRIMARY KEY (judgment_id, judge_id),
    FOREIGN KEY (judgment_id) REFERENCES judgments(id) ON DELETE CASCADE,
    FOREIGN KEY (judge_id) REFERENCES judges(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS judgment_judges_judge_id_idx ON judgment_judges(judge_id);

-- --------------------------------------------------------------------------
-- judgments_meta_fts: title + parties + citations for the browse keyword box
-- (external-content FTS5 over judgments, kept in sync by triggers; the
--  backfill runs a one-off 'rebuild' after populating the new columns)
-- --------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS judgments_meta_fts USING fts5(
    title,
    petitioner,
    respondent,
    citation,
    neutral_citation,
    content='judgments',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS judgments_meta_fts_insert AFTER INSERT ON judgments BEGIN
    INSERT INTO judgments_meta_fts(
        rowid, title, petitioner, respondent, citation, neutral_citation
    ) VALUES (
        new.rowid,
        new.title,
        COALESCE(new.petitioner, ''),
        COALESCE(new.respondent, ''),
        COALESCE(new.citation, ''),
        COALESCE(new.neutral_citation, '')
    );
END;

CREATE TRIGGER IF NOT EXISTS judgments_meta_fts_delete AFTER DELETE ON judgments BEGIN
    INSERT INTO judgments_meta_fts(
        judgments_meta_fts, rowid, title, petitioner, respondent, citation, neutral_citation
    ) VALUES (
        'delete',
        old.rowid,
        old.title,
        COALESCE(old.petitioner, ''),
        COALESCE(old.respondent, ''),
        COALESCE(old.citation, ''),
        COALESCE(old.neutral_citation, '')
    );
END;

CREATE TRIGGER IF NOT EXISTS judgments_meta_fts_update
AFTER UPDATE OF title, petitioner, respondent, citation, neutral_citation ON judgments BEGIN
    INSERT INTO judgments_meta_fts(
        judgments_meta_fts, rowid, title, petitioner, respondent, citation, neutral_citation
    ) VALUES (
        'delete',
        old.rowid,
        old.title,
        COALESCE(old.petitioner, ''),
        COALESCE(old.respondent, ''),
        COALESCE(old.citation, ''),
        COALESCE(old.neutral_citation, '')
    );
    INSERT INTO judgments_meta_fts(
        rowid, title, petitioner, respondent, citation, neutral_citation
    ) VALUES (
        new.rowid,
        new.title,
        COALESCE(new.petitioner, ''),
        COALESCE(new.respondent, ''),
        COALESCE(new.citation, ''),
        COALESCE(new.neutral_citation, '')
    );
END;

INSERT INTO judgments_meta_fts(
    rowid, title, petitioner, respondent, citation, neutral_citation
)
SELECT
    rowid,
    title,
    COALESCE(petitioner, ''),
    COALESCE(respondent, ''),
    COALESCE(citation, ''),
    COALESCE(neutral_citation, '')
FROM judgments;
