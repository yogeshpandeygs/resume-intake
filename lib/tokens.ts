import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Withdrawal tokens.
 *
 * A token is a bearer credential that erases a candidate's record, so it is
 * treated like a password: generated with a CSPRNG, stored only as a SHA-256
 * digest, and compared in constant time. The plaintext exists in the email we
 * send and nowhere else, which means a database read cannot be turned into the
 * ability to delete records.
 *
 * Plain SHA-256 rather than a slow KDF is the right call here: the token is 256
 * bits of uniform randomness, so there is no dictionary to attack and no work
 * factor worth paying on every withdrawal request.
 */

const TOKEN_BYTES = 32

export function generateWithdrawalToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

export function hashWithdrawalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Constant-time comparison of two hex digests, so response timing does not leak
 * how much of a guessed token was correct.
 */
export function tokensMatch(hashA: string, hashB: string): boolean {
  const a = Buffer.from(hashA, 'hex')
  const b = Buffer.from(hashB, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

/** Storage keys for uploaded resumes: unguessable, and safe as a path segment. */
export function generateStorageKey(extension: string): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return `resumes/${randomBytes(16).toString('hex')}.${safeExtension}`
}
