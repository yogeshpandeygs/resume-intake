import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { uploads } from '@/lib/db/schema'
import { MAX_RESUME_SIZE_BYTES, MAX_RESUME_SIZE_KB } from '@/lib/domain/constants'
import { CONTENT_TYPES, resumeFormatFromFilename } from '@/lib/parse'
import { clientIp, consumeRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { storage } from '@/lib/storage'
import { generateStorageKey } from '@/lib/tokens'

/**
 * Receives the resume file and puts it in storage.
 *
 * This is the local-development path: the file travels through the server, which
 * is fine without a request-body limit. In production the client uploads straight
 * to Vercel Blob (see `app/api/upload/blob/route.ts`) because a 5 MB resume
 * exceeds the 4.5 MB serverless request limit and could never reach this handler.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const deleteSchema = z.object({ path: z.string().min(1).max(500) })

export async function POST(request: Request) {
  const ip = clientIp(request)
  const limit = await consumeRateLimit(RATE_LIMITS.uploadByIp, ip)
  if (!limit.allowed) {
    return rateLimitResponse(limit, 'Too many uploads from this connection. Please try again later.')
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Could not read the uploaded file.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file was attached.' }, { status: 400 })
  }

  // Each rejection names its specific cause, per the PRD's upload-failure rule,
  // so the candidate knows what to change rather than just that it failed.
  if (file.size === 0) {
    return Response.json({ error: 'That file is empty. Please choose another.' }, { status: 400 })
  }

  if (file.size > MAX_RESUME_SIZE_BYTES) {
    const actualMb = (file.size / (1024 * 1024)).toFixed(1)
    return Response.json(
      {
        error: `This file is ${actualMb} MB. The maximum is 5 MB — please upload a smaller file.`,
      },
      { status: 413 },
    )
  }

  const format = resumeFormatFromFilename(file.name)
  if (!format) {
    return Response.json(
      {
        error:
          'That file type is not accepted. Please upload a PDF, DOCX or DOC file.',
      },
      { status: 415 },
    )
  }

  const data = new Uint8Array(await file.arrayBuffer())
  const key = generateStorageKey(format)
  const sizeKb = Math.max(1, Math.ceil(file.size / 1024))

  let path: string
  try {
    ;({ path } = await storage.put(key, data, CONTENT_TYPES[format]))

    // Recorded so the daily sweep can find and delete files whose application was
    // never submitted.
    await db.insert(uploads).values({
      path,
      filename: file.name,
      sizeKb,
    })
  } catch (error) {
    /*
     * Storage or the database is misconfigured or unreachable. Letting this throw
     * produced a 500 with an empty body, which told the candidate nothing and told
     * the operator nothing either — the deployment looked broken with no clue why.
     *
     * The cause is logged for the operator and deliberately not returned: it names
     * internal infrastructure, and the candidate can do nothing with it. Their file
     * was fine, so the message says so and does not invite them to re-edit it.
     */
    console.error('[upload] could not store the resume:', error)
    return Response.json(
      {
        error:
          'Your file was fine, but we could not save it just now. This is a problem on our ' +
          'side. Please try again in a few minutes.',
      },
      { status: 502 },
    )
  }

  return Response.json({
    path,
    filename: file.name,
    format,
    sizeKb,
    maxSizeKb: MAX_RESUME_SIZE_KB,
  })
}

/**
 * Removes an attachment the candidate has decided against.
 *
 * Deletes the stored file as well as the row, so a resume the candidate withdrew
 * before submitting does not sit in storage waiting for the orphan sweep. Only
 * unclaimed uploads can be removed: once an application has been submitted, its
 * resume is part of a consented record and is reachable only through withdrawal.
 */
export async function DELETE(request: Request) {
  const body = deleteSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 })
  }

  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.path, body.data.path))
    .limit(1)

  // Already gone: nothing to do, and the candidate's intent is satisfied.
  if (!upload) return Response.json({ removed: true })

  if (upload.claimedAt) {
    return Response.json(
      { error: 'This resume belongs to a submitted application and cannot be removed here.' },
      { status: 409 },
    )
  }

  try {
    await storage.delete(upload.path)
  } catch {
    // The row still goes; the orphan sweep will retry the file.
  }
  await db.delete(uploads).where(eq(uploads.path, upload.path))

  return Response.json({ removed: true })
}
