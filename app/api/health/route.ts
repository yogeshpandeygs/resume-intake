import {
  adminPasswordIsSet,
  anthropicApiKey,
  appBaseUrlIsLocalhost,
  blobToken,
  cronSecret,
  databaseUrl,
  isProduction,
  sessionSecretIsSet,
  turnstileIsConfigured,
  turnstileIsHalfConfigured,
} from '@/lib/env'

/**
 * Deployment readiness.
 *
 * `GET /api/health` reports which configuration the deployment is missing. It
 * exists because a misconfigured deployment otherwise fails as an opaque 500 on
 * the upload route, and the operator has no way to tell which variable is at
 * fault without reading the host's runtime logs.
 *
 * Public, deliberately. It reports the *names* of unset variables and never a
 * value, not even a redacted one. The names are already public — `.env.example`
 * is in the repository — and that a deployment is misconfigured is already
 * evident from the 500 it returns. So this discloses nothing an observer could
 * not already determine, while making the fault self-diagnosing.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Requirement {
  variable: string
  present: boolean
  /** What breaks without it. */
  impact: string
}

interface Probe {
  name: string
  ok: boolean
  /** Error class name. Minified in a production bundle, so often not meaningful alone. */
  error?: string
  /** The SDK's own message, when it is one that is safe to publish. See `safeDetail`. */
  detail?: string
}

/**
 * Whether an error message can be shown on this public endpoint.
 *
 * Vercel Blob and Postgres both prefix their user-facing errors, and those are
 * curated prose — "This store does not exist", "Access denied" — with no
 * credentials in them. Anything else is withheld, because a raw driver error can
 * quote hostnames, ports and query text.
 *
 * This is needed because class names are minified in a production bundle: the
 * blob write failure reported itself as `y`, which is unactionable.
 */
function safeDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const message = error.message
  return /^(Vercel Blob|error:|password authentication|connection|timeout)/i.test(message)
    ? message.slice(0, 200)
    : undefined
}

/**
 * Live connectivity checks, run only for `?probe=1`.
 *
 * A variable being *set* is not the same as it being *right*: a token for a store
 * that was deleted, or a database URL whose tables were never created, both look
 * healthy to the presence checks above while every write fails. That gap cost real
 * debugging time, so these actually call the services.
 *
 * Only the error's class name is reported. `BlobStoreNotFoundError` is enough to
 * act on, whereas the message can quote hostnames and request URLs, and this
 * endpoint is public.
 */
async function runProbes(writable: boolean): Promise<Probe[]> {
  const probes: Probe[] = []

  probes.push(
    await probe('database', async () => {
      const { db } = await import('@/lib/db')
      const { institutions } = await import('@/lib/db/schema')
      await db.select().from(institutions).limit(1)
    }),
  )

  if (blobToken) {
    probes.push(
      await probe('blob-read', async () => {
        const { list } = await import('@vercel/blob')
        await list({ token: blobToken, limit: 1 })
      }),
    )

    /*
     * Reading proves the token and store exist; it does not prove the app can
     * write, which is the operation that actually failed in production. So this
     * repeats the upload route's own `put` — same options, same access mode — and
     * removes the object again.
     *
     * Behind an explicit `probe=write` because it is a public endpoint and this is
     * the one check with a side effect. The object is a few bytes and is deleted
     * in the same request.
     */
    if (writable) {
      probes.push(
        await probe('blob-write', async () => {
          // Deliberately routed through the app's own adapter rather than the SDK
          // directly, so the probe cannot pass while the code paths that uploads
          // and downloads actually use are broken — which is how the public/private
          // mismatch survived a passing read probe.
          const { storage } = await import('@/lib/storage')
          const key = `health/probe-${crypto.randomUUID()}.txt`
          const payload = new TextEncoder().encode('hi')

          const { path } = await storage.put(key, payload, 'text/plain')
          try {
            const read = await storage.get(path)
            if (read.length !== payload.length) {
              throw new Error(`read back ${read.length} bytes, expected ${payload.length}`)
            }
          } finally {
            await storage.delete(path)
          }
        }),
      )
    }
  }

  return probes
}

