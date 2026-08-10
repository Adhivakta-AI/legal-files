# Parcha Backend

FastAPI service for PostgreSQL/pgvector hybrid search over the 500-judgment pilot corpus.

## Setup

```bash
cd backend
cp .env.example .env
# fill DATABASE_URL with a private PostgreSQL/Supabase connection string
uv sync
```

Apply the canonical schema:

```bash
uv run python scripts/apply_schema.py
```

Ingest the pilot corpus:

```bash
uv run python scripts/ingest_pilot.py
```

Verify counts and hybrid search:

```bash
uv run python scripts/verify_search.py "When can a tenant challenge a possession decree?"
```

Run the API:

```bash
uv run uvicorn app.main:app --reload
```
