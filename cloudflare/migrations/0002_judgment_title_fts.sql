CREATE VIRTUAL TABLE IF NOT EXISTS judgments_fts USING fts5(
    title,
    citation,
    content='judgments',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS judgments_fts_insert AFTER INSERT ON judgments BEGIN
    INSERT INTO judgments_fts(rowid, title, citation)
    VALUES (new.rowid, new.title, COALESCE(new.citation, ''));
END;

CREATE TRIGGER IF NOT EXISTS judgments_fts_delete AFTER DELETE ON judgments BEGIN
    INSERT INTO judgments_fts(judgments_fts, rowid, title, citation)
    VALUES ('delete', old.rowid, old.title, COALESCE(old.citation, ''));
END;

CREATE TRIGGER IF NOT EXISTS judgments_fts_update AFTER UPDATE OF title, citation ON judgments BEGIN
    INSERT INTO judgments_fts(judgments_fts, rowid, title, citation)
    VALUES ('delete', old.rowid, old.title, COALESCE(old.citation, ''));
    INSERT INTO judgments_fts(rowid, title, citation)
    VALUES (new.rowid, new.title, COALESCE(new.citation, ''));
END;

INSERT INTO judgments_fts(rowid, title, citation)
SELECT rowid, title, COALESCE(citation, '') FROM judgments;
