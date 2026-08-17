/**
 * Environment configuration.
 *
 * The app runs in two shapes from the same code: a local-first setup with no cloud
 * accounts at all (embedded Postgres, files on disk, Turnstile test keys), and the
 * production shape from the PRD (Neon, Vercel Blob, real Turnstile). Which one you
 * get is decided here and nowhere else — the rest of the code talks to adapters.
 */

function optional(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function required(name: string): string {
  const value = optional(name)
  if (value === undefined) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value
}

/** `DATABASE_URL` present means Neon (or any Postgres); absent means embedded PGlite. */
export const databaseUrl = optional('DATABASE_URL')

/** Where embedded Postgres keeps its data directory, relative to the project root. */
export const pgliteDataDir = optional('PGLITE_DATA_DIR') ?? './.pglite'

/** `BLOB_READ_WRITE_TOKEN` present means Vercel Blob; absent means local disk. */
export const blobToken = optional('BLOB_READ_WRITE_TOKEN')
export const localStorageDir = optional('LOCAL_STORAGE_DIR') ?? './.storage'

/**
 * Cloudflare's documented always-passes test pair. Real keys are supplied in
 * production; the verification code path is identical either way, so the
 * integration is genuinely exercised in development rather than stubbed out.
 */
export const turnstileSiteKey = optional('TURNSTILE_SITE_KEY') ?? '1x00000000000000000000AA'
export const turnstileSecretKey = optional('TURNSTILE_SECRET_KEY') ?? '1x0000000000000000000000000000000AA'

/**
 * Model used for resume field extraction and for reading scanned PDFs.
 * Override with `ANTHROPIC_MODEL` to trade cost against extraction accuracy.
 */
export const anthropicModel = optional('ANTHROPIC_MODEL') ?? 'claude-opus-5'
export const anthropicApiKey = optional('ANTHROPIC_API_KEY')

export function requireAnthropicApiKey(): string {
  return required('ANTHROPIC_API_KEY')
}

/** Single shared admin password, per the PRD. */
export function adminPassword(): string {
  return required('ADMIN_PASSWORD')
}

/** Secret for signing the admin session cookie. */
export function sessionSecret(): string {
  return required('SESSION_SECRET')
}

/*
 * Presence checks for the health endpoint. These deliberately return a boolean
 * and never the value, so that reporting what is missing cannot become a way to
 * read what is set.
 */
export function adminPasswordIsSet(): boolean {
  return optional('ADMIN_PASSWORD') !== undefined
}

export function sessionSecretIsSet(): boolean {
  return optional('SESSION_SECRET') !== undefined
}

const turnstileSiteKeyIsSet = optional('TURNSTILE_SITE_KEY') !== undefined
const turnstileSecretKeyIsSet = optional('TURNSTILE_SECRET_KEY') !== undefined

/** False when Turnstile is running on the always-passes development test keys. */
export const turnstileIsConfigured = turnstileSiteKeyIsSet && turnstileSecretKeyIsSet

/**
 * Exactly one of the pair is set — the most dangerous of the three states.
 *
 * With a real site key and no secret, the widget renders a genuine challenge with
 * no "for testing only" banner, while the server verifies against the always-pass
 * test secret, which accepts *any* token including a fabricated one. The form
 * therefore looks protected, reports success, and screens nothing. Neither
 * all-test nor all-real keys can mislead you this way, which is why this is
 * called out separately rather than folded into `turnstileIsConfigured`.
 */
export const turnstileIsHalfConfigured = turnstileSiteKeyIsSet !== turnstileSecretKeyIsSet

/** Shared secret Vercel Cron presents when invoking the scheduled routes. */
export const cronSecret = optional('CRON_SECRET')

/**
 * Absolute base URL, used to build withdrawal and share links.
 *
 * The localhost default is for development only, and reaching it in production is
 * a quiet disaster rather than a visible one: the deployment keeps working while
 * every withdrawal link it emails points at the candidate's own machine. A
 * candidate who cannot action their withdrawal link cannot exercise a right the
 * DPDP notice promises them.
 *
 * So on Vercel we fall back to the platform's own stable production domain before
 * localhost. Note this is `VERCEL_PROJECT_PRODUCTION_URL`, not `VERCEL_URL` —
 * the latter is unique per deployment and would rot within the day, while these
 * links have to survive the 36-month retention window. `APP_BASE_URL` still wins,
 * which is what a custom domain sets.
 */
const vercelProductionUrl = optional('VERCEL_PROJECT_PRODUCTION_URL')

export const appBaseUrl =
  optional('APP_BASE_URL') ??
  (vercelProductionUrl ? `https://${vercelProductionUrl}` : 'http://localhost:3000')

/** True when the base URL is the development default — useless in a deployed app. */
export const appBaseUrlIsLocalhost = appBaseUrl.includes('localhost')

/** Addresses that appear in the DPDP notice and the duplicate-block message. */
export const recruitmentEmail = optional('RECRUITMENT_EMAIL') ?? 'recruitment@northwardbound.com'
export const dpoEmail = optional('DPO_EMAIL') ?? 'dpo@northwardbound.com'

/**
 * The Data Fiduciary named in the DPDP notice and shown throughout the form.
 *
 * Defaulted rather than left as a placeholder so a deployment shows the right
 * name without depending on an environment variable being set. `ORGANISATION_NAME`
 * still overrides it, which is what a second deployment for a different entity
 * would use.
 */
export const organisationName = optional('ORGANISATION_NAME') ?? 'Northwardbound'

export const isProduction = process.env.NODE_ENV === 'production'

/**
 * The local-first backends — embedded Postgres and disk storage — are for
 * development only. On a serverless host the filesystem is read-only at runtime,
 * and where it is writable it is discarded on every deploy.
 *
 * So a missing `DATABASE_URL` or `BLOB_READ_WRITE_TOKEN` in production is a
 * misconfiguration, not a reason to fall back. Falling back would either crash
 * with an unrelated-looking filesystem error or, worse, appear to work while
 * quietly losing every candidate's application at the next deploy.
 *
 * This is checked when the backend is first used rather than at module load, so
 * that `next build` — which also runs with NODE_ENV=production — is not broken by
 * variables that only need to exist at runtime.
 */
export function missingProductionConfig(variable: string, purpose: string): Error {
  return new Error(
    `${variable} is not set. ${purpose}\n\n` +
      'The local development fallback cannot be used in production: serverless filesystems are ' +
      'read-only at runtime and are discarded on redeploy, so data written there would be lost.\n' +
      `Set ${variable} in your hosting provider's environment variables and redeploy.`,
  )
}
