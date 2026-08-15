import { assertReadOnlyRequest, authErrorResponse } from '@/lib/auth/admin'
import { csvRow, exportFilename, UTF8_BOM } from '@/lib/csv'
import { db } from '@/lib/db'
import { exportLog } from '@/lib/db/schema'
import { formatCivilDate, istCivilDate } from '@/lib/domain/dates'
import { EXPORT_COLUMNS, toExportRow } from '@/lib/export-columns'
import { describeFilters, parseFilters, streamSubmissionsForExport } from '@/lib/queries'

/**
 * `GET /admin/export.csv` — the filtered CSV export.
 *
 * The export runs through the same `parseFilters` + query builder as the
 * dashboard table, from the same query string, so "what is on screen is what
 * downloads" holds structurally rather than by two code paths agreeing.
 *
 * Generated as a stream so an unfiltered export of the whole table does not have
 * to be held in memory before the download starts.
 */

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request) {
  try {
    await assertReadOnlyRequest(request)
  } catch (error) {
    return authErrorResponse(error)
  }

  const url = new URL(request.url)
  const filters = parseFilters(url.searchParams)
  const now = new Date()

  let rowCount = 0
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // BOM first, so Excel on Windows renders Indian names and accented
        // characters instead of mojibake.
        controller.enqueue(encoder.encode(UTF8_BOM + csvRow(EXPORT_COLUMNS) + '\r\n'))

        for await (const submission of streamSubmissionsForExport(filters)) {
          controller.enqueue(encoder.encode(csvRow(toExportRow(submission, now)) + '\r\n'))
          rowCount += 1
        }

        // The admin session is read-only, so this log is the only record of what
        // left the system. Written after the rows so the count is accurate.
        await db.insert(exportLog).values({
          filters: describeFilters(filters),
          rowCount,
        })

        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  const filename = exportFilename(formatCivilDate(istCivilDate(now)))

  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      // A CSV of candidate data should never sit in a shared cache.
      'cache-control': 'no-store, private',
    },
  })
}
