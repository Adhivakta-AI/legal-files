# Parcha Cloudflare Search

Hybrid legal-judgment search using Workers AI, Vectorize, D1 FTS5, and the
existing R2 bucket. Query embeddings use `@cf/baai/bge-small-en-v1.5` with
`cls` pooling, matching the existing local FastEmbed vectors.

When `OPENSEARCH_API_URL` and `OPENSEARCH_API_TOKEN` are configured, keyword
candidates come from the authenticated OpenSearch gateway in `../opensearch`.
Vectorize remains the semantic index, and the Worker fuses both lists with RRF.
OpenSearch failures automatically fall back to D1 FTS5.

When `OPENSEARCH_BROWSE_API_URL` is configured, non-empty Browse keyword
queries use the judgment-level OpenSearch index. It searches full judgment
text and metadata while preserving Browse filters, exact totals, pagination,
sorting, and facets. Empty Browse queries and gateway failures continue to use
D1.

Explicit party-name and reported-citation queries use the `judgments_fts`
metadata index first. Direct judgment matches are returned ahead of passage
matches, preventing later judgments that merely cite the requested case from
displacing the original authority.

Cloudflare credentials stay in `backend/.env`; never commit or copy them into
Worker variables.

Create the search service secret before deployment. Use the same randomly
generated value as `SEARCH_SERVICE_TOKEN` in the `parcha` Worker; browsers
must never receive it:

```bash
npx wrangler secret put SEARCH_SERVICE_TOKEN
```

```bash
cd cloudflare
npm install
npm run check
npm run d1:migrate
npm run deploy
```

`GET /health` remains public. `POST /api/search`, `POST /api/legal-search`, and
`POST /api/context` require `Authorization: Bearer
<SEARCH_SERVICE_TOKEN>` and return `401` before any AI, D1, or Vectorize work
when the token is absent or invalid. AI Pro uses the two search endpoints in
parallel and sends only their ranked passages to synthesis; it does not fetch
whole-judgment context. The bounded context endpoint remains available for
explicit deep-reading workflows. `CORS_ORIGIN` is restricted to the deployed
application origin and should be updated if the production hostname changes.

Stream production search and judgment-context logs with:

```bash
npx wrangler tail parcha-search-api
```

The local importer is idempotent and checkpoints only after D1 and Vectorize
both accept a group:

```bash
backend/.venv/bin/python backend/scripts/ingest_cloudflare.py
```

Use `--batch-id batch-02 --limit 100` for a bounded test. The default discovers
all locally completed batches and resumes from
`backend/.cloudflare-ingest-checkpoint.json`.

## Authoritative judgment metadata repair

The original ingestion manifest's `judge` field is often only the authoring
judge, not the full coram. Build a read-only audit from the existing upstream
metadata JSON and the already-extracted opening-page OCR:

```bash
backend/.venv/bin/python backend/scripts/audit_judgment_metadata.py \
  --output /tmp/parcha-judgment-metadata-audit.jsonl

backend/.venv/bin/python backend/scripts/apply_judgment_metadata_audit.py \
  /tmp/parcha-judgment-metadata-audit.jsonl
```

The second command is a dry run. After reviewing the audit, apply migration
`0009_authoritative_judgment_metadata.sql`, then pass `--apply-d1`. Only rows
with an internally consistent coram/bench count and no CNR conflict are
eligible. The repair adds the labelled case number, full coram, author link,
and provenance; it does not regenerate or replace any PDF.

## Primary-law corpus

Primary law is isolated from judgment passages in the dedicated
`parcha-legal-provisions` Vectorize index. Canonical document metadata,
provision text, page locations, and an FTS5 keyword index live in the existing
`parcha-judgments` D1 database. This lets the legal answer flow retrieve and
cite sections/articles independently from case-law retrieval.

Migration `0005_citator.sql` adds the evidence-first citator graph. Citation
mentions retain the citing chunk, PDF page, extracted case name/citation,
optional resolved judgment, and resolver confidence. Treatment labels retain
their own pinpoint evidence and review status; negative treatment must not be
presented as authoritative merely because a machine extracted it.

`POST /api/citator` accepts `judgment_id`, optional `limit`, and optional
`reviewed_only`. It returns inbound treatments with the citing judgment,
pinpoint chunk/page, mention evidence, resolution confidence, treatment scope,
and review status. The endpoint remains service-token protected; the public app
should default to `reviewed_only: true` for negative-treatment warnings.

Create the 384-dimensional cosine index once, then enable metadata filters
before the first vector upload:

```bash
npx wrangler vectorize create parcha-legal-provisions \
  --dimensions 384 \
  --metric cosine \
  --env-file ../backend/.env

npx wrangler vectorize create-metadata-index parcha-legal-provisions \
  --propertyName document_id --type string --env-file ../backend/.env
npx wrangler vectorize create-metadata-index parcha-legal-provisions \
  --propertyName source_kind --type string --env-file ../backend/.env
npx wrangler vectorize create-metadata-index parcha-legal-provisions \
  --propertyName unit_kind --type string --env-file ../backend/.env
npx wrangler vectorize create-metadata-index parcha-legal-provisions \
  --propertyName unit_number --type string --env-file ../backend/.env
npx wrangler vectorize create-metadata-index parcha-legal-provisions \
  --propertyName language --type string --env-file ../backend/.env
npx wrangler vectorize create-metadata-index parcha-legal-provisions \
  --propertyName corpus_version --type string --env-file ../backend/.env
```

Apply the additive D1 migration and ingest the locally built legal corpus:

```bash
cd cloudflare
npx wrangler d1 migrations apply parcha-judgments \
  --remote --env-file ../backend/.env

cd ..
backend/.venv/bin/python backend/scripts/ingest_legal_corpus.py \
  --corpus-root /tmp/parcha-legal-corpus-current
```

The importer validates all document, unit, chunk, and vector IDs before remote
writes. It uses idempotent D1 and Vectorize upserts and resumes from
`backend/.legal-corpus-ingest-checkpoint.json` after an interruption.
