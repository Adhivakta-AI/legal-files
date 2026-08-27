PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS judgments (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    citation TEXT,
    decision_date TEXT,
    decision_year INTEGER,
    judge TEXT,
    court TEXT NOT NULL DEFAULT 'Supreme Court of India',
    pdf_url TEXT NOT NULL,
    pdf_key TEXT,
    batch_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS judgments_decision_year_idx ON judgments(decision_year);

CREATE TABLE IF NOT EXISTS chunks (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    judgment_id TEXT NOT NULL,
    pdf_page INTEGER NOT NULL CHECK (pdf_page > 0),
    paragraph_index INTEGER NOT NULL,
    paragraph_number TEXT,
    part_index INTEGER NOT NULL,
    text TEXT NOT NULL,
    text_source TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    FOREIGN KEY (judgment_id) REFERENCES judgments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS chunks_judgment_id_idx ON chunks(judgment_id);
CREATE INDEX IF NOT EXISTS chunks_batch_id_idx ON chunks(batch_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE OF text ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE IF NOT EXISTS ingestion_batches (
    batch_id TEXT PRIMARY KEY NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    vector_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
