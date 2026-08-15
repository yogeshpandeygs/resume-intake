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

/** Shared secret Vercel Cron presents when invoking the scheduled routes. */
export const cronSecret = optional('CRON_SECRET')

/** Absolute base URL, used to build withdrawal and share links. */
export const appBaseUrl = optional('APP_BASE_URL') ?? 'http://localhost:3000'

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
