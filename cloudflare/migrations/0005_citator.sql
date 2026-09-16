-- Evidence-first Supreme Court citator graph. Extraction can populate
-- unreviewed mentions, but treatment must remain visibly provisional until
-- supported by a pinpoint passage and, for negative treatment, lawyer review.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS citation_mentions (
    id TEXT PRIMARY KEY NOT NULL,
    citing_judgment_id TEXT NOT NULL,
    citing_chunk_id TEXT NOT NULL,
    cited_judgment_id TEXT,
    cited_case_name TEXT NOT NULL,
    cited_reporter_citation TEXT,
    pdf_page INTEGER NOT NULL CHECK (pdf_page > 0),
    evidence_text TEXT NOT NULL,
    resolution_status TEXT NOT NULL DEFAULT 'unresolved' CHECK (
        resolution_status IN ('unresolved', 'candidate', 'resolved', 'ambiguous')
    ),
    match_confidence REAL CHECK (
        match_confidence IS NULL OR
        (match_confidence >= 0.0 AND match_confidence <= 1.0)
    ),
    extractor_version TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (citing_judgment_id) REFERENCES judgments(id) ON DELETE CASCADE,
    FOREIGN KEY (citing_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
    FOREIGN KEY (cited_judgment_id) REFERENCES judgments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS citation_mentions_citing_idx
    ON citation_mentions(citing_judgment_id);
CREATE INDEX IF NOT EXISTS citation_mentions_cited_idx
    ON citation_mentions(cited_judgment_id);
CREATE INDEX IF NOT EXISTS citation_mentions_resolution_idx
    ON citation_mentions(resolution_status);

CREATE TABLE IF NOT EXISTS citation_treatments (
    mention_id TEXT PRIMARY KEY NOT NULL,
    treatment TEXT NOT NULL CHECK (
        treatment IN (
            'followed', 'applied', 'relied_on', 'approved', 'distinguished',
            'doubted', 'disapproved', 'overruled', 'referred_to', 'unknown'
        )
    ),
    treatment_scope TEXT NOT NULL DEFAULT 'unspecified' CHECK (
        treatment_scope IN ('whole_case', 'holding', 'proposition', 'unspecified')
    ),
    evidence_text TEXT NOT NULL,
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    review_status TEXT NOT NULL DEFAULT 'machine_extracted' CHECK (
        review_status IN ('machine_extracted', 'lawyer_reviewed', 'rejected')
    ),
    reviewer_id TEXT,
    reviewed_at TEXT,
    extractor_version TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mention_id) REFERENCES citation_mentions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS citation_treatments_treatment_idx
    ON citation_treatments(treatment, review_status);
