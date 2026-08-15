import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The read-only guarantee.
 *
 * The PRD requires that "the admin may not create, edit or delete" is enforced at
 * the API layer and not merely hidden in the interface. These tests hold that
 * line: a perfectly valid session must still be refused a mutating request.
 */

const cookieStore = new Map<string, string>()

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: (name: string, value: string) => cookieStore.set(name, value),
    delete: (name: string) => cookieStore.delete(name),
  }),
}))

const {
  ADMIN_COOKIE,
  AdminAuthError,
  assertReadOnlyRequest,
  createSessionToken,
  passwordMatches,
  verifySessionToken,
} = await import('../lib/auth/admin')

function signedIn() {
  cookieStore.set(ADMIN_COOKIE, createSessionToken())
}

beforeEach(() => {
  cookieStore.clear()
})

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const payload = verifySessionToken(createSessionToken())
    expect(payload?.scope).toBe('read')
  })

  it('rejects a token with a tampered payload', () => {
    const token = createSessionToken()
    const [, signature] = token.split('.')
    const forged = `${Buffer.from(JSON.stringify({ scope: 'admin', iat: 0, exp: 9e9 })).toString('base64url')}.${signature}`
    expect(verifySessionToken(forged)).toBeUndefined()
  })

  it('rejects a token with a tampered signature', () => {
    const [encoded] = createSessionToken().split('.')
    expect(verifySessionToken(`${encoded}.not-the-signature`)).toBeUndefined()
  })

  it('rejects an expired token', () => {
    const issued = new Date('2026-08-15T00:00:00Z')
    const token = createSessionToken(issued)
    const muchLater = new Date('2026-08-20T00:00:00Z')
    expect(verifySessionToken(token, muchLater)).toBeUndefined()
  })

  it('rejects a missing or malformed token', () => {
    expect(verifySessionToken(undefined)).toBeUndefined()
    expect(verifySessionToken('')).toBeUndefined()
    expect(verifySessionToken('nonsense')).toBeUndefined()
  })
})

describe('password check', () => {
  it('accepts the configured password', () => {
    expect(passwordMatches('test-admin-password')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(passwordMatches('wrong')).toBe(false)
    expect(passwordMatches('')).toBe(false)
    // A prefix of the real password must not pass.
    expect(passwordMatches('test-admin')).toBe(false)
  })
})

describe('assertReadOnlyRequest', () => {
  it('allows a GET from a signed-in admin', async () => {
    signedIn()
    const session = await assertReadOnlyRequest(new Request('http://x/admin', { method: 'GET' }))
    expect(session.scope).toBe('read')
  })

  it('allows HEAD', async () => {
    signedIn()
    await expect(
      assertReadOnlyRequest(new Request('http://x/admin', { method: 'HEAD' })),
    ).resolves.toBeDefined()
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses %s even with a valid session',
    async (method) => {
      signedIn()
      await expect(
        assertReadOnlyRequest(new Request('http://x/admin', { method })),
      ).rejects.toBeInstanceOf(AdminAuthError)
    },
  )

  it('returns 403 rather than 401 for a mutation, so the reason is unambiguous', async () => {
    signedIn()
    try {
      await assertReadOnlyRequest(new Request('http://x/admin', { method: 'DELETE' }))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as InstanceType<typeof AdminAuthError>).status).toBe(403)
      expect((error as Error).message).toMatch(/read-only/i)
    }
  })

  it('refuses any request without a session', async () => {
    try {
      await assertReadOnlyRequest(new Request('http://x/admin', { method: 'GET' }))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as InstanceType<typeof AdminAuthError>).status).toBe(401)
    }
  })

  it('refuses a mutation from an unauthenticated caller too', async () => {
    await expect(
      assertReadOnlyRequest(new Request('http://x/admin', { method: 'POST' })),
    ).rejects.toBeInstanceOf(AdminAuthError)
  })
})