async function probe(name: string, run: () => Promise<unknown>): Promise<Probe> {
  try {
    await run()
    return { name, ok: true }
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.constructor.name : 'UnknownError',
      detail: safeDetail(error),
    }
  }
}

export async function GET(request: Request) {
  /**
   * The database and storage variables are required in production only. Locally
   * their absence is the intended configuration — embedded Postgres and disk
   * storage — so reporting a healthy dev machine as "not ready" would be wrong
   * and would train people to ignore this endpoint.
   */
  const required: Requirement[] = [
    ...(isProduction
      ? [
          {
            variable: 'DATABASE_URL',
            present: Boolean(databaseUrl),
            impact: 'No database. Every page and route that touches data fails.',
          },
          {
            variable: 'BLOB_READ_WRITE_TOKEN',
            present: Boolean(blobToken),
            impact: 'Uploaded resumes have nowhere durable to go. Upload returns 500.',
          },
          {
            /*
             * Required, unlike the all-or-nothing Turnstile case below, because a
             * half-configured pair actively misleads: the form displays a genuine
             * challenge while the server accepts any token at all.
             */
            variable: 'TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY (only one is set)',
            present: !turnstileIsHalfConfigured,
            impact:
              'The form shows a real challenge but verifies against the always-pass test ' +
              'secret, so any token is accepted and bot control is off while appearing on. ' +
              'Set both keys, or neither.',
          },
          {
            variable: 'APP_BASE_URL',
            present: !appBaseUrlIsLocalhost,
            impact:
              'Withdrawal and share links point at localhost, so candidates cannot action ' +
              'the withdrawal right the consent notice promises them.',
          },
        ]
      : []),
    {
      variable: 'ADMIN_PASSWORD',
      present: adminPasswordIsSet(),
      impact: 'The hiring team cannot sign in.',
    },
    {
      variable: 'SESSION_SECRET',
      present: sessionSecretIsSet(),
      impact: 'Admin sessions cannot be signed.',
    },
  ]

  const recommended: Requirement[] = [
    ...(isProduction
      ? []
      : [
          {
            variable: 'DATABASE_URL',
            present: Boolean(databaseUrl),
            impact: 'Not set locally, which is normal — embedded Postgres is in use.',
          },
          {
            variable: 'BLOB_READ_WRITE_TOKEN',
            present: Boolean(blobToken),
            impact: 'Not set locally, which is normal — resumes are stored on disk.',
          },
        ]),
    {
      variable: 'TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY',
      present: turnstileIsConfigured,
      impact:
        'Bot control runs on test keys that always pass, and every candidate sees a ' +
        '"For testing only — if seen, report to site owner" banner on the form.',
    },
    {
      variable: 'CRON_SECRET',
      present: Boolean(cronSecret),
      impact: 'The daily retention sweep refuses to run in production.',
    },
    {
      variable: 'ANTHROPIC_API_KEY',
      present: Boolean(anthropicApiKey),
      impact:
        'Scanned resumes cannot be read. Text resumes still parse with the built-in reader.',
    },
  ]

  const missingRequired = required.filter((r) => !r.present)

  const mode = new URL(request.url).searchParams.get('probe')
  const probes = mode ? await runProbes(mode === 'write') : undefined
  const probeFailed = probes?.some((p) => !p.ok) ?? false

  return Response.json(
    {
      ready: missingRequired.length === 0 && !probeFailed,
      environment: isProduction ? 'production' : 'development',
      ...(probes ? { probes } : {}),
      missingRequired: missingRequired.map(({ variable, impact }) => ({ variable, impact })),
      missingRecommended: recommended
        .filter((r) => !r.present)
        .map(({ variable, impact }) => ({ variable, impact })),
      checked: [...required, ...recommended].map(({ variable, present }) => ({
        variable,
        present,
      })),
    },
    {
      status: missingRequired.length === 0 && !probeFailed ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  )
}
