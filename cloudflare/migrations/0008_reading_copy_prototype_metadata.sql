-- Source-verified metadata for the first judgment reading-copy prototype.
-- These rows are deliberately scoped to the two audited records.

PRAGMA foreign_keys = ON;

-- The published title page of [2026] 7 S.C.R. 581 names
-- Sanjay Karol and Nongmeikapam Kotiswar Singh, JJ. The ingestion manifest
-- retained only an abbreviated Kotiswar Singh entry.
INSERT OR IGNORE INTO judges(name) VALUES ('SANJAY KAROL');
INSERT OR IGNORE INTO judges(name) VALUES ('NONGMEIKAPAM KOTISWAR SINGH');

DELETE FROM judgment_judges
 WHERE judgment_id = 'ISC-14738EAB816B5B6BAB4C';

INSERT INTO judgment_judges(judgment_id, judge_id, seat)
SELECT j.id, d.id, 0
  FROM judgments j
  JOIN judges d ON d.name = 'SANJAY KAROL'
 WHERE j.id = 'ISC-14738EAB816B5B6BAB4C';

INSERT INTO judgment_judges(judgment_id, judge_id, seat)
SELECT j.id, d.id, 1
  FROM judgments j
  JOIN judges d ON d.name = 'NONGMEIKAPAM KOTISWAR SINGH'
 WHERE j.id = 'ISC-14738EAB816B5B6BAB4C';

UPDATE judgments
   SET judge = 'SANJAY KAROL; NONGMEIKAPAM KOTISWAR SINGH',
       bench_size = 2
 WHERE id = 'ISC-14738EAB816B5B6BAB4C';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Section 14(1)(b) of the Delhi Rent Control Act', 1, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-14738EAB816B5B6BAB4C:p0013:para0003:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Effect of bank amalgamation on tenancy rights', 2, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-14738EAB816B5B6BAB4C:p0015:para0004:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Assignment or parting with possession', 3, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-14738EAB816B5B6BAB4C:p0018:para0002:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Section 45 Banking Regulation Act schemes', 4, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-14738EAB816B5B6BAB4C:p0019:para0004:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Voluntary and involuntary transfer of tenancy', 5, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-14738EAB816B5B6BAB4C:p0018:para0004:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'AI hallucinations in judicial decision-making', 1, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-3389B4314DCC5735F45B:p0009:para0004:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Duty to verify AI-generated authorities', 2, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-3389B4314DCC5735F45B:p0006:para0003:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Human oversight and control over legal AI', 3, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-3389B4314DCC5735F45B:p0005:para0003:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Professional misconduct and accountability for fake citations', 4, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-3389B4314DCC5735F45B:p0006:para0003:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Bar Council of India directions on AI-generated material', 5, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-3389B4314DCC5735F45B:p0006:para0005:part01';

INSERT OR REPLACE INTO judgment_topics(
    judgment_id, topic, sort_order, source_chunk_id, provenance, review_status
)
SELECT judgment_id, 'Section 7 Insolvency and Bankruptcy Code proceedings', 6, id,
       'judgment_text', 'source_verified'
  FROM chunks
 WHERE id = 'ISC-3389B4314DCC5735F45B:p0007:para0003:part01';
