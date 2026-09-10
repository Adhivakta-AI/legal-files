# Parcha OpenSearch keyword service

OpenSearch supplies lexical/BM25 candidates while Cloudflare Vectorize remains
the semantic index. The Cloudflare Worker fuses both ranked lists with RRF and
falls back to D1 FTS5 whenever this service is unconfigured or unavailable.

A separate judgment-level index powers full-text Browse queries. One document
per judgment keeps totals, pagination, sorting, and facet counts exact while D1
continues to hydrate the displayed judgment metadata. Empty Browse queries and
OpenSearch failures remain on the existing D1 path.

OpenSearch is bound to `127.0.0.1:9200`; the authenticated gateway is bound to
`127.0.0.1:7711`. Never publish port 9200 directly.

## Start a private pilot

```bash
cp .env.example .env
openssl rand -hex 32
# Put the generated value in SEARCH_GATEWAY_TOKEN inside .env.
docker compose up -d --build
node scripts/create-index.mjs http://127.0.0.1:9200 judgment-chunks-v1
```

Index a bounded sample. Imports are idempotent and checkpointed:

```bash
node scripts/import-chunks.mjs \
  --url http://127.0.0.1:9200 \
  --index judgment-chunks-v1 \
  --file /path/to/batch-02/final/chunks.jsonl.gz \
  --batch-id batch-02 \
  --limit 10000
```

After validating counts and relevance, atomically promote the index:

```bash
node scripts/promote-index.mjs \
  http://127.0.0.1:9200 judgment-chunks-v1 judgment-chunks-current
```

The public reverse proxy should expose only `POST /v1/keyword`, enforce HTTPS,
and `POST /v1/browse`, enforce HTTPS, and proxy both to `127.0.0.1:7711`.
Configure the Worker only after the pilot is healthy:

```bash
npx wrangler secret put OPENSEARCH_API_TOKEN
```

Set `OPENSEARCH_API_URL` to the HTTPS gateway URL in `wrangler.jsonc` or as a
Worker variable. Use the same token as `SEARCH_GATEWAY_TOKEN` on the VPS.

## Build the Browse index

Export the D1 metadata, create the judgment index, and import each grouped
chunk file. The importer excludes the aggregated full text from `_source`, so
it remains searchable without being duplicated in search responses.

```bash
node scripts/export-browse-metadata.mjs /tmp/browse-metadata.jsonl
node scripts/create-index.mjs http://127.0.0.1:9200 judgments-v1
node scripts/import-judgments.mjs \
  --url http://127.0.0.1:9200 \
  --index judgments-v1 \
  --metadata /tmp/browse-metadata.jsonl \
  --file /path/to/batch-02/final/chunks.jsonl.gz \
  --batch-id batch-02
node scripts/promote-index.mjs \
  http://127.0.0.1:9200 judgments-v1 judgments-current
```

## Verify

```bash
cd gateway && npm test
cd ../../cloudflare && npm run check
```
