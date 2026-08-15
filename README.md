# Resume Intake & Triage

Implements PRD v0.6. A public, forwardable application link that reads candidate
details out of an uploaded resume, and a read-only dashboard for the hiring team
with filtering and CSV export. Records are held for 36 months under an explicit
DPDP consent notice, with candidate-initiated withdrawal and a 30-day re-consent
cycle.

## Quick start

Requires Node 20+. Nothing else — no Docker, no database to install, no cloud
account.

```bash
npm install
cp .env.example .env.local     # set ADMIN_PASSWORD and SESSION_SECRET
npm run db:migrate
npm run db:seed                # institution type-ahead list
npm run dev
```

Then open <http://localhost:3000/apply>. The dashboard is at
<http://localhost:3000/admin>.

To exercise the parser, generate the sample resumes and upload one:

```bash
npm run fixtures
```

That writes four files under `fixtures/`, one for each route through the parser:
a PDF with a text layer, a scanned PDF with none, a `.docx`, and a legacy `.doc`.

## How it runs

The same code runs in two shapes, chosen entirely by environment variables. No
caller knows which backend it is talking to.

| | Local (default) | Production |
|---|---|---|
| Database | PGlite — Postgres compiled to WebAssembly, in-process | Neon, via `DATABASE_URL` |
| Resume storage | Local disk under `.storage/` | Vercel Blob, via `BLOB_READ_WRITE_TOKEN` |
| Bot control | Cloudflare's always-passes test keys | Real Turnstile keys |
| Email | Written to the `outbox` table, never sent | *(not yet wired — see Known gaps)* |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Full test suite (148 tests) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply migrations |
| `npm run db:generate` | Regenerate migration SQL after a schema change |
| `npm run db:seed` | Load the institution list |
| `npm run outbox` | Print the stubbed mailbox, including withdrawal links |
| `npm run fixtures` | Generate sample resumes |
| `npm run csv:template` | Regenerate `candidate_submissions_export_template.csv` |

> **One process at a time on the local database.** PGlite is an in-process
> database, and opening the same data directory twice corrupts it. The scripts
> above refuse to run while `npm run dev` is up, and tell you so. Stop the dev
> server first. This restriction disappears entirely once `DATABASE_URL` points
> at a real Postgres.

## Where things live

```
app/
  apply/                 public form + confirmation
  withdraw/[token]/      consent page (GET shows, POST acts)
  admin/                 login, dashboard, record view, export.csv
  api/                   upload, parse, submit, withdraw, cron, institutions
lib/
  domain/                enums, IST dates, field rules, validation
  db/                    Drizzle schema and connection
  parse/                 text extraction and LLM field extraction
  storage/               disk / Vercel Blob adapters
  email/                 outbox transport and templates
  csv.ts, queries.ts     export writer and the shared query builder
```

## How a resume is read

Three routes, tried in order, so the form fills itself in under every
configuration:

1. **Text extraction.** `unpdf` for PDFs with a text layer, `mammoth` for
   `.docx`.
2. **Built-in field reader** (`lib/parse/heuristic.ts`). Derives name, email,
   phone, location, education, current role, summary and skills from the
   extracted text using patterns and structure — plus the seeded institution
   list, which makes recognising where someone studied far more reliable than
   inferring it from capitalisation. **Needs no API key and costs nothing**, so it
   runs first for text resumes: a resume it reads well never reaches the model.
3. **Claude**, when `ANTHROPIC_API_KEY` is set. Handles scanned, image-only PDFs
   (which have no text to work from) and picks up where the built-in reader was
   not confident. If the call fails or is refused, the built-in reader's result is
   used rather than dropping the candidate to an empty form.

Only a legacy `.doc`, a scan with no key configured, or a file with nothing
readable in it falls through to manual entry — and in every case the file is
already stored and stays attached to the application.

The reader is deliberately conservative: a field is reported only when the
evidence is clear. A blank box the candidate fills in beats a confidently wrong
one they have to notice and correct, and every value is shown for confirmation
before anything is stored.

## Decisions worth knowing

**The duplicate rule is enforced by a unique index**, not by a `SELECT` before
the `INSERT`. Two candidates submitting the same identity at the same moment
would both pass a check-then-insert; only the index stops the second one.
Matching is on normalised email and both names, so case, spacing and accents all
fold together (`PRIYA Shärma` collides with `Priya Sharma`).

