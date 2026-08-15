import { db } from './db'
import { institutions } from './db/schema'

/**
 * The seeded institution list, cached in memory.
 *
 * Used by the resume reader to recognise where a candidate studied, which is by
 * far the most reliable way to pull an institution out of a resume: matching
 * against a known list beats guessing from capitalisation. The list changes only
 * when it is re-seeded, so re-reading it on every upload would be wasted work.
 */

const CACHE_TTL_MS = 10 * 60 * 1000

let cache: { names: string[]; loadedAt: number } | undefined

export async function knownInstitutionNames(): Promise<string[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.names
  }

  try {
    const rows = await db.select({ name: institutions.name }).from(institutions)
    cache = { names: rows.map((row) => row.name), loadedAt: Date.now() }
    return cache.names
  } catch {
    // The reader falls back to pattern matching without the list, so a failure
    // here degrades quality rather than breaking the upload.
    return cache?.names ?? []
  }
}
