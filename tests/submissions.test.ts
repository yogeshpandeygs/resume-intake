import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { submissions, uploads } from '../lib/db/schema'
import { createSubmission, DuplicateSubmission } from '../lib/submissions'
import { hashWithdrawalToken } from '../lib/tokens'
import { resetDatabase, submissionInput, submissionMetadata } from './helpers/db'

const NOW = new Date('2026-08-15T07:00:00Z')

beforeEach(async () => {
  await resetDatabase()
})

describe('createSubmission', () => {
  it('stores a submission with derived fields filled in', async () => {
    const { submission } = await createSubmission(
      submissionInput(),
      submissionMetadata(),
      NOW,
    )

    expect(submission.submissionId).toBe('SUB-2026-000001')
    expect(submission.experienceBand).toBe('Mid-career')
    expect(submission.retentionExpiryDate).toBe('2029-08-15')
    expect(submission.consentNoticeVersion).toBeTruthy()
    expect(submission.duplicateFlag).toBe('none')
  })

  it('allocates sequential submission ids within a year', async () => {
    const a = await createSubmission(submissionInput(), submissionMetadata(), NOW)
    const b = await createSubmission(
      submissionInput({ email: 'other@example.com', firstName: 'Arjun' }),
      submissionMetadata(),
      NOW,
    )

    expect(a.submission.submissionId).toBe('SUB-2026-000001')
    expect(b.submission.submissionId).toBe('SUB-2026-000002')
  })

  it('restarts numbering in a new year', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)
    const next = await createSubmission(
      submissionInput({ email: 'other@example.com', firstName: 'Arjun' }),
      submissionMetadata(),
      new Date('2027-01-05T07:00:00Z'),
    )
    expect(next.submission.submissionId).toBe('SUB-2027-000001')
  })

  it('does not allocate the same sequence to concurrent submissions', async () => {
    // The counter is claimed with UPDATE ... RETURNING inside the transaction,
    // so parallel inserts cannot collide on the reference.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createSubmission(
          submissionInput({ email: `candidate${i}@example.com`, firstName: `Name${i}` }),
          submissionMetadata(),
          NOW,
        ),
      ),
    )

    const ids = results.map((r) => r.submission.submissionId)
    expect(new Set(ids).size).toBe(5)
  })

  it('stores the withdrawal token only as a hash', async () => {
    const { submission, withdrawalToken } = await createSubmission(
      submissionInput(),
      submissionMetadata(),
      NOW,
    )

    expect(withdrawalToken).toBeTruthy()
    expect(submission.withdrawalTokenHash).toBe(hashWithdrawalToken(withdrawalToken))
    // The plaintext must not be recoverable from the row.
    expect(JSON.stringify(submission)).not.toContain(withdrawalToken)
  })

  it('claims the upload so the orphan sweep leaves it alone', async () => {
    const meta = submissionMetadata()
    await db.insert(uploads).values({
      path: meta.resumeBlobPath,
      filename: meta.resumeFilename,
      sizeKb: meta.resumeSizeKb,
    })

    await createSubmission(submissionInput(), meta, NOW)

    const [row] = await db.select().from(uploads).where(eq(uploads.path, meta.resumeBlobPath))
    expect(row!.claimedAt).not.toBeNull()
  })
})

describe('duplicate handling', () => {
  it('blocks an exact match on email and both names', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)

    await expect(
      createSubmission(submissionInput(), submissionMetadata(), NOW),
    ).rejects.toBeInstanceOf(DuplicateSubmission)
  })

  it('blocks a match that differs only by case, spacing and accents', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)

    await expect(
      createSubmission(
        submissionInput({
          firstName: '  PRIYA ',
          lastName: 'Shärma',
          email: 'PRIYA@Example.com ',
        }),
        submissionMetadata(),
        NOW,
      ),
    ).rejects.toBeInstanceOf(DuplicateSubmission)
  })

  it('uses the message the PRD specifies', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)
    await expect(
      createSubmission(submissionInput(), submissionMetadata(), NOW),
    ).rejects.toThrow(/already exists in our records/)
  })

  it('accepts and flags a match on email alone', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)

    const { submission } = await createSubmission(
      submissionInput({ firstName: 'Rahul', lastName: 'Verma' }),
      submissionMetadata(),
      NOW,
    )
    expect(submission.duplicateFlag).toBe('email_match')
  })

  it('accepts and flags a match on name alone', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)

    const { submission } = await createSubmission(
      submissionInput({ email: 'priya.sharma@work.example.com' }),
      submissionMetadata(),
      NOW,
    )
    expect(submission.duplicateFlag).toBe('name_match')
  })

  it('leaves an unrelated candidate unflagged', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)

    const { submission } = await createSubmission(
      submissionInput({ firstName: 'Arjun', lastName: 'Nair', email: 'arjun@example.com' }),
      submissionMetadata(),
      NOW,
    )
    expect(submission.duplicateFlag).toBe('none')
  })

  it('does not leave a partial row behind when a duplicate is rejected', async () => {
    await createSubmission(submissionInput(), submissionMetadata(), NOW)
    await expect(
      createSubmission(submissionInput(), submissionMetadata(), NOW),
    ).rejects.toBeInstanceOf(DuplicateSubmission)

    const rows = await db.select().from(submissions)
    expect(rows).toHaveLength(1)
  })

  it('lets only one of two identical concurrent submissions through', async () => {
    // A check-then-insert would let both pass; the unique index is what actually
    // enforces the rule.
    const attempts = await Promise.allSettled([
      createSubmission(submissionInput(), submissionMetadata(), NOW),
      createSubmission(submissionInput(), submissionMetadata(), NOW),
    ])

    const fulfilled = attempts.filter((a) => a.status === 'fulfilled')
    const rejected = attempts.filter((a) => a.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateSubmission)
  })
})
