# Judgment Search MVP Handoff

Last updated: 2026-08-11

## Objective

Build a legal-search MVP over a 500-judgment Indian Supreme Court pilot. The
application repository contains an existing Next.js frontend. Add a FastAPI
backend that embeds each user query, runs PostgreSQL full-text plus pgvector
semantic search, fuses the rankings, and returns PDF-page citations.

The longer-term dataset contains roughly 35,000 judgments. Do not optimize the
MVP around only 500 records in ways that prevent scaling to the full corpus.

## Repository Roles

### Data preparation repository

Absolute path:

```text
/home/shauray/Downloads/unemployment/indian-supreme-court-judgments
```

Pilot pipeline:

```text
/home/shauray/Downloads/unemployment/indian-supreme-court-judgments/judgment-search-pilot
```

This repository owns PDF selection, downloading, text extraction, OCR,
post-processing, chunking, and bulk document embeddings. Keep Tesseract,
PaddleOCR, PDFs, and generated OCR data here.

### Application repository

Absolute path:

```text
/home/shauray/Downloads/legal-files
```

This repository currently contains the Next.js application. Add the FastAPI
backend here. It should own database ingestion, query embedding, hybrid search,
the HTTP API, and frontend integration. Do not copy OCR dependencies or the PDF
corpus into this repository.

## Completed Pilot

The sample contains 500 judgments, balanced as follows:

| Era | Judgments |
| --- | ---: |
| 1950-1969 | 100 |
| 1970-1989 | 100 |
| 1990-2009 | 100 |
| 2010-2019 | 100 |
| 2020 onward | 100 |

Processing totals:

| Item | Count |
| --- | ---: |
| Judgments | 500 |
| PDF pages | 8,146 |
| Search chunks | 31,368 |
| Embedded-text pages | 2,862 |
| Tesseract pages | 5,261 |
| Paddle fallback pages | 23 |
| Pages still marked for visual review | 10 |
| Skipped non-searchable fragments | 1,211 |

All 5,284 flagged pages were processed by Tesseract successfully. Paddle was
used only for 23 fallback pages across 14 judgments. Margin letters such as A,
B, and C were removed only when layout evidence identified them as report
margin markers. Raw OCR candidates remain preserved separately.

## Canonical Data Artifacts

### Manifest

```text
/home/shauray/Downloads/unemployment/indian-supreme-court-judgments/pilot/manifest.jsonl
```

One JSON object per judgment. Important fields include `sample_id`, `title`,
`petitioner`, `respondent`, `judge`, `author_judge`, `citation`, `case_id`,
`cnr`, `decision_date`, `decision_year`, `era`, `pdf_key`, `pdf_url`, and PDF
validation metadata.

### Finalized documents

```text
/home/shauray/Downloads/unemployment/indian-supreme-court-judgments/judgment-search-pilot/work/final/documents/
```

There is one `PILOT-nnnn.json.gz` file per judgment. Each record contains:

```text
schema_version
sample_id
source_sha256
metadata
pages[]
```

Each page contains:

```text
pdf_page
text
source
confidence
quality_score
removed_margin_markers
needs_review
```

### Search chunks

```text
/home/shauray/Downloads/unemployment/indian-supreme-court-judgments/judgment-search-pilot/work/final/chunks.jsonl.gz
```

Each JSONL record contains:

```text
id
sample_id
pdf_page
paragraph_index
paragraph_number
part_index
text
text_source
title
decision_date
decision_year
era
judge
citation
pdf_url
```

Example chunk ID:

```text
PILOT-0001:p0001:para0001:part01
```

Paragraphs are split at 220 words with a 30-word overlap. Paragraph numbering
is retained when detected; otherwise `paragraph_number` is null. Every chunk
contains enough information to return a PDF URL and PDF page citation.

### Embeddings

```text
/home/shauray/Downloads/unemployment/indian-supreme-court-judgments/judgment-search-pilot/work/embeddings-gpu/
```

Embedding configuration:

```text
Model: BAAI/bge-small-en-v1.5
Dimensions: 384
Data type: float32
Normalized: true
Chunks: 31,368
Shards: 32
Shard size: 1,000, except the final shard
```

Every `.npz` shard contains:

```text
ids      # chunk IDs
vectors  # shape (number_of_ids, 384)
```

The IDs align one-to-one with `chunks.jsonl.gz`. The finalized chunk-file SHA256
recorded during embedding is:

```text
408c6315280128983d5d17f2e994ad84493f105c2a9d5e2e1d9ec8500dec4cf7
```

Do not regenerate these document embeddings for the MVP.

## PostgreSQL and pgvector

The canonical SQL migration is:

```text
/home/shauray/Downloads/unemployment/indian-supreme-court-judgments/judgment-search-pilot/sql/001_schema.sql
```

The migration now creates all objects explicitly in `public`:

```text
public.judgments
public.judgment_pages
public.chunks
public.judgment_search_set_updated_at()
public.hybrid_search(...)
```

