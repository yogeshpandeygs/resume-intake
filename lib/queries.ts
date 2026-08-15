import { and, asc, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm'
import { db } from './db'
import { submissions, type Submission } from './db/schema'
import {
  EXPERIENCE_BANDS,
  INDUSTRY_GROUPS,
  type ExperienceBand,
  type IndustryGroup,
} from './domain/constants'

/**
 * The dashboard filters, and the single query builder both the table and the CSV
 * export run through.
 *
 * The PRD requires that "what is on screen is what downloads". Rather than trusting
 * two code paths to stay in step, both call `buildWhere` with the same parsed
 * filters — the export cannot drift from the view because there is only one
 * definition of what the filters mean.
 */

export type EducationLevel = 'graduation' | 'postgraduation' | 'doctoral'

export interface SubmissionFilters {
  band?: ExperienceBand
  industry?: IndustryGroup
  /** Which qualification the year range applies to. Defaults to graduation. */
  yearLevel?: EducationLevel
  yearFrom?: number
  yearTo?: number
  institution?: string
  refCode?: string
  /** Free text across name, email and skills. */
  q?: string
}

// Left unannotated so each entry keeps its own column type; a `Record` keyed to
// one of them would force the nullable columns into the non-null column's shape.
const YEAR_COLUMNS = {
  graduation: submissions.graduationYear,
  postgraduation: submissions.postgraduationYear,
  doctoral: submissions.doctoralYear,
} satisfies Record<EducationLevel, unknown>

const INSTITUTION_COLUMNS = [
  submissions.graduationInstitution,
  submissions.postgraduationInstitution,
  submissions.doctoralInstitution,
] as const

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

function positiveInt(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function text(value: string | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, 200) : undefined
}

/**
 * Read filters off the query string, discarding anything unrecognised. Both the
 * dashboard page and the export route parse the same way, from the same URL.
 */
export function parseFilters(params: URLSearchParams): SubmissionFilters {
  return {
    band: oneOf(params.get('band'), EXPERIENCE_BANDS),
    industry: oneOf(params.get('industry'), INDUSTRY_GROUPS),
    yearLevel: oneOf(params.get('yearLevel'), [
      'graduation',
      'postgraduation',
      'doctoral',
    ] as const),
    yearFrom: positiveInt(params.get('yearFrom')),
    yearTo: positiveInt(params.get('yearTo')),
    institution: text(params.get('institution')),
    refCode: text(params.get('refCode')),
    q: text(params.get('q')),
  }
}

/** The filters as a plain object, for the export log. */
export function describeFilters(filters: SubmissionFilters): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''),
  )
}

/** Escape the wildcards so a candidate searching for `100%` does not match everything. */
function likeValue(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export function buildWhere(filters: SubmissionFilters): SQL | undefined {
  const conditions: SQL[] = []

  if (filters.band) conditions.push(eq(submissions.experienceBand, filters.band))
  if (filters.industry) conditions.push(eq(submissions.industryGroup, filters.industry))
  if (filters.refCode) conditions.push(eq(submissions.refCode, filters.refCode))

  const yearColumn = YEAR_COLUMNS[filters.yearLevel ?? 'graduation']
  if (filters.yearFrom !== undefined) conditions.push(gte(yearColumn, filters.yearFrom))
  if (filters.yearTo !== undefined) conditions.push(lte(yearColumn, filters.yearTo))

  // Institution matches at any level: an admin filtering for "IIT Bombay" wants
  // everyone who studied there, not only those whose first degree was there.
  if (filters.institution) {
    const pattern = likeValue(filters.institution)
    const clause = or(...INSTITUTION_COLUMNS.map((column) => ilike(column, pattern)))
    if (clause) conditions.push(clause)
  }

  if (filters.q) {
    const pattern = likeValue(filters.q)
    const clause = or(
      ilike(submissions.firstName, pattern),
      ilike(submissions.lastName, pattern),
      ilike(submissions.email, pattern),
      ilike(submissions.keySkills, pattern),
    )
    if (clause) conditions.push(clause)
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

export interface PageOptions {
  limit: number
  offset: number
  sort?: 'newest' | 'oldest' | 'expiring'
}

function orderBy(sort: PageOptions['sort']) {
  switch (sort) {
    case 'oldest':
      return asc(submissions.submittedAt)
    case 'expiring':
      return asc(submissions.retentionExpiryDate)
    default:
      return desc(submissions.submittedAt)
  }
}

/** One page of the dashboard table. */
export async function listSubmissions(
  filters: SubmissionFilters,
  page: PageOptions,
): Promise<Submission[]> {
  return db
    .select()
    .from(submissions)
    .where(buildWhere(filters))
    .orderBy(orderBy(page.sort))
    .limit(page.limit)
    .offset(page.offset)
}

export async function countSubmissions(filters: SubmissionFilters): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(submissions)
    .where(buildWhere(filters))
  return row?.value ?? 0
}

/**
 * Every matching record, for the export. Read in batches so a large unfiltered
 * export streams rather than materialising the whole table at once.
 */
export async function* streamSubmissionsForExport(
  filters: SubmissionFilters,
  batchSize = 500,
): AsyncGenerator<Submission> {
  const where = buildWhere(filters)
  let offset = 0

  while (true) {
    const batch = await db
      .select()
      .from(submissions)
      .where(where)
      .orderBy(desc(submissions.submittedAt))
      .limit(batchSize)
      .offset(offset)

    if (batch.length === 0) return
    for (const row of batch) yield row
    if (batch.length < batchSize) return
    offset += batchSize
  }
}

export async function findSubmissionById(id: string): Promise<Submission | undefined> {
  const [row] = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1)
  return row
}
