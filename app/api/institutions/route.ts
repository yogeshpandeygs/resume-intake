import { ilike } from 'drizzle-orm'
import { db } from '@/lib/db'
import { institutions } from '@/lib/db/schema'
import { normaliseName } from '@/lib/domain/fields'

/**
 * Type-ahead suggestions for the institution fields.
 *
 * Public, because the form it serves is public. It returns nothing but
 * institution names from a seeded reference list — no candidate data is
 * reachable through it.
 */

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''

  // Two characters is the point where suggestions become useful rather than
  // returning a slice of the entire table.
  if (query.length < 2) {
    return Response.json({ institutions: [] })
  }

  const pattern = `%${normaliseName(query).replace(/[\\%_]/g, (c) => `\\${c}`)}%`

  const rows = await db
    .select({ name: institutions.name })
    .from(institutions)
    .where(ilike(institutions.nameNorm, pattern))
    .limit(10)

  return Response.json(
    { institutions: rows.map((row) => row.name) },
    // A reference list changes rarely; let the browser hold it briefly.
    { headers: { 'cache-control': 'public, max-age=300' } },
  )
}
