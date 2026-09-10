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

`GET /health` remains public. `POST /api/search` and `POST /api/context`
require `Authorization: Bearer <SEARCH_SERVICE_TOKEN>` and return `401` before
any AI, D1, or Vectorize work when the token is absent or invalid. The context
endpoint returns bounded, ordered indexed chunks for at most five retrieved
judgments so the app can perform deep, case-specific synthesis. `CORS_ORIGIN`
is restricted to the deployed application origin and should be updated if the
production hostname changes.

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
