import { and, eq, isNull, lt, lte } from 'drizzle-orm'
import { db } from './db'
import { submissions, uploads } from './db/schema'
import { eraseSubmission } from './consent'
import { RECONSENT_LEAD_DAYS } from './domain/constants'
import { addDays, formatCivilDate, istCivilDate } from './domain/dates'
import { reconsentInvitation, sendEmail } from './email'
import { storage } from './storage'
import { generateWithdrawalToken, hashWithdrawalToken } from './tokens'

/**
 * The scheduled work behind the retention promise.
 *
 * Three jobs, all idempotent so a retried cron tick cannot double-send or
 * double-delete:
 *   - erase records past their expiry date
 *   - invite renewal 30 days before that date
 *   - delete uploads belonging to applications that were never submitted
 */

export interface SweepReport {
  erased: number
  invited: number
  orphansDeleted: number
  errors: string[]
}

/**
 * Erase every record at or past its expiry date.
 *
 * Records are erased one at a time rather than in a bulk DELETE because each one
 * also owns a file in storage; a bulk row delete would strand every one of those.
 */
export async function eraseExpiredRecords(now: Date = new Date()): Promise<{
  erased: number
  errors: string[]
}> {
  const today = formatCivilDate(istCivilDate(now))
  const errors: string[] = []

  const expired = await db
    .select()
    .from(submissions)
    .where(lte(submissions.retentionExpiryDate, today))

  let erased = 0
  for (const submission of expired) {
    try {
      await eraseSubmission(submission)
      erased += 1
    } catch (error) {
      // Keep going: one unreadable blob must not stop the rest of the sweep.
      errors.push(`${submission.submissionId}: ${(error as Error).message}`)
    }
  }

  return { erased, errors }
}

/**
 * Invite renewal from candidates whose record expires within the lead time.
 *
 * `reconsentNoticeSentAt` is stamped so a candidate is invited once per retention
 * period, not once per day for the last 30 days of it.
 */
export async function sendReconsentInvitations(now: Date = new Date()): Promise<{
  invited: number
  errors: string[]
}> {
  const cutoff = formatCivilDate(addDays(istCivilDate(now), RECONSENT_LEAD_DAYS))
  const errors: string[] = []

  const due = await db
    .select()
    .from(submissions)
    .where(
      and(
        lte(submissions.retentionExpiryDate, cutoff),
        isNull(submissions.reconsentNoticeSentAt),
      ),
    )

  let invited = 0
  for (const submission of due) {
    try {
      // Only the hash of the original token was kept, so there is no way to
      // reproduce the link from the first email. A fresh token is issued and its
      // hash stored, which also retires the old link — the most recent email is
      // always the one that works.
      const token = generateWithdrawalToken()

      await db
        .update(submissions)
        .set({ withdrawalTokenHash: hashWithdrawalToken(token), reconsentNoticeSentAt: now })
        .where(eq(submissions.id, submission.id))

      await sendEmail(
        reconsentInvitation({
          to: submission.email,
          firstName: submission.firstName,
          submissionId: submission.submissionId,
          withdrawalToken: token,
          retentionExpiryDate: submission.retentionExpiryDate,
        }),
      )
      invited += 1
    } catch (error) {
      errors.push(`${submission.submissionId}: ${(error as Error).message}`)
    }
  }

  return { invited, errors }
}

/**
 * Delete stored files whose application was never submitted.
 *
 * The resume is uploaded before the form is submitted, so an abandoned
 * application leaves a file with no record pointing at it. Anything unclaimed
 * after a day is assumed abandoned — comfortably longer than any real session,
 * and well short of leaving personal data lying around.
 */
export async function deleteOrphanedUploads(
  now: Date = new Date(),
  olderThanHours = 24,
): Promise<{ orphansDeleted: number; errors: string[] }> {
  const cutoff = new Date(now.getTime() - olderThanHours * 3600 * 1000)
  const errors: string[] = []

  const orphans = await db
    .select()
    .from(uploads)
    .where(and(isNull(uploads.claimedAt), lt(uploads.createdAt, cutoff)))

  let orphansDeleted = 0
  for (const orphan of orphans) {
    try {
      await storage.delete(orphan.path)
      await db.delete(uploads).where(eq(uploads.path, orphan.path))
      orphansDeleted += 1
    } catch (error) {
      errors.push(`${orphan.path}: ${(error as Error).message}`)
    }
  }

  return { orphansDeleted, errors }
}

/** Everything the daily cron tick does. */
export async function runDailyMaintenance(now: Date = new Date()): Promise<SweepReport> {
  const invitations = await sendReconsentInvitations(now)
  const expiry = await eraseExpiredRecords(now)
  const orphans = await deleteOrphanedUploads(now)

  return {
    erased: expiry.erased,
    invited: invitations.invited,
    orphansDeleted: orphans.orphansDeleted,
    errors: [...invitations.errors, ...expiry.errors, ...orphans.errors],
  }
}
