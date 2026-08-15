import { assertReadOnlyRequest, authErrorResponse } from '@/lib/auth/admin'
import { CONTENT_TYPES } from '@/lib/parse'
import { findSubmissionById } from '@/lib/queries'
import { storage } from '@/lib/storage'

/**
 * Streams the original resume to an authenticated admin.
 *
 * The blob path is never exported precisely so that the file is not reachable
 * without a session; this route is the only way to it. The submission's UUID is
 * the handle, so a stored path is never accepted from the caller.
 */

export const runtime = 'nodejs'

export async function GET(request: Request, ctx: RouteContext<'/api/admin/resume/[id]'>) {
  try {
    await assertReadOnlyRequest(request)
  } catch (error) {
    return authErrorResponse(error)
  }

  const { id } = await ctx.params

  const submission = await findSubmissionById(id)
  if (!submission) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  let data: Uint8Array
  try {
    data = await storage.get(submission.resumeBlobPath)
  } catch {
    return Response.json({ error: 'The stored resume could not be read.' }, { status: 404 })
  }

  // `filename*` carries the UTF-8 form so accented filenames survive; the plain
  // `filename` is an ASCII fallback for older clients.
  const asciiName = submission.resumeFilename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')

  return new Response(data as unknown as BodyInit, {
    headers: {
      'content-type': CONTENT_TYPES[submission.resumeFormat],
      'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(submission.resumeFilename)}`,
      'content-length': String(data.byteLength),
      'cache-control': 'no-store, private',
    },
  })
}
