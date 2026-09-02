# Lex Archives application

This Next.js application is the browser-facing backend-for-frontend. It owns
authentication and research orchestration; the separate `cloudflare/` Worker
owns judgment retrieval and document storage.

Production flow:

`Browser → OpenNext app Worker → Gemini + search Worker → D1 / Vectorize / R2`

Every submission is an independent research request; previous results are not
sent back as conversational context. After passage retrieval, AI Pro requests
bounded indexed text for the top five judgments and asks the model for a
query-specific relevance explanation tied to an exact supporting chunk.
Exceptionally long judgments are marked as truncated rather than being
represented as completely read.

The research composer has two modes:

- **Search** performs conservative spelling correction and sends the corrected
  query directly to the Cloudflare search Worker. It returns ranked cases and
  indexed passages without generating an AI memorandum.
- **AI Pro** adds query analysis, bounded judgment-context retrieval, and a
  citation-checked Gemini synthesis with query-specific relevance notes.

The active application and search path do not use Supabase. Application auth
is stored in Cloudflare D1; judgment metadata and full-text indexes are in D1,
embeddings are searched with Vectorize and Workers AI, and PDFs are stored in
R2. The repository's legacy `backend/` PostgreSQL code is not called by this
application.

## Authentication

Better Auth is mounted at `/api/auth/*` and stores users, accounts, revocable
sessions, verification tokens, and rate limits in the dedicated `parcha-app` D1
database bound as `AUTH_DB`. The committed migration is applied by Wrangler,
never during request handling.

- Email/password signup requires verification and a 12–128 character password.
- Google OAuth only links a verified, matching email to an already verified
  local account.
- Verification and reset links are sent through Resend and expire in one hour.
- A password reset revokes every existing session.
- Sessions have a seven-day rolling expiry and refresh at most once per day.
- `/research` has an optimistic cookie check plus authoritative D1 validation.
- `POST /api/research` independently validates the D1 session before any model
  or search work.

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
