import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { db } from '../../lib/db'
import type { SubmissionInput } from '../../lib/domain/fields'
import type { SubmissionMetadata } from '../../lib/submissions'

let migrated = false

/** Apply the real migrations to the in-memory database, once per test run. */
export async function ensureSchema(): Promise<void> {
  if (migrated) return
  await migrate(db as never, { migrationsFolder: './drizzle' })
  migrated = true
}

/** Empty every table so each test starts from a known state. */
export async function resetDatabase(): Promise<void> {
  await ensureSchema()
  await db.execute(
    sql`TRUNCATE submissions, submission_counters, uploads, outbox, export_log, rate_limits, institutions RESTART IDENTITY CASCADE`,
  )
}

/** A valid submission, with overrides for whatever the test is actually about. */
export function submissionInput(overrides: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@example.com',
    phone: '+919876543210',
    highestQualification: 'B.Tech',
    graduationInstitution: 'IIT Bombay',
    graduationYear: 2016,
    postgraduationInstitution: undefined,
    postgraduationYear: undefined,
    doctoralInstitution: undefined,
    doctoralYear: undefined,
    currentLocation: 'Bengaluru',
    currentOrganisation: 'Acme Corp',
    designation: 'Senior Engineer',
    currentRoleStartDate: '2022-04-01',
    organisationFunction: 'Operations',
    totalYearsExperience: 8.5,
    industryGroup: 'IT',
    experienceSummary: 'Eight years building data platforms.',
    keySkills: 'Python; SQL',
    achievementsCertifications: undefined,
    consent: true,
    ...overrides,
  } as SubmissionInput
}

export function submissionMetadata(
  overrides: Partial<SubmissionMetadata> = {},
): SubmissionMetadata {
  return {
    resumeFilename: 'priya-sharma.pdf',
    resumeFormat: 'pdf',
    resumeSizeKb: 240,
    resumeBlobPath: `resumes/${Math.random().toString(16).slice(2)}.pdf`,
    parseMethod: 'text',
    ...overrides,
  }
}
