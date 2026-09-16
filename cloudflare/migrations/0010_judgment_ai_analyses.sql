-- Shared, source-versioned cache for AI Pro judgment summaries and timelines.
-- The original PDF and indexed chunks remain the authorities; this table only
-- stores regenerable AI output and is invalidated when the chunk fingerprint changes.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS judgment_ai_analyses (
    judgment_id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL,
    source_fingerprint TEXT NOT NULL,
    analysis_json TEXT NOT NULL,
    source_chunk_count INTEGER NOT NULL,
    analysed_chunk_count INTEGER NOT NULL,
    generated_at TEXT NOT NULL,
    FOREIGN KEY (judgment_id) REFERENCES judgments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS judgment_ai_analyses_generated_at_idx
    ON judgment_ai_analyses(generated_at);