**`months_to_expiry` is computed on read, never stored.** A column written at
insert time is wrong the following month.

**Withdrawal is a POST, not a GET.** The emailed link opens a page that shows
what is held and offers two buttons; nothing is erased until one is pressed. Mail
clients and link scanners routinely fetch URLs to build previews, and a
destructive GET would let any of them erase a record before the candidate opened
the message.

**Withdrawal tokens are stored hashed.** The token erases a record, so it is
treated like a password: the plaintext exists only in the email. This is also why
there is no outbox screen in the admin UI — showing tokens there would hand the
read-only admin a deletion capability. Use `npm run outbox` from a terminal.

**The export cannot drift from the dashboard.** Both parse the same query string
with `parseFilters` and run the same query builder, so "what is on screen is what
downloads" holds structurally rather than by two code paths agreeing.

**The admin session carries a read-only scope**, and every admin route calls
`assertReadOnlyRequest`, which refuses any mutating method regardless of what the
interface offers.

## Deviations from the PRD

1. **Legacy `.doc` is stored but not parsed.** `mammoth` handles Open XML
   `.docx` only, and the old OLE binary format has no parser that runs on
   serverless. The file is kept and attached to the application; the candidate
   fills the form in by hand, recorded as `parse_method = manual`. No candidate is
   turned away.

2. **Scanned PDFs are sent to Claude as document blocks** rather than rasterised
   locally. The API renders the pages itself, which removes a native canvas
   dependency that would not run on Vercel.

3. **The experience-band boundaries are pinned down.** The PRD's
   `0–3 / 3.1–10 / 10.1–15 / 15+` leaves the gaps unstated; they resolve as
   `≤3.0`, `≤10.0`, `≤15.0`, `>15.0`. Input is one decimal place, so nothing falls
   between.

4. **The institution list is a starter set** of ~150 well-known Indian
   institutions, not the full register. Replace `INSTITUTIONS` in
   `scripts/seed-institutions.ts` with an AISHE export for production; the loader
   is idempotent. The field is free text regardless.

5. **The duplicate-block message confirms that a given name and email are on
   file**, to anyone who guesses them on a public endpoint. The PRD specifies the
   wording, so it is implemented verbatim; rate limiting blunts it. Worth a second
   look before launch.

## Known gaps

- **The email provider is not wired up — do this before any production
  deployment.** Sending is behind a one-method `EmailTransport` interface in
  `lib/email/index.ts`; the shipped implementation renders each message and
  stores it in the `outbox` table rather than sending it, which keeps the flows
  complete and testable while leaving the choice of provider open.

  Everything around it is finished and covered by tests: token issue and
  rotation, the withdrawal and renewal flows, and the 30-day reminder. Only the
  final delivery step is missing. It matters because the DPDP notice promises
  candidates a withdrawal link by email, so implementing the transport is a
  prerequisite for going live, not an optional extra.

- **The Claude path is unverified against a live API.** The pipeline, prompt,
  schema and fallbacks are implemented but no call has been made to Anthropic, so
  its extraction quality is unconfirmed. The built-in reader *is* verified and
  covers text resumes without it. Set `ANTHROPIC_API_KEY` before launch if you
  need scanned resumes read.

- **The built-in reader handles common layouts, not every layout.** It is tested
  against several distinct resume shapes, but resumes are endlessly varied —
  multi-column designs and heavily graphical templates will yield less. The
  candidate confirms every field, so a partial read costs them a little typing,
  not a failed application.

- **Turnstile runs on test keys locally**, which always pass. Real keys are
  needed in production or the bot control is decorative.

## Deploying

1. Provision Neon, Vercel Blob and Turnstile; set the variables from
   `.env.example`.
2. **Implement `EmailTransport` in `lib/email/index.ts`** against a real provider.
   Until this is done candidates cannot receive their withdrawal link, which the
   consent notice promises them.
3. Set `CRON_SECRET` — without it the daily sweep route refuses to run in
   production rather than being left public.
4. `vercel.json` already schedules the sweep at 20:30 UTC (02:00 IST).
5. Run `npm run db:migrate` against `DATABASE_URL` once.

The daily sweep erases expired records, sends re-consent invitations 30 days
ahead, and deletes uploads whose application was never submitted.
