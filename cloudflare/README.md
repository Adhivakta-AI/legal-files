# Parcha Cloudflare Search

Hybrid legal-judgment search using Workers AI, Vectorize, D1 FTS5, and the
existing R2 bucket. Query embeddings use `@cf/baai/bge-small-en-v1.5` with
`cls` pooling, matching the existing local FastEmbed vectors.

Cloudflare credentials stay in `backend/.env`; never commit or copy them into
Worker variables.

```bash
cd cloudflare
npm install
npm run check
npm run d1:migrate
npm run deploy
```

The local importer is idempotent and checkpoints only after D1 and Vectorize
both accept a group:

```bash
backend/.venv/bin/python backend/scripts/ingest_cloudflare.py
```

Use `--batch-id batch-02 --limit 100` for a bounded test. The default discovers
all locally completed batches and resumes from
`backend/.cloudflare-ingest-checkpoint.json`.
