-- Evidence-backed subject headings for the judgment reader.  Topics are kept
-- separate from judgments so machine suggestions and lawyer-reviewed metadata
-- can coexist without overwriting the source record.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS judgment_topics (
    judgment_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_chunk_id TEXT,
    provenance TEXT NOT NULL DEFAULT 'machine_extracted'
        CHECK (provenance IN ('headnote', 'judgment_text', 'machine_extracted', 'editorial')),
    review_status TEXT NOT NULL DEFAULT 'unreviewed'
        CHECK (review_status IN ('unreviewed', 'source_verified', 'lawyer_reviewed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (judgment_id, topic),
    FOREIGN KEY (judgment_id) REFERENCES judgments(id) ON DELETE CASCADE,
    FOREIGN KEY (source_chunk_id) REFERENCES chunks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS judgment_topics_judgment_order_idx
    ON judgment_topics(judgment_id, sort_order, topic);

-- The title page and headnote of [2015] 10 S.C.R. 455 identify a two-judge
-- bench: Jagdish Singh Khehar and Adarsh Kumar Goel, JJ.  The source manifest
-- retained only the abbreviated first judge, so correct this case explicitly.
INSERT OR IGNORE INTO judges(name) VALUES ('JAGDISH SINGH KHEHAR');
INSERT OR IGNORE INTO judges(name) VALUES ('ADARSH KUMAR GOEL');

DELETE FROM judgment_judges
 WHERE judgment_id = 'ISC-A7C584B29267AE158244';

INSERT INTO judgment_judges(judgment_id, judge_id, seat)
SELECT j.id, d.id, 0
  FROM judgments j JOIN judges d ON d.name = 'JAGDISH SINGH KHEHAR'
 WHERE j.id = 'ISC-A7C584B29267AE158244';

INSERT INTO judgment_judges(judgment_id, judge_id, seat)
SELECT j.id, d.id, 1
  FROM judgments j JOIN judges d ON d.name = 'ADARSH KUMAR GOEL'
 WHERE j.id = 'ISC-A7C584B29267AE158244';

UPDATE judgments
   SET judge = 'JAGDISH SINGH KHEHAR; ADARSH KUMAR GOEL',
       bench_size = 2
 WHERE id = 'ISC-A7C584B29267AE158244';

INSERT OR IGNORE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Section 311 CrPC — recall of prosecution witnesses', 1, id, 'headnote', 'source_verified'
  FROM chunks WHERE id = 'ISC-A7C584B29267AE158244:p0001:para0001:part01'
UNION ALL
SELECT judgment_id, 'Limits on witness recall and judicial discretion', 2, id, 'headnote', 'source_verified'
  FROM chunks WHERE id = 'ISC-A7C584B29267AE158244:p0001:para0001:part01'
UNION ALL
SELECT judgment_id, 'Fair trial and adequacy of defence counsel', 3, id, 'headnote', 'source_verified'
  FROM chunks WHERE id = 'ISC-A7C584B29267AE158244:p0001:para0001:part01'
UNION ALL
SELECT judgment_id, 'Protection of victims from repeated cross-examination', 4, id, 'headnote', 'source_verified'
  FROM chunks WHERE id = 'ISC-A7C584B29267AE158244:p0001:para0001:part01'
UNION ALL
SELECT judgment_id, 'Speedy trial in rape cases and criminal-justice administration', 5, id, 'headnote', 'source_verified'
  FROM chunks WHERE id = 'ISC-A7C584B29267AE158244:p0001:para0001:part02';
