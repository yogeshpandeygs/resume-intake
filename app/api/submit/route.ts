import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { uploads } from '@/lib/db/schema'
import { PARSE_METHODS, type ParseMethod } from '@/lib/domain/constants'
import { submissionInputSchema } from '@/lib/domain/fields'
import { sendEmail, submissionReceipt } from '@/lib/email'
import { resumeFormatFromFilename } from '@/lib/parse'
import { clientIp, consumeRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { createSubmission, DuplicateSubmission } from '@/lib/submissions'
import { verifyTurnstile } from '@/lib/turnstile'

/**
 * The submit endpoint.
 *
 * Order matters: bot check, then rate limits, then validation, then the
 * transactional insert. The cheap rejections come first so an abusive caller
 * never reaches the database.
 */

export const runtime = 'nodejs'
export const maxDuration = 60

const envelopeSchema = z.object({
  form: z.record(z.string(), z.unknown()),
  uploadPath: z.string().min(1),
  parseMethod: z.enum(PARSE_METHODS),
  turnstileToken: z.string().optional(),
  refCode: z.string().max(64).optional(),
})

export async function POST(request: Request) {
  const ip = clientIp(request)
  const now = new Date()

  const envelope = envelopeSchema.safeParse(await request.json().catch(() => null))
  if (!envelope.success) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 })
  }
  const { form, uploadPath, parseMethod, turnstileToken, refCode } = envelope.data

  const turnstile = await verifyTurnstile(turnstileToken, ip)
  if (!turnstile.success) {
    return Response.json(
      { error: 'We could not verify that you are human. Please refresh the page and try again.' },
      { status: 403 },
    )
  }

  const ipLimit = await consumeRateLimit(RATE_LIMITS.submitByIp, ip, now)
  if (!ipLimit.allowed) {
    return rateLimitResponse(
      ipLimit,
      'Too many applications from this connection. Please try again later.',
    )
  }

  const parsed = submissionInputSchema(now).safeParse(form)
  if (!parsed.success) {
    // Field-keyed messages so the form can mark the offending inputs.
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_'
      fieldErrors[key] ??= issue.message
    }
    return Response.json(
      { error: 'Please correct the highlighted fields.', fieldErrors },
      { status: 422 },
    )
  }
  const input = parsed.data

  const emailLimit = await consumeRateLimit(RATE_LIMITS.submitByEmail, input.email, now)
  if (!emailLimit.allowed) {
    return rateLimitResponse(
      emailLimit,
      'This email address has submitted several applications recently. Please try again later.',
    )
  }

  // The upload must be one this app stored, and must not already belong to
  // another application.
  const [upload] = await db.select().from(uploads).where(eq(uploads.path, uploadPath)).limit(1)
  if (!upload) {
    return Response.json(
      { error: 'Your uploaded resume was not found. Please attach it again.' },
      { status: 404 },
    )
  }
  if (upload.claimedAt) {
    return Response.json(
      { error: 'That resume has already been submitted with another application.' },
      { status: 409 },
    )
  }

  const format = resumeFormatFromFilename(upload.filename)
  if (!format) {
    return Response.json({ error: 'Unsupported resume file type.' }, { status: 415 })
  }

  try {
    const { submission, withdrawalToken } = await createSubmission(
      input,
      {
        resumeFilename: upload.filename,
        resumeFormat: format,
        resumeSizeKb: upload.sizeKb,
        resumeBlobPath: upload.path,
        parseMethod: parseMethod as ParseMethod,
        refCode: refCode || undefined,
        consentIp: ip === 'unknown' ? undefined : ip,
      },
      now,
    )

    // Carries the withdrawal link. The plaintext token is not persisted, so this
    // is the only moment it can be delivered.
    await sendEmail(
      submissionReceipt({
        to: submission.email,
        firstName: submission.firstName,
        submissionId: submission.submissionId,
        withdrawalToken,
        retentionExpiryDate: submission.retentionExpiryDate,
      }),
    )

    return Response.json({
      submissionId: submission.submissionId,
      retentionExpiryDate: submission.retentionExpiryDate,
    })
  } catch (error) {
    if (error instanceof DuplicateSubmission) {
      return Response.json({ error: error.message, duplicate: true }, { status: 409 })
    }
    console.error('Submission failed', error)
    return Response.json(
      { error: 'Something went wrong saving your application. Please try again.' },
      { status: 500 },
    )
  }
}
