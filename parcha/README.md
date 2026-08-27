# Lex Archives

Lex Archives is a citation-grounded research workspace for Indian Supreme Court
case law. It lives in the existing Parcha Next.js application and uses the
already-populated Cloudflare search index as its only retrieval source.

## Research pipeline

`POST /api/research` returns newline-delimited JSON so every real pipeline stage
can be rendered as it happens:

1. **Spelling** — Gemini conservatively normalizes legal terms and likely party-
   name errors, with deterministic rules for common mistakes such as `POSCO` →
   `POCSO` as a fallback.
2. **Acronyms** — Indian legal abbreviations are expanded before retrieval.
3. **Legal context** — the request is classified as case-law lookup, statute
   lookup, doctrine explanation, or drafting, and relevant legal concepts are
   attached to the retrieval query.
4. **Retrieval** — the enriched query is sent to the existing Cloudflare
   endpoint, which combines D1 FTS5 and 384-dimensional BGE Vectorize results
   with reciprocal-rank fusion. If a year-constrained search is empty, the
   server retries without the year range.
5. **Generation** — Gemini receives only the retrieved chunks and an allow-list
   of their `judgment_id` values. The server validates every inline source marker,
   replaces model-supplied citation metadata with search API metadata, and retries
   once if a substantive paragraph is not grounded.

The browser never calls Gemini or Cloudflare directly. `GEMINI_API_KEY` is read
only in server-only modules imported by the Next.js Route Handler.

## Run locally

The key already stored in `backend/.env` can be loaded directly into the Next.js
server process without copying it or exposing it to the browser:

```bash
cd parcha
npm install
npm run dev:local
```

Open [http://localhost:3000/research](http://localhost:3000/research).

For deployment, set the values shown in `.env.example` in the host's server
environment. The key currently exists in `backend/.env`. Do not rename it to
`NEXT_PUBLIC_GEMINI_API_KEY`, import it into a Client Component, or commit
`.env.local`.

## Verification

```bash
npm run lint
npm run typecheck
npm run build
```

After a production build, client assets can be checked for accidental secret
references with:

```bash
rg -n "GEMINI_API_KEY|generativelanguage.googleapis.com" .next/static
```

That command should return no matches. The server bundle will contain the
environment variable name and Gemini hostname by design; it must not contain the
key value.