`public.chunks.embedding` is `VECTOR(384)`. Its generated `search_vector`
column is indexed with GIN, and `embedding` is indexed with HNSW cosine
operators. `public.hybrid_search` uses Reciprocal Rank Fusion to combine full
text and semantic candidates.

RLS is enabled on all three public tables. No anon/authenticated policies exist
yet. This is intentional: the frontend must not access corpus tables directly.
FastAPI should use a private PostgreSQL connection string. Never put database
credentials or a Supabase service-role key into client-side Next.js variables.

An earlier version of the migration created an empty `judgment_search` custom
schema. After the revised public migration has been applied and the public
tables verified, the obsolete schema can be removed in Supabase:

```sql
DROP SCHEMA IF EXISTS judgment_search CASCADE;
```

Confirm the current database state before ingestion. Do not assume that the
revised public migration has already been run.

## Application Architecture

Use this boundary:

```text
Next.js browser client
        |
        v
FastAPI HTTP endpoint
        |
        +--> BAAI/bge-small-en-v1.5 query embedding
        |
        v
Supabase PostgreSQL: public.hybrid_search(...)
```

Do not query Supabase directly from browser code for search. FastAPI owns input
validation, query embedding, database access, result shaping, rate limiting,
and later authentication/authorization.

Suggested application layout:

```text
legal-files/
  app/                         # existing Next.js routes
  components/                  # existing frontend components
  backend/
    app/
      __init__.py
      main.py
      config.py
      database.py
      schemas.py
      embeddings.py
      search.py
    scripts/
      ingest_pilot.py
    tests/
    pyproject.toml
    uv.lock
```

The backend does not need PaddleOCR, Tesseract, PyMuPDF, or CUDA. Use CPU query
embeddings because only one query is embedded per request. Use the same BGE
model and 384 dimensions as the stored document vectors. Prefer FastEmbed's
query-specific embedding API when available, and verify normalization and
dimension before querying pgvector.

Recommended initial backend dependencies:

```text
fastapi
uvicorn[standard]
pydantic-settings
asyncpg
pgvector
fastembed
```

Manage the backend with `uv`. Keep secrets in `backend/.env`, exclude that file
from Git, and provide a `.env.example` containing names only.

## Ingestion Requirements

Implement a resumable, idempotent `backend/scripts/ingest_pilot.py` that:

1. Reads the manifest and 500 finalized document files.
2. Upserts `public.judgments`.
3. Upserts all `public.judgment_pages`.
4. Reads `chunks.jsonl.gz` and upserts all `public.chunks` text records.
5. Reads all 32 NPZ shards and matches vectors by chunk ID.
6. Updates each vector together with:
   - `embedding_model = 'BAAI/bge-small-en-v1.5'`
   - `embedded_at = now()`
7. Uses transactions and batches rather than one commit per row.
8. Can be rerun without creating duplicates.
9. Fails if chunk IDs and vector IDs differ, dimensions are not 384, values are
   non-finite, or expected counts do not match.

Expected post-ingestion counts:

```text
public.judgments:      500
public.judgment_pages: 8,146
public.chunks:         31,368
chunks with embedding: 31,368
```

Do not commit generated PDFs, OCR output, NPZ vectors, model caches, or database
credentials into the application repository. They are one-time ingestion
inputs; after ingestion, the deployed application depends on PostgreSQL only.

## Initial Search API

Implement:

```http
POST /api/search
Content-Type: application/json
```

Initial request shape:

```json
{
  "query": "When can a tenant challenge a possession decree?",
  "limit": 10,
  "year_from": 1950,
  "year_to": 2026
}
```

Validate query length, cap `limit`, validate year ranges, embed the query, and
call `public.hybrid_search(...)` with the text and vector.

Return at least:

```text
chunk_id
judgment_id
title
citation
decision_date
judge
chunk_text
pdf_url
pdf_page
paragraph_number
text_source
keyword_score
semantic_score
rrf_score
```

The frontend should link citations to:

```text
${pdf_url}#page=${pdf_page}
```

Current citations are page-level. OCR bounding boxes and exact line highlights
are not stored. Do not claim exact line-level citation support.

## Verification Before Frontend Integration

1. Confirm the revised migration created the three tables in `public`.
2. Confirm RLS is enabled and no browser roles can query base tables.
3. Run ingestion and verify all four expected counts.
4. Confirm every vector is non-null and has the expected model name.
5. Run keyword-only, semantic-only, and hybrid searches.
6. Confirm returned chunk IDs map back to the correct judgment and page.
7. Open several `${pdf_url}#page=${pdf_page}` links and verify the returned
   passage against the visible PDF page.
8. Add backend tests before wiring the Next.js interface.
9. After integration, ask 50 legal questions and manually verify every returned
   citation against its PDF.

## Immediate Next Task for Codex

Read this document, inspect the existing Next.js repository and its AGENTS.md,
then implement the FastAPI backend foundation and the resumable pilot ingestion
script. Do not redesign the frontend until database ingestion and a tested
hybrid-search endpoint work end to end.

