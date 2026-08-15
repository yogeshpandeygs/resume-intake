import { eq } from 'drizzle-orm'
import { db } from './db'
import { submissions, uploads, type Submission } from './db/schema'
import { RETENTION_MONTHS } from './domain/constants'
import { retentionExpiryDate } from './domain/dates'
import { storage } from './storage'
import { hashWithdrawalToken } from './tokens'

/**
 * Consent withdrawal and renewal.
 *
 * Withdrawal erases the record immediately and completely: the row, the stored
 * resume, and the upload bookkeeping. Nothing identifying is retained — a
 * "deleted" tombstone carrying the candidate's details would defeat the point of
 * the erasure.
 */

/**
 * Look up a record by its withdrawal token.
 *
 * The token is hashed and matched against the stored digest, so a database dump
 * cannot be turned into working withdrawal links.
 */
export async function findByWithdrawalToken(token: string): Promise<Submission | undefined> {
  if (!token || token.length > 200) return undefined
  const [row] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.withdrawalTokenHash, hashWithdrawalToken(token)))
    .limit(1)
  return row
}

/**
 * Erase one record: the resume file first, then the row.
 *
 * If deleting the file fails the row is kept, so the sweep will retry rather than
 * leaving an orphaned CV in storage with no record pointing at it. A candidate
 * who asked to be erased is better served by a retry than by a half-deletion that
 * nothing will ever revisit.
 */
export async function eraseSubmission(submission: Submission): Promise<void> {
  await storage.delete(submission.resumeBlobPath)

  await db.transaction(async (tx) => {
    await tx.delete(uploads).where(eq(uploads.path, submission.resumeBlobPath))
    await tx.delete(submissions).where(eq(submissions.id, submission.id))
  })
}

export type WithdrawalOutcome = 'erased' | 'not-found'

/** Erase by token. Returns `not-found` for an unknown or already-used token. */
export async function withdrawByToken(token: string): Promise<WithdrawalOutcome> {
  const submission = await findByWithdrawalToken(token)
  if (!submission) return 'not-found'
  await eraseSubmission(submission)
  return 'erased'
}

export type RenewalOutcome =
  | { status: 'renewed'; retentionExpiryDate: string }
  | { status: 'not-found' }

/**
 * Renew consent for a further retention period, counted from today rather than
 * from the original submission so the candidate gets the full 36 months.
 */
export async function renewConsentByToken(
  token: string,
  now: Date = new Date(),
): Promise<RenewalOutcome> {
  const submission = await findByWithdrawalToken(token)
  if (!submission) return { status: 'not-found' }

  const expiry = retentionExpiryDate(now, RETENTION_MONTHS)

  await db
    .update(submissions)
    .set({
      retentionExpiryDate: expiry,
      renewedAt: now,
      consentTimestamp: now,
      // Cleared so the mailer will invite them again 30 days before the new date.
      reconsentNoticeSentAt: null,
    })
    .where(eq(submissions.id, submission.id))

  return { status: 'renewed', retentionExpiryDate: expiry }
}
