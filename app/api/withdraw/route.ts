import { z } from 'zod'
import { renewConsentByToken, withdrawByToken } from '@/lib/consent'
import { clientIp, consumeRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Acts on a withdrawal token.
 *
 * Deliberately a POST. The PRD describes withdrawal as "one click to erase the
 * record", and the confirmation page at `/withdraw/[token]` keeps it to one click
 * — but the erasure itself must not happen on a GET. Mail clients, link
 * scanners and chat previews routinely fetch URLs to build a preview, and a
 * destructive GET would let any of them silently erase a candidate's record
 * before they ever opened the email.
 */

export const runtime = 'nodejs'

const bodySchema = z.object({
  token: z.string().min(1).max(200),
  action: z.enum(['withdraw', 'renew']),
})

export async function POST(request: Request) {
  const ip = clientIp(request)
  const limit = await consumeRateLimit(RATE_LIMITS.withdrawByIp, ip)
  if (!limit.allowed) {
    return rateLimitResponse(limit, 'Too many requests. Please try again shortly.')
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 })
  }

  if (body.data.action === 'renew') {
    const result = await renewConsentByToken(body.data.token)
    if (result.status === 'not-found') {
      return Response.json({ error: 'This link is no longer valid.' }, { status: 404 })
    }
    return Response.json({ renewed: true, retentionExpiryDate: result.retentionExpiryDate })
  }

  const outcome = await withdrawByToken(body.data.token)
  if (outcome === 'not-found') {
    return Response.json({ error: 'This link is no longer valid.' }, { status: 404 })
  }

  return Response.json({ erased: true })
}
