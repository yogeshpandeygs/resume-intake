import type { Submission } from './db/schema'
import { monthsToExpiry, toIstIso } from './domain/dates'

/**
 * The CSV contract: columns 1-34 from the PRD, in order, with the header names
 * used verbatim.
 *
 * Three fields held in the database are excluded by design and never appear in
 * the projection below:
 *
 *   - `withdrawal_token` — a bearer credential; anyone holding the file could
 *     erase records.
 *   - `consent_ip` — personal data with no recruitment use.
 *   - `resume_blob_path` — a permanent unauthenticated link to a CV.
 *
 * The resume is identified by `submission_id` + `resume_filename` instead, and
 * downloaded through the authenticated admin route.
 */
export const EXPORT_COLUMNS = [
  'submission_id',
  'submitted_at',
  'first_name',
  'last_name',
  'email',
  'phone',
  'highest_qualification',
  'graduation_institution',
  'graduation_year',
  'postgraduation_institution',
  'postgraduation_year',
  'doctoral_institution',
  'doctoral_year',
  'current_location',
  'current_organisation',
  'designation',
  'current_role_start_date',
  'organisation_function',
  'total_years_experience',
  'experience_band',
  'industry_group',
  'experience_summary',
  'key_skills',
  'achievements_certifications',
  'resume_filename',
  'resume_format',
  'resume_size_kb',
  'parse_method',
  'ref_code',
  'duplicate_flag',
  'consent_notice_version',
  'consent_timestamp',
  'retention_expiry_date',
  'months_to_expiry',
] as const

export type ExportColumn = (typeof EXPORT_COLUMNS)[number]

/** One decimal place, as specified for `total_years_experience`. */
function decimal1(value: number): string {
  return value.toFixed(1)
}

/**
 * Project one submission onto the export row. `months_to_expiry` is computed
 * here rather than read from a column, so it is correct on the day of export.
 */
export function toExportRow(s: Submission, now: Date = new Date()): readonly unknown[] {
  return [
    s.submissionId,
    toIstIso(s.submittedAt),
    s.firstName,
    s.lastName,
    s.email,
    s.phone,
    s.highestQualification,
    s.graduationInstitution,
    s.graduationYear,
    s.postgraduationInstitution,
    s.postgraduationYear,
    s.doctoralInstitution,
    s.doctoralYear,
    s.currentLocation,
    s.currentOrganisation,
    s.designation,
    s.currentRoleStartDate,
    s.organisationFunction,
    decimal1(s.totalYearsExperience),
    s.experienceBand,
    s.industryGroup,
    s.experienceSummary,
    s.keySkills,
    s.achievementsCertifications,
    s.resumeFilename,
    s.resumeFormat,
    s.resumeSizeKb,
    s.parseMethod,
    s.refCode,
    s.duplicateFlag,
    s.consentNoticeVersion,
    toIstIso(s.consentTimestamp),
    s.retentionExpiryDate,
    monthsToExpiry(s.retentionExpiryDate, now),
  ]
}
