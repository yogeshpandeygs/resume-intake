import { beforeEach, describe, expect, it } from 'vitest'
import { csvRow } from '../lib/csv'
import { EXPORT_COLUMNS, toExportRow } from '../lib/export-columns'
import {
  countSubmissions,
  describeFilters,
  listSubmissions,
  parseFilters,
  streamSubmissionsForExport,
} from '../lib/queries'
import { createSubmission } from '../lib/submissions'
import { resetDatabase, submissionInput, submissionMetadata } from './helpers/db'

const NOW = new Date('2026-08-15T07:00:00Z')

beforeEach(async () => {
  await resetDatabase()
})

/** Three candidates spanning different bands, industries and institutions. */
async function seedCandidates() {
  await createSubmission(
    submissionInput({
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      totalYearsExperience: 8.5, // Mid-career
      industryGroup: 'IT',
      graduationInstitution: 'Indian Institute of Technology Bombay',
      graduationYear: 2016,
      keySkills: 'Python; SQL',
    }),
    submissionMetadata({ refCode: 'walkin-blr-aug' }),
    NOW,
  )
  await createSubmission(
    submissionInput({
      firstName: 'Arjun',
      lastName: 'Nair',
      email: 'arjun@example.com',
      totalYearsExperience: 2, // Early careers
      industryGroup: 'BioPharma',
      graduationInstitution: 'Anna University',
      graduationYear: 2023,
      keySkills: 'HPLC; Chromatography',
    }),
    submissionMetadata({ refCode: 'whatsapp' }),
    NOW,
  )
  await createSubmission(
    submissionInput({
      firstName: 'Meera',
      lastName: 'Iyer',
      email: 'meera@example.com',
      totalYearsExperience: 17, // Executive professionals
      industryGroup: 'IT',
      graduationInstitution: 'Indian Institute of Technology Madras',
      graduationYear: 2005,
      keySkills: 'Strategy; Python',
    }),
    submissionMetadata({ refCode: 'walkin-blr-aug' }),
    NOW,
  )
}

async function exportedRows(params: string) {
  const filters = parseFilters(new URLSearchParams(params))
  const rows = []
  for await (const submission of streamSubmissionsForExport(filters)) rows.push(submission)
  return rows
}

describe('filters', () => {
  beforeEach(seedCandidates)

  it('filters by experience band', async () => {
    const rows = await exportedRows('band=Mid-career')
    expect(rows.map((r) => r.firstName)).toEqual(['Priya'])
  })

  it('filters by industry group', async () => {
    const rows = await exportedRows('industry=IT')
    expect(rows.map((r) => r.firstName).sort()).toEqual(['Meera', 'Priya'])
  })

  it('combines band and industry', async () => {
    const rows = await exportedRows('band=Executive professionals&industry=IT')
    expect(rows.map((r) => r.firstName)).toEqual(['Meera'])
  })

  it('filters by year of passing range', async () => {
    const rows = await exportedRows('yearLevel=graduation&yearFrom=2010&yearTo=2020')
    expect(rows.map((r) => r.firstName)).toEqual(['Priya'])
  })

  it('filters by institution, matching partially', async () => {
    const rows = await exportedRows('institution=Indian Institute of Technology')
    expect(rows.map((r) => r.firstName).sort()).toEqual(['Meera', 'Priya'])
  })

  it('filters by campaign code', async () => {
    const rows = await exportedRows('refCode=whatsapp')
    expect(rows.map((r) => r.firstName)).toEqual(['Arjun'])
  })

  it('searches name, email and skills', async () => {
    expect((await exportedRows('q=Nair')).map((r) => r.firstName)).toEqual(['Arjun'])
    expect((await exportedRows('q=meera@example.com')).map((r) => r.firstName)).toEqual(['Meera'])
    expect((await exportedRows('q=Python')).map((r) => r.firstName).sort()).toEqual([
      'Meera',
      'Priya',
    ])
  })

  it('treats an unrecognised filter value as no filter', async () => {
    expect(await exportedRows('band=Not+A+Band')).toHaveLength(3)
  })

  it('does not let wildcards in a search term match everything', async () => {
    expect(await exportedRows('q=%')).toHaveLength(0)
  })

  it('returns everything when unfiltered', async () => {
    expect(await exportedRows('')).toHaveLength(3)
  })
})

describe('the export matches the view', () => {
  beforeEach(seedCandidates)

  it('exports exactly the rows the dashboard shows for the same query', async () => {
    // This is the PRD's "what is on screen is what downloads" guarantee. Both go
    // through parseFilters and the same query builder.
    const params = new URLSearchParams('industry=IT&band=Mid-career')
    const filters = parseFilters(params)

    const onScreen = await listSubmissions(filters, { limit: 50, offset: 0 })
    const downloaded = await exportedRows(params.toString())

    expect(downloaded.map((r) => r.submissionId).sort()).toEqual(
      onScreen.map((r) => r.submissionId).sort(),
    )
    expect(await countSubmissions(filters)).toBe(downloaded.length)
  })
})

describe('export rows', () => {
  beforeEach(seedCandidates)

  it('produces one value per declared column', async () => {
    const [submission] = await exportedRows('q=Priya')
    expect(toExportRow(submission!, NOW)).toHaveLength(EXPORT_COLUMNS.length)
  })

  it('never emits the three excluded fields', async () => {
    const [submission] = await exportedRows('q=Priya')
    const line = csvRow(toExportRow(submission!, NOW))

    expect(line).not.toContain(submission!.withdrawalTokenHash)
    expect(line).not.toContain(submission!.resumeBlobPath)
    // The blob path is the only place an unauthenticated resume link could leak.
    expect(line).not.toMatch(/resumes\//)
  })

  it('formats experience to one decimal place', async () => {
    const [submission] = await exportedRows('q=Meera')
    const row = toExportRow(submission!, NOW)
    expect(row[EXPORT_COLUMNS.indexOf('total_years_experience')]).toBe('17.0')
  })

  it('carries IST offsets on the timestamps', async () => {
    const [submission] = await exportedRows('q=Priya')
    const row = toExportRow(submission!, NOW)
    expect(String(row[EXPORT_COLUMNS.indexOf('submitted_at')])).toMatch(/\+05:30$/)
    expect(String(row[EXPORT_COLUMNS.indexOf('consent_timestamp')])).toMatch(/\+05:30$/)
  })

  it('computes months_to_expiry against the export date, not the submission date', async () => {
    const [submission] = await exportedRows('q=Priya')

    const atSubmission = toExportRow(submission!, NOW)
    const twoYearsLater = toExportRow(submission!, new Date('2028-08-15T07:00:00Z'))

    expect(atSubmission[EXPORT_COLUMNS.indexOf('months_to_expiry')]).toBe(36)
    expect(twoYearsLater[EXPORT_COLUMNS.indexOf('months_to_expiry')]).toBe(12)
  })
})

describe('describeFilters', () => {
  it('records only the filters actually applied, for the export log', () => {
    const filters = parseFilters(new URLSearchParams('band=Mid-career&q=python'))
    const described = describeFilters(filters)
    expect(described).toMatchObject({ band: 'Mid-career', q: 'python' })
    expect(Object.keys(described)).not.toContain('industry')
  })
})
