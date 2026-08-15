# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

A recruitment intake app implementing PRD v0.6: a public, forwardable link that
reads candidate details out of an uploaded resume, and a read-only admin
dashboard with filtering and CSV export. Records are held 36 months under a DPDP
consent notice, with candidate-initiated withdrawal and a 30-day re-consent
cycle. `README.md` documents deviations from the PRD and known gaps.

## Commands

```bash
npm run dev            # dev server (no configuration needed — see Two shapes below)
npm test               # 182 tests
npm run typecheck      # runs `next typegen` first; PageProps/RouteContext are generated
npm run lint
npm run build

npm run db:migrate     # apply migrations
npm run db:seed        # institution type-ahead list
npm run db:generate    # regenerate SQL after editing lib/db/schema.ts
npm run outbox         # read the stubbed mailbox, incl. withdrawal links
npm run fixtures       # generate sample resumes into fixtures/
```

A single test file, or one test by name:

```bash
npx vitest run tests/heuristic.test.ts
npx vitest run -t "blocks an exact match on email and both names"
```

**Only one process may hold the local database at a time.** PGlite is in-process;
opening the same data directory twice corrupts it, so `db:migrate`, `db:seed` and
`outbox` refuse to run while `npm run dev` is up (`lib/db/pglite-lock.ts`). Stop
the dev server first. The restriction disappears under a real Postgres.

## Two shapes from one codebase

Which backend runs is decided in `lib/env.ts` and nowhere else. Callers only ever
see the adapter.

| | Local (no config) | Production |
|---|---|---|
| Database | PGlite, embedded | Postgres/Neon via `DATABASE_URL` |
| Resume storage | disk, `.storage/` | Vercel Blob via `BLOB_READ_WRITE_TOKEN` |
| Bot control | Turnstile test keys (always pass) | real Turnstile keys |
| Email | `outbox` table, never sent | **not implemented** |

**The local backends refuse to run in production.** Missing `DATABASE_URL` or
`BLOB_READ_WRITE_TOKEN` under `NODE_ENV=production` throws
(`missingProductionConfig`). This exists because the earlier silent fallback wrote
to a serverless filesystem that is read-only at runtime and discarded on
redeploy — appearing to work while losing every application. The check runs on
first use, not at module load, because `next build` also runs as production; the
db handle is a lazy proxy in `lib/db/index.ts` to make that possible. Don't make
it eager.

## Load-bearing decisions

Changing any of these without understanding why will reintroduce a real bug.

- **The duplicate rule is a unique index**, not a `SELECT` before `INSERT`
  (`submissions_identity_unique` over the normalised email and name columns). Two
  concurrent identical submissions both pass a check-then-insert; only the index
  stops the second. `lib/submissions.ts` catches the violation — note it walks
  `error.cause`, since Drizzle wraps driver errors.
- **`months_to_expiry` is computed on read** (`lib/export-columns.ts`), never
  stored. A column written at insert is wrong the following month.
- **Withdrawal is a POST behind a confirmation page.** `GET /withdraw/[token]`
  only renders. Mail scanners and link previews fetch URLs; a destructive GET
  would erase records before the candidate opened the email.
- **Withdrawal tokens are stored as SHA-256** (`lib/tokens.ts`). The plaintext
  exists only in the email, so a database read cannot be turned into deletion.
  This is also why there is no outbox screen in the admin UI — it would hand a
  read-only admin a deletion capability. Use `npm run outbox`.
- **The dashboard and CSV export share one query builder** (`lib/queries.ts`,
  `parseFilters` + `buildWhere`), so "what is on screen is what downloads" holds
  structurally. Don't add a second query path for the export.
- **The admin session carries a read-only scope.** Every admin route calls
  `assertReadOnlyRequest` (`lib/auth/admin.ts`), which refuses any mutating
  method regardless of the UI.
- **`CONSENT_NOTICE_VERSION`** in `lib/domain/constants.ts` is stamped on every
  submission. Bump it whenever `components/ConsentNotice.tsx` wording changes, or
  you lose the ability to prove what a candidate agreed to.
- **`ConsentNotice` must stay a server component.** It reads organisation and DPO
  names from env, absent in the browser bundle. It is passed into the client
  `ApplyForm` as a `consentNotice` slot; rendering it inside the client component
  hydrates those to placeholder defaults on the notice the candidate is
  consenting to.

## Resume reading (`lib/parse/`)

Three routes, tried in order:

1. `extract.ts` — text layer via `unpdf` (PDF) or `mammoth` (`.docx`).
2. `heuristic.ts` — **no API key, no cost**, so it runs first for text resumes. Derives
   fields from patterns, section structure, and the seeded institution list
   (`lib/institutions.ts`), which is what makes institution matching reliable.
3. `llm.ts` — Claude, only when `ANTHROPIC_API_KEY` is set. Handles scanned PDFs
   (no text to read) by sending the PDF as a `document` block rather than
   rasterising locally. Falls back to the heuristic result on failure or refusal.

Legacy `.doc` has no serverless parser and routes to manual entry with the file
still stored. `parse_method` records which route ran.

## Conventions that differ from what you may expect

- **Next.js 16**: `params`/`searchParams`/`cookies()`/`headers()` are all async.
  `PageProps<'/route'>` and `RouteContext<'/route'>` are generated globals — run
  `next typegen` if they appear missing. Middleware is called **proxy** here.
- **Zod 4**: `z.email()` not `z.string().email()`; `error` not `errorMap`;
  `ctx.addIssue({ code: 'custom' })`.
- **`@electric-sql/pglite` is in `serverExternalPackages`** (`next.config.ts`).
  Bundling it breaks its WASM filesystem resolution with a cross-realm `URL`
  error on every query.
- **`<body>` carries `suppressHydrationWarning`** for extension-injected
  attributes. It applies one level deep, so genuine mismatches inside the app
  still surface — don't widen it.
- **Migrations use Neon's direct connection**, not the pooled one
  (`scripts/connection.ts`): DDL depends on session state that PgBouncer's
  transaction pooling does not preserve. Resolution order is
  `MIGRATE_DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DATABASE_URL`.

## Testing

Vitest, `tests/setup.ts` points the db singleton at in-memory PGlite and seeds
env vars. `tests/helpers/db.ts` provides `resetDatabase()` plus valid submission
fixtures. Tests run against real Postgres semantics, so transactional and
unique-index behaviour is genuinely exercised.

When testing the resume reader, add cases to `tests/heuristic.test.ts` using
layouts that differ from the existing ones — fitting the parser to a single
resume shape is how its two real bugs got in.
