import { cronSecret, isProduction } from '@/lib/env'
import { runDailyMaintenance } from '@/lib/maintenance'

/**
 * The daily sweep: erase expired records, invite renewals 30 days out, and clear
 * away uploads whose application was never submitted.
 *
 * Scheduled by Vercel Cron (see `vercel.json`). Vercel presents `CRON_SECRET` as a
 * bearer token; without that check this route would be a public endpoint that
 * deletes data.
 */

export const runtime = 'nodejs'
export const maxDuration = 300

function authorised(request: Request): boolean {
  if (!cronSecret) {
    // No secret configured: allowed locally so the job can be exercised by hand,
    // refused in production rather than left open.
    return !isProduction
  }
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const report = await runDailyMaintenance()

  // Errors are reported rather than thrown: a partial sweep should still record
  // what it managed to do, and the next tick retries the rest.
  return Response.json(report, { status: report.errors.length > 0 ? 207 : 200 })
}
