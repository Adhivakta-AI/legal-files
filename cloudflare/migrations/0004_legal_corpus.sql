PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legal_documents (
    id TEXT PRIMARY KEY NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('statute', 'constitution')),
    title TEXT NOT NULL,
    short_title TEXT NOT NULL,
    jurisdiction TEXT NOT NULL,
    authority TEXT NOT NULL,
    act_number TEXT,
    enacted_on TEXT,
    effective_from TEXT,
    current_through TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    source_url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    source_sha256 TEXT NOT NULL,
    corpus_version TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legal_units (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    document_id TEXT NOT NULL,
    unit_kind TEXT NOT NULL CHECK (
        unit_kind IN ('preamble', 'article', 'section', 'schedule_page')
    ),
    unit_number TEXT NOT NULL,
    parent_label TEXT,
    heading TEXT NOT NULL,
    text TEXT NOT NULL,
    pdf_page_start INTEGER,
    pdf_page_end INTEGER,
    sort_order INTEGER NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    source_sha256 TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS legal_units_document_idx
    ON legal_units(document_id, sort_order);
CREATE INDEX IF NOT EXISTS legal_units_lookup_idx
    ON legal_units(document_id, unit_kind, unit_number);

CREATE TABLE IF NOT EXISTS legal_chunks (
    rowid INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    document_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    part_index INTEGER NOT NULL CHECK (part_index > 0),
    unit_kind TEXT NOT NULL,
    unit_number TEXT NOT NULL,
    parent_label TEXT,
    heading TEXT NOT NULL,
    text TEXT NOT NULL,
    search_text TEXT NOT NULL,
    pdf_page_start INTEGER,
    pdf_page_end INTEGER,
    language TEXT NOT NULL DEFAULT 'en',
    corpus_version TEXT NOT NULL,
    FOREIGN KEY (document_id) REFERENCES legal_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (unit_id) REFERENCES legal_units(id) ON DELETE CASCADE,
    UNIQUE(unit_id, part_index)
);

CREATE INDEX IF NOT EXISTS legal_chunks_document_idx
    ON legal_chunks(document_id);
CREATE INDEX IF NOT EXISTS legal_chunks_unit_idx
    ON legal_chunks(unit_id, part_index);

CREATE VIRTUAL TABLE IF NOT EXISTS legal_chunks_fts USING fts5(
    search_text,
    content='legal_chunks',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS legal_chunks_fts_insert
AFTER INSERT ON legal_chunks BEGIN
    INSERT INTO legal_chunks_fts(rowid, search_text)
    VALUES (new.rowid, new.search_text);
END;

CREATE TRIGGER IF NOT EXISTS legal_chunks_fts_delete
AFTER DELETE ON legal_chunks BEGIN
    INSERT INTO legal_chunks_fts(legal_chunks_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
END;

CREATE TRIGGER IF NOT EXISTS legal_chunks_fts_update
AFTER UPDATE OF search_text ON legal_chunks BEGIN
    INSERT INTO legal_chunks_fts(legal_chunks_fts, rowid, search_text)
    VALUES ('delete', old.rowid, old.search_text);
    INSERT INTO legal_chunks_fts(rowid, search_text)
    VALUES (new.rowid, new.search_text);
END;

CREATE TABLE IF NOT EXISTS legal_ingestion_batches (
    batch_id TEXT PRIMARY KEY NOT NULL,
    corpus_version TEXT NOT NULL,
    document_count INTEGER NOT NULL DEFAULT 0,
    unit_count INTEGER NOT NULL DEFAULT 0,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    vector_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
