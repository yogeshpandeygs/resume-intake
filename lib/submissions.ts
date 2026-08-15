import { and, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { submissionCounters, submissions, uploads, type Submission } from './db/schema'
import {
  CONSENT_NOTICE_VERSION,
  RETENTION_MONTHS,
  type DuplicateFlag,
  type ParseMethod,
  type ResumeFormat,
} from './domain/constants'
import { istCivilDate, retentionExpiryDate } from './domain/dates'
import {
  experienceBand,
  formatSubmissionId,
  normaliseEmail,
  normaliseName,
  normaliseSkills,
  type SubmissionInput,
} from './domain/fields'
import { recruitmentEmail } from './env'
import { generateWithdrawalToken, hashWithdrawalToken } from './tokens'

/**
 * Raised when the duplicate rule blocks a submission: an exact match on
 * normalised email *and* first name *and* last name.
 */
export class DuplicateSubmission extends Error {
  constructor() {
    super(
      `An application under this name and email already exists in our records. If you need to update your details, please write to ${recruitmentEmail}`,
    )
    this.name = 'DuplicateSubmission'
  }
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 *
 * Drizzle wraps driver errors in its own `Failed query: ...` error, so the
 * SQLSTATE lives on `cause` rather than the error we catch. The chain is walked
 * to whatever depth the driver nests it.
 */
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 5) return false

  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown }
  if (candidate.code === '23505') return true
  if (
    typeof candidate.message === 'string' &&
    /duplicate key value|unique constraint/i.test(candidate.message)
  ) {
    return true
  }

  return isUniqueViolation(candidate.cause, depth + 1)
}

export interface SubmissionMetadata {
  resumeFilename: string
  resumeFormat: ResumeFormat
  resumeSizeKb: number
  resumeBlobPath: string
  parseMethod: ParseMethod
  refCode?: string
  consentIp?: string
}

export interface CreatedSubmission {
  submission: Submission
  /** Plaintext, returned exactly once so it can be emailed. Never persisted. */
  withdrawalToken: string
}

/**
 * Insert a submission.
 *
 * The duplicate check and the insert run in one transaction, and the decisive
 * guard is the unique index on the three normalised columns rather than the
 * SELECT: two candidates submitting the same identity simultaneously would both
 * pass a check-then-insert, and only the index stops the second one.
 */
export async function createSubmission(
  input: SubmissionInput,
  meta: SubmissionMetadata,
  now: Date = new Date(),
): Promise<CreatedSubmission> {
  const emailNorm = normaliseEmail(input.email)
  const firstNameNorm = normaliseName(input.firstName)
  const lastNameNorm = normaliseName(input.lastName)

  const withdrawalToken = generateWithdrawalToken()

  try {
    return await db.transaction(async (tx) => {
      const year = istCivilDate(now).year

      // Atomic per-year counter: the UPDATE ... RETURNING means two concurrent
      // submissions cannot be handed the same sequence number.
      const [counter] = await tx
        .insert(submissionCounters)
        .values({ year, lastValue: 1 })
        .onConflictDoUpdate({
          target: submissionCounters.year,
          set: { lastValue: sql`${submissionCounters.lastValue} + 1` },
        })
        .returning({ lastValue: submissionCounters.lastValue })

      const submissionId = formatSubmissionId(year, counter!.lastValue)

      const [inserted] = await tx
        .insert(submissions)
        .values({
          submissionId,
          submittedAt: now,

          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          emailNorm,
          firstNameNorm,
          lastNameNorm,

          highestQualification: input.highestQualification,
          graduationInstitution: input.graduationInstitution,
          graduationYear: input.graduationYear,
          postgraduationInstitution: input.postgraduationInstitution ?? null,
          postgraduationYear: input.postgraduationYear ?? null,
          doctoralInstitution: input.doctoralInstitution ?? null,
          doctoralYear: input.doctoralYear ?? null,

          currentLocation: input.currentLocation,
          currentOrganisation: input.currentOrganisation ?? null,
          designation: input.designation ?? null,
          currentRoleStartDate: input.currentRoleStartDate ?? null,

          organisationFunction: input.organisationFunction,
          totalYearsExperience: input.totalYearsExperience,
          experienceBand: experienceBand(input.totalYearsExperience),
          industryGroup: input.industryGroup,

          experienceSummary: input.experienceSummary,
          keySkills: normaliseSkills(input.keySkills),
          achievementsCertifications: input.achievementsCertifications ?? null,

          resumeFilename: meta.resumeFilename,
          resumeFormat: meta.resumeFormat,
          resumeSizeKb: meta.resumeSizeKb,
          parseMethod: meta.parseMethod,
          resumeBlobPath: meta.resumeBlobPath,

          refCode: meta.refCode ?? null,
          duplicateFlag: await computeDuplicateFlag(tx, emailNorm, firstNameNorm, lastNameNorm),

          consentNoticeVersion: CONSENT_NOTICE_VERSION,
          consentTimestamp: now,
          retentionExpiryDate: retentionExpiryDate(now, RETENTION_MONTHS),

          withdrawalTokenHash: hashWithdrawalToken(withdrawalToken),
          consentIp: meta.consentIp ?? null,
        })
        .returning()

      // Mark the uploaded file as belonging to a submission so the orphan sweep
      // leaves it alone.
      await tx
        .update(uploads)
        .set({ claimedAt: now })
        .where(eq(uploads.path, meta.resumeBlobPath))

      return { submission: inserted!, withdrawalToken }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DuplicateSubmission()
    }
    throw error
  }
}

/**
 * Flag partial matches against existing records (PRD field 30). A match on all
 * three fields never reaches here — the unique index rejects the insert.
 *
 * When a record matches on email and a different record matches on name, the
 * column can only hold one value; email is the stronger signal, so it wins.
 */
async function computeDuplicateFlag(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  emailNorm: string,
  firstNameNorm: string,
  lastNameNorm: string,
): Promise<DuplicateFlag> {
  const emailMatch = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.emailNorm, emailNorm))
    .limit(1)

  if (emailMatch.length > 0) return 'email_match'

  const nameMatch = await tx
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.firstNameNorm, firstNameNorm),
        eq(submissions.lastNameNorm, lastNameNorm),
      ),
    )
    .limit(1)

  return nameMatch.length > 0 ? 'name_match' : 'none'
}
