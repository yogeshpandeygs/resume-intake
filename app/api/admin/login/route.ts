import { cookies } from 'next/headers'
import { z } from 'zod'
import {
  ADMIN_COOKIE,
  createSessionToken,
  passwordMatches,
  sessionCookieOptions,
} from '@/lib/auth/admin'
import { clientIp, consumeRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Admin sign-in.
 *
 * This is the one admin route that accepts a POST — it establishes the session
 * rather than acting on records. The session it issues carries a read-only scope,
 * which every other admin route enforces.
 */

export const runtime = 'nodejs'

const bodySchema = z.object({ password: z.string().min(1).max(512) })

export async function POST(request: Request) {
  const ip = clientIp(request)
  const limit = await consumeRateLimit(RATE_LIMITS.loginByIp, ip)
  if (!limit.allowed) {
    return rateLimitResponse(limit, 'Too many sign-in attempts. Please try again later.')
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return Response.json({ error: 'Enter the admin password.' }, { status: 400 })
  }

  if (!passwordMatches(body.data.password)) {
    // Deliberately vague: there is only one account, so naming the failure adds
    // nothing for a legitimate admin and confirms the endpoint for everyone else.
    return Response.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  const store = await cookies()
  store.set(ADMIN_COOKIE, createSessionToken(), sessionCookieOptions())

  return Response.json({ ok: true })
}

/** Sign out by clearing the cookie. */
export async function DELETE() {
  const store = await cookies()
  store.delete(ADMIN_COOKIE)
  return Response.json({ ok: true })
}
