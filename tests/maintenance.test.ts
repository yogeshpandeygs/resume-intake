import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '../lib/db'
import { outbox, submissions, uploads } from '../lib/db/schema'
import { findByWithdrawalToken } from '../lib/consent'
import {
  deleteOrphanedUploads,
  eraseExpiredRecords,
  runDailyMaintenance,
  sendReconsentInvitations,
} from '../lib/maintenance'
import { storage } from '../lib/storage'
import { createSubmission } from '../lib/submissions'
import { generateStorageKey } from '../lib/tokens'
import { resetDatabase, submissionInput, submissionMetadata } from './helpers/db'

beforeEach(async () => {
  await resetDatabase()
})

async function submitAt(when: Date, overrides: Record<string, unknown> = {}) {
  const key = generateStorageKey('pdf')
  await storage.put(key, new TextEncoder().encode('%PDF resume'), 'application/pdf')
  await db.insert(uploads).values({ path: key, filename: 'cv.pdf', sizeKb: 10 })
  return createSubmission(
    submissionInput(overrides),
    submissionMetadata({ resumeBlobPath: key }),
    when,
  )
}

describe('expiry sweep', () => {
  it('erases a record on its expiry date', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z')) // expires 2029-08-15

    const result = await eraseExpiredRecords(new Date('2029-08-15T07:00:00Z'))

    expect(result.erased).toBe(1)
    expect(await db.select().from(submissions)).toHaveLength(0)
  })

  it('leaves a record that has not yet expired', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z'))

    const result = await eraseExpiredRecords(new Date('2029-08-14T07:00:00Z'))

    expect(result.erased).toBe(0)
    expect(await db.select().from(submissions)).toHaveLength(1)
  })

  it('deletes the stored resume along with the record', async () => {
    const { submission } = await submitAt(new Date('2026-08-15T07:00:00Z'))

    await eraseExpiredRecords(new Date('2029-09-01T07:00:00Z'))

    await expect(storage.get(submission.resumeBlobPath)).rejects.toBeDefined()
  })

  it('is safe to run twice', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z'))
    const first = await eraseExpiredRecords(new Date('2029-09-01T07:00:00Z'))
    const second = await eraseExpiredRecords(new Date('2029-09-01T07:00:00Z'))

    expect(first.erased).toBe(1)
    expect(second.erased).toBe(0)
  })
})

describe('re-consent invitations', () => {
  it('invites a candidate 30 days before expiry', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z')) // expires 2029-08-15

    const result = await sendReconsentInvitations(new Date('2029-07-20T07:00:00Z'))

    expect(result.invited).toBe(1)
    const [mail] = await db.select().from(outbox)
    expect(mail!.kind).toBe('reconsent_invitation')
    expect(mail!.subject).toContain('2029-08-15')
  })

  it('does not invite a candidate whose expiry is still far off', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z'))

    const result = await sendReconsentInvitations(new Date('2029-06-01T07:00:00Z'))

    expect(result.invited).toBe(0)
    expect(await db.select().from(outbox)).toHaveLength(0)
  })

  it('invites each candidate once, not on every daily tick', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z'))

    await sendReconsentInvitations(new Date('2029-07-20T07:00:00Z'))
    await sendReconsentInvitations(new Date('2029-07-21T07:00:00Z'))
    await sendReconsentInvitations(new Date('2029-07-22T07:00:00Z'))

    expect(await db.select().from(outbox)).toHaveLength(1)
  })

  it('issues a fresh, working withdrawal token in the invitation', async () => {
    // Only the hash of the original token was stored, so the invitation cannot
    // reuse the first email's link — it rotates the token instead.
    const { withdrawalToken: original } = await submitAt(new Date('2026-08-15T07:00:00Z'))

    await sendReconsentInvitations(new Date('2029-07-20T07:00:00Z'))

    const [mail] = await db.select().from(outbox)
    const emailed = mail!.body.match(/\/withdraw\/([A-Za-z0-9_-]+)/)?.[1]
    expect(emailed).toBeTruthy()
    expect(emailed).not.toBe(original)

    // The new token works...
    expect(await findByWithdrawalToken(decodeURIComponent(emailed!))).toBeDefined()
    // ...and the old one is retired.
    expect(await findByWithdrawalToken(original)).toBeUndefined()
  })
})

describe('orphaned upload sweep', () => {
  it('deletes an upload that was never submitted', async () => {
    const key = generateStorageKey('pdf')
    await storage.put(key, new TextEncoder().encode('%PDF abandoned'), 'application/pdf')
    await db.insert(uploads).values({
      path: key,
      filename: 'abandoned.pdf',
      sizeKb: 10,
      createdAt: new Date('2026-08-14T07:00:00Z'),
    })

    const result = await deleteOrphanedUploads(new Date('2026-08-16T07:00:00Z'))

    expect(result.orphansDeleted).toBe(1)
    expect(await db.select().from(uploads)).toHaveLength(0)
    await expect(storage.get(key)).rejects.toBeDefined()
  })

  it('leaves a recent unclaimed upload alone, since the form may still be open', async () => {
    const key = generateStorageKey('pdf')
    await storage.put(key, new TextEncoder().encode('%PDF in progress'), 'application/pdf')
    await db.insert(uploads).values({
      path: key,
      filename: 'in-progress.pdf',
      sizeKb: 10,
      createdAt: new Date('2026-08-16T06:00:00Z'),
    })

    const result = await deleteOrphanedUploads(new Date('2026-08-16T07:00:00Z'))

    expect(result.orphansDeleted).toBe(0)
    expect(await db.select().from(uploads)).toHaveLength(1)
  })

  it('never touches an upload attached to a submission', async () => {
    const { submission } = await submitAt(new Date('2026-08-15T07:00:00Z'))
    await db
      .update(uploads)
      .set({ createdAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(uploads.path, submission.resumeBlobPath))

    const result = await deleteOrphanedUploads(new Date('2026-08-16T07:00:00Z'))

    expect(result.orphansDeleted).toBe(0)
    expect(await storage.get(submission.resumeBlobPath)).toBeDefined()
  })
})

describe('daily maintenance', () => {
  it('reports what it did across all three jobs', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z'))

    const report = await runDailyMaintenance(new Date('2029-09-01T07:00:00Z'))

    expect(report.erased).toBe(1)
    expect(report.errors).toEqual([])
  })

  it('invites before erasing, so a candidate on the boundary still gets the chance', async () => {
    await submitAt(new Date('2026-08-15T07:00:00Z'))

    const report = await runDailyMaintenance(new Date('2029-07-20T07:00:00Z'))

    expect(report.invited).toBe(1)
    expect(report.erased).toBe(0)
  })
})
