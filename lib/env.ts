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
export const recruitmentEmail = optional('RECRUITMENT_EMAIL') ?? 'recruitment@organisation.com'
export const dpoEmail = optional('DPO_EMAIL') ?? 'dpo@organisation.com'
export const organisationName = optional('ORGANISATION_NAME') ?? '[Organisation]'

export const isProduction = process.env.NODE_ENV === 'production'
