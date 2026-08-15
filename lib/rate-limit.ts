import { sql } from 'drizzle-orm'
import { db } from './db'
import { rateLimits } from './db/schema'

/**
 * Fixed-window rate limiting.
 *
 * The application link is public and designed to travel, so every endpoint that
 * costs money (LLM extraction) or writes a record (submission) is limited per IP
 * and per email. Backed by Postgres rather than Redis so there is one backing
 * service in every environment; a recruitment form's volume is nowhere near
 * needing anything faster.
 */

export interface RateLimitRule {
  /** Distinguishes the counters, e.g. `parse` vs `submit`. */
  name: string
  limit: number
  windowSeconds: number
}

export const RATE_LIMITS = {
  /** Parsing invokes the model, so this is the tightest limit. */
  parseByIp: { name: 'parse:ip', limit: 10, windowSeconds: 600 },
  uploadByIp: { name: 'upload:ip', limit: 20, windowSeconds: 600 },
  submitByIp: { name: 'submit:ip', limit: 5, windowSeconds: 3600 },
  submitByEmail: { name: 'submit:email', limit: 3, windowSeconds: 86_400 },
  /** Blunts both password guessing and the duplicate-check enumeration vector. */
  loginByIp: { name: 'login:ip', limit: 10, windowSeconds: 900 },
  withdrawByIp: { name: 'withdraw:ip', limit: 20, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** Seconds until the window resets. */
  retryAfter: number
}

/**
 * Count one hit against `rule` for `subject`.
 *
 * The upsert is a single statement so concurrent requests cannot both read a
 * stale count and each decide they are within the limit. When the stored window
 * has expired the same statement resets it, which keeps the whole operation
 * atomic rather than needing a read, a decision and a write.
 */
export async function consumeRateLimit(
  rule: RateLimitRule,
  subject: string,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const key = `${rule.name}:${subject.toLowerCase()}`
  const windowStart = new Date(now.getTime() - rule.windowSeconds * 1000)

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        // Expired window: start a new one. Live window: increment in place.
        count: sql`case when ${rateLimits.windowStart} <= ${windowStart.toISOString()} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} <= ${windowStart.toISOString()} then ${now.toISOString()} else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count, windowStart: rateLimits.windowStart })

  const used = row?.count ?? 1
  const startedAt = row?.windowStart ?? now
  const elapsed = Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000)

  return {
    allowed: used <= rule.limit,
    remaining: Math.max(0, rule.limit - used),
    retryAfter: Math.max(1, rule.windowSeconds - elapsed),
  }
}

/**
 * Best-effort client IP.
 *
 * Behind Vercel the left-most `x-forwarded-for` entry is the real client. This is
 * spoofable if the app is ever run without a trusted proxy in front of it, which
 * is why rate limiting is a speed bump layered with Turnstile rather than the
 * only control.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip') ?? 'unknown'
}

/** 429 with the standard header, so clients back off correctly. */
export function rateLimitResponse(result: RateLimitResult, message: string): Response {
  return Response.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
  )
}
