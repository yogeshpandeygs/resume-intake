import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { uploads } from '@/lib/db/schema'
import { knownInstitutionNames } from '@/lib/institutions'
import { parseResume, resumeFormatFromFilename } from '@/lib/parse'
import { clientIp, consumeRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { storage } from '@/lib/storage'

/**
 * Reads a stored resume and returns values to pre-fill the form.
 *
 * Split out from upload and submit so each stays inside a sensible function
 * timeout: reading a scanned PDF with the model is by far the slowest step, and
 * it should not be holding an upload or a database write open while it runs.
 */

export const runtime = 'nodejs'
/** Vision extraction on a multi-page scan is the long pole here. */
export const maxDuration = 300

const bodySchema = z.object({
  path: z.string().min(1),
})

export async function POST(request: Request) {
  const ip = clientIp(request)
  const limit = await consumeRateLimit(RATE_LIMITS.parseByIp, ip)
  if (!limit.allowed) {
    return rateLimitResponse(
      limit,
      'Too many resumes read from this connection. Please try again later.',
    )
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 })
  }

  // The path must correspond to a file this app stored. Without this check the
  // endpoint would read whatever path a caller supplied.
  const [upload] = await db
    .select()
    .from(uploads)
    .where(eq(uploads.path, body.data.path))
    .limit(1)

  if (!upload) {
    return Response.json(
      { error: 'That upload was not found. Please attach your resume again.' },
      { status: 404 },
    )
  }

  const format = resumeFormatFromFilename(upload.filename)
  if (!format) {
    return Response.json({ error: 'Unsupported file type.' }, { status: 415 })
  }

  let data: Uint8Array
  try {
    data = await storage.get(upload.path)
  } catch {
    return Response.json(
      { error: 'We could not read your uploaded file. Please attach it again.' },
      { status: 404 },
    )
  }

  // The seeded institution list makes recognising where a candidate studied far
  // more reliable than inferring it from the text alone.
  const knownInstitutions = await knownInstitutionNames()

  const result = await parseResume(data, format, new Date(), { knownInstitutions })

  if (!result.ok) {
    return Response.json({ error: result.message }, { status: 422 })
  }

  return Response.json({
    parseMethod: result.parseMethod,
    prefill: result.prefill,
    notice: result.notice,
    extractionNotes: result.extractionNotes,
  })
}
