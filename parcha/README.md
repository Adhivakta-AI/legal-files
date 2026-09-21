# Vidhi Kosh application

This Next.js application is the browser-facing backend-for-frontend. It owns
authentication and research orchestration; the separate `cloudflare/` Worker
owns primary-law and judgment retrieval plus document storage.

Production flow:

`Browser → OpenNext app Worker → Gemini + search Worker → D1 / Vectorize / R2`

AI Pro is a persistent, multi-turn legal chat. Threads and completed exchanges
are stored per authenticated user in the app D1 database. A bounded recent
transcript can resolve follow-ups, but it is explicitly treated as untrusted
context rather than legal authority. Each turn performs fresh primary-law and
judgment retrieval, then sends only top hybrid-ranked passages to the model. It
does not fetch or read whole judgments before answering. Every statutory
proposition and case citation is tied to an exact indexed chunk and PDF page.

The research composer has two modes:

- **Search** performs conservative spelling correction and sends the corrected
  query directly to the Cloudflare search Worker. It returns ranked cases and
  indexed passages without generating an AI memorandum.
- **AI Pro** adds context-aware query analysis, parallel primary-law and
  judgment retrieval, a citation-checked Gemini synthesis, and persistent chat
  threads with follow-up questions.

AI Pro grounding is enforced after generation. Gemini returns bounded answer
sections and the source IDs supporting each section. The server discards any
section without an allow-listed source and inserts the inline markers itself;
every marker maps to an exact indexed chunk and PDF page. It makes one corrected
generation attempt before returning a retrieval-only source review, so
unsupported draft text cannot leak to the user.

Primary-law citations open inside `/legal/[documentId]`, not on the upstream
government host. The reader streams the hash-verified original BNS, BNSS, or
Constitution PDF from the private `lex` R2 bucket through an authenticated,
byte-range-capable app route. D1 retains the official government record URL and
SHA-256 digest as provenance, and the reader exposes that record separately for
verification.

The `evaluation/` directory defines the Phase 5 lawyer-review contract and a
deterministic scorer for section accuracy, Recall@20, citation precision and
entailment, temporal applicability, hallucinated authorities, insufficient
facts, and IPC/BNS or CrPC/BNSS transitions. Draft seeds never count as gold.

The active application and search path do not use Supabase. Application auth
and AI Pro conversations are stored in the `parcha-app` Cloudflare D1 database;
legal provisions, judgment metadata, and full-text indexes are in the separate
retrieval D1 database. Separate Vectorize indexes hold primary-law and judgment
embeddings, query vectors run through Workers AI, and judgment PDFs are stored
in R2. The VPS OpenSearch service remains retrieval-only, and the repository's
legacy `backend/` PostgreSQL code is not called by this application.

## Authentication

Better Auth is mounted at `/api/auth/*` and stores users, accounts, revocable
sessions, verification tokens, rate limits, and user-owned AI Pro threads in
the dedicated `parcha-app` D1 database bound as `AUTH_DB`. Committed migrations
are applied by Wrangler, never during request handling.

- Email/password signup requires verification and a 12–128 character password.
- Google OAuth only links a verified, matching email to an already verified
  local account.
- Verification and reset links are sent through Resend and expire in one hour.
- A password reset revokes every existing session.
- Sessions have a seven-day rolling expiry and refresh at most once per day.
- `/research` has an optimistic cookie check plus authoritative D1 validation.
- `POST /api/research` independently validates the D1 session before any model
  or search work.
- `/api/research/threads/*` authorizes every read and deletion against the
  current session user; conversation IDs alone never grant access.

## Local setup

Use Node 22.13 or newer. Copy `.dev.vars.example` to `.dev.vars` and provide
server-only credentials. Also create `.env.local` with the public/local URL if
running plain `next dev`:

```bash
cp .dev.vars.example .dev.vars
printf 'NEXT_PUBLIC_SITE_URL=http://localhost:3000\nBETTER_AUTH_URL=http://localhost:3000\n' > .env.local
npm install
npm run d1:migrate:local
npm run dev
```

For local email and Google flows, configure Google callbacks and Resend for the
local application URL. Never prefix Gemini, Resend, Google client secret,
Better Auth secret, or the search service token with `NEXT_PUBLIC_`.

## Cloudflare deployment

The D1 database is configured in `wrangler.jsonc`. Set secrets on the app
Worker before production traffic is enabled:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put AUTH_EMAIL_FROM
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SEARCH_SERVICE_TOKEN
npm run d1:migrate
npm run deploy
```

Use the same random `SEARCH_SERVICE_TOKEN` on the separate search Worker. Update
`BETTER_AUTH_URL`, `NEXT_PUBLIC_SITE_URL`, and the search Worker’s `CORS_ORIGIN`
if a custom production hostname is used. Google’s authorized callback is:

`https://<application-origin>/api/auth/callback/google`

Safe structured logs include request IDs, durations, response statuses, result
counts, and model/search stages, but omit secrets, full queries, and judgment
text. Stream deployed application logs with:

```bash
npx wrangler tail lex-archives-app
```

## Verification

```bash
npm run typecheck
npm run lint
npm run build
npm run preview
```

After building, scan tracked files and browser assets for credential values.
Environment variable names may appear in server bundles by design; secret
values must not.
