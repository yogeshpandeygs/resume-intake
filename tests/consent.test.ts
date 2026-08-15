import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../lib/db'
import { outbox, submissions, uploads } from '../lib/db/schema'
import { eraseSubmission, findByWithdrawalToken, renewConsentByToken, withdrawByToken } from '../lib/consent'
import { storage } from '../lib/storage'
import { createSubmission } from '../lib/submissions'
import { generateStorageKey } from '../lib/tokens'
import { resetDatabase, submissionInput, submissionMetadata } from './helpers/db'

const NOW = new Date('2026-08-15T07:00:00Z')

beforeEach(async () => {
  await resetDatabase()
})

/** Create a submission with a real file behind it, so erasure has something to delete. */
async function submitWithFile() {
  const key = generateStorageKey('pdf')
  await storage.put(key, new TextEncoder().encode('%PDF-1.7 fake resume'), 'application/pdf')
  await db.insert(uploads).values({ path: key, filename: 'cv.pdf', sizeKb: 12 })

  return createSubmission(
    submissionInput(),
    submissionMetadata({ resumeBlobPath: key }),
    NOW,
  )
}

describe('withdrawal token lookup', () => {
  it('finds the record for a valid token', async () => {
    const { submission, withdrawalToken } = await submitWithFile()
    const found = await findByWithdrawalToken(withdrawalToken)
    expect(found?.id).toBe(submission.id)
  })

  it('returns nothing for an unknown token', async () => {
    await submitWithFile()
    expect(await findByWithdrawalToken('not-a-real-token')).toBeUndefined()
  })

  it('returns nothing for an empty or oversized token', async () => {
    expect(await findByWithdrawalToken('')).toBeUndefined()
    expect(await findByWithdrawalToken('x'.repeat(500))).toBeUndefined()
  })
})

describe('erasure', () => {
  it('deletes the record, the upload row and the stored file', async () => {
    const { submission, withdrawalToken } = await submitWithFile()

    const outcome = await withdrawByToken(withdrawalToken)
    expect(outcome).toBe('erased')

    expect(await db.select().from(submissions)).toHaveLength(0)
    expect(await db.select().from(uploads)).toHaveLength(0)
    await expect(storage.get(submission.resumeBlobPath)).rejects.toBeDefined()
  })

  it('leaves nothing identifying behind', async () => {
    // DPDP erasure means erasure: no tombstone carrying the candidate's details.
    const { withdrawalToken } = await submitWithFile()
    await withdrawByToken(withdrawalToken)

    const rows = await db.select().from(submissions)
    expect(JSON.stringify(rows)).not.toContain('priya@example.com')
    expect(JSON.stringify(rows)).not.toContain('Sharma')
  })

  it('invalidates the token, so a repeated click is harmless', async () => {
    const { withdrawalToken } = await submitWithFile()
    expect(await withdrawByToken(withdrawalToken)).toBe('erased')
    expect(await withdrawByToken(withdrawalToken)).toBe('not-found')
  })

  it('erases only the record the token belongs to', async () => {
    const first = await submitWithFile()

    const key = generateStorageKey('pdf')
    await storage.put(key, new TextEncoder().encode('%PDF other'), 'application/pdf')
    await db.insert(uploads).values({ path: key, filename: 'other.pdf', sizeKb: 9 })
    await createSubmission(
      submissionInput({ email: 'arjun@example.com', firstName: 'Arjun', lastName: 'Nair' }),
      submissionMetadata({ resumeBlobPath: key }),
      NOW,
    )

    await withdrawByToken(first.withdrawalToken)

    const remaining = await db.select().from(submissions)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.email).toBe('arjun@example.com')
  })

  it('erases directly by record too, for the expiry sweep', async () => {
    const { submission } = await submitWithFile()
    await eraseSubmission(submission)
    expect(await db.select().from(submissions)).toHaveLength(0)
  })
})

describe('renewal', () => {
  it('pushes the expiry date out from today', async () => {
    const { withdrawalToken } = await submitWithFile()

    const renewalDay = new Date('2029-07-20T07:00:00Z')
    const result = await renewConsentByToken(withdrawalToken, renewalDay)

    expect(result.status).toBe('renewed')
    // 36 months from the day of renewal, not from the original submission.
    expect(result).toMatchObject({ retentionExpiryDate: '2032-07-20' })
  })

  it('records the renewal and re-arms the reminder', async () => {
    const { submission, withdrawalToken } = await submitWithFile()
    await renewConsentByToken(withdrawalToken, new Date('2029-07-20T07:00:00Z'))

    const [row] = await db.select().from(submissions)
    expect(row!.renewedAt).not.toBeNull()
    // Cleared so the mailer will invite them again before the new expiry date.
    expect(row!.reconsentNoticeSentAt).toBeNull()
    expect(row!.id).toBe(submission.id)
  })

  it('rejects an unknown token', async () => {
    await submitWithFile()
    expect(await renewConsentByToken('nope')).toEqual({ status: 'not-found' })
  })

  it('does not resurrect an already-erased record', async () => {
    const { withdrawalToken } = await submitWithFile()
    await withdrawByToken(withdrawalToken)
    expect(await renewConsentByToken(withdrawalToken)).toEqual({ status: 'not-found' })
  })
})

describe('submission receipt', () => {
  it('is queued with a working withdrawal link', async () => {
    const { submission, withdrawalToken } = await submitWithFile()

    // The submit route sends this; here we assert the template carries a token
    // that actually resolves back to the record.
    const { submissionReceipt, sendEmail } = await import('../lib/email')
    await sendEmail(
      submissionReceipt({
        to: submission.email,
        firstName: submission.firstName,
        submissionId: submission.submissionId,
        withdrawalToken,
        retentionExpiryDate: submission.retentionExpiryDate,
      }),
    )

    const [mail] = await db.select().from(outbox)
    expect(mail!.toEmail).toBe('priya@example.com')
    expect(mail!.body).toContain(withdrawalToken)
    // Nothing was actually sent — no provider is configured.
    expect(mail!.sentAt).toBeNull()

    const tokenInEmail = mail!.body.match(/\/withdraw\/([A-Za-z0-9_-]+)/)?.[1]
    expect(await findByWithdrawalToken(decodeURIComponent(tokenInEmail!))).toBeDefined()
  })
})
