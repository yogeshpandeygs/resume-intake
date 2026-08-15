import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { adminPassword, isProduction, sessionSecret } from '../env'

/**
 * Admin authentication: one shared password, a signed HTTP-only session cookie,
 * and a session scope that is read-only.
 *
 * The PRD is explicit that "the admin may not create, edit or delete" is enforced
 * at the API layer rather than merely hidden in the interface. That is what
 * `assertReadOnlyRequest` does: every admin route calls it, and any method that
 * could mutate is refused regardless of what the UI offers.
 */

export const ADMIN_COOKIE = 'admin_session'
const SESSION_TTL_HOURS = 12

/** The only scope ever issued. Named rather than implied, so widening it is a visible change. */
export type AdminScope = 'read'

interface SessionPayload {
  scope: AdminScope
  /** Issued-at and expiry, epoch seconds. */
  iat: number
  exp: number
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** `<base64url payload>.<signature>` */
export function createSessionToken(now: Date = new Date()): string {
  const issued = Math.floor(now.getTime() / 1000)
  const payload: SessionPayload = {
    scope: 'read',
    iat: issued,
    exp: issued + SESSION_TTL_HOURS * 3600,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

export function verifySessionToken(
  token: string | undefined,
  now: Date = new Date(),
): SessionPayload | undefined {
  if (!token) return undefined
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return undefined
  if (!safeEqual(signature, sign(encoded))) return undefined

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as SessionPayload
    if (payload.scope !== 'read') return undefined
    if (payload.exp * 1000 <= now.getTime()) return undefined
    return payload
  } catch {
    return undefined
  }
}

/** Constant-time password check against the configured shared password. */
export function passwordMatches(candidate: string): boolean {
  // Hash both sides first so the comparison length does not reveal the password length.
  const expected = createHash('sha256').update(adminPassword()).digest()
  const supplied = createHash('sha256').update(candidate).digest()
  return timingSafeEqual(expected, supplied)
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600,
  }
}

/** Read and verify the session from the request cookies. */
export async function currentAdminSession(): Promise<SessionPayload | undefined> {
  const store = await cookies()
  return verifySessionToken(store.get(ADMIN_COOKIE)?.value)
}

export async function isAdminAuthenticated(): Promise<boolean> {
  return (await currentAdminSession()) !== undefined
}

export class AdminAuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'AdminAuthError'
  }
}

/**
 * Methods that can only be intended to change something. The admin session has no
 * scope permitting any of them.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The guard every `/api/admin/*` and admin page route calls.
 *
 * Two separate checks: the caller must hold a valid session, and the request must
 * not be a mutation. The second is what makes read-only a property of the session
 * rather than of the interface — a hand-crafted POST to an admin route is refused
 * even with a perfectly valid cookie.
 */
export async function assertReadOnlyRequest(request: Request): Promise<SessionPayload> {
  const session = await currentAdminSession()
  if (!session) {
    throw new AdminAuthError(401, 'Sign in to continue')
  }
  if (MUTATING_METHODS.has(request.method.toUpperCase())) {
    throw new AdminAuthError(
      403,
      'The admin session is read-only. Records cannot be created, edited or deleted.',
    )
  }
  return session
}

/** Turn an `AdminAuthError` into a response; rethrow anything else. */
export function authErrorResponse(error: unknown): Response {
  if (error instanceof AdminAuthError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  throw error
}
