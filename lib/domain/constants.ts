/**
 * Enumerations and limits from PRD v0.6 "Data fields".
 *
 * These are the single source of truth: the Drizzle schema, the Zod validators
 * and the CSV writer all derive from them, so a change here propagates rather
 * than needing to be mirrored in three places.
 */

export const ORGANISATION_FUNCTIONS = [
  'Marketing',
  'Operations',
  'Sales',
  'Finance',
  'Human Resources',
  'Admin',
  'Others',
  'Freshers',
] as const
export type OrganisationFunction = (typeof ORGANISATION_FUNCTIONS)[number]

export const INDUSTRY_GROUPS = [
  'IT',
  'ITeS',
  'Financial services',
  'Manufacturing',
  'BioPharma',
  'Others',
] as const
export type IndustryGroup = (typeof INDUSTRY_GROUPS)[number]

export const EXPERIENCE_BANDS = [
  'Early careers',
  'Mid-career',
  'Senior professionals',
  'Executive professionals',
] as const
export type ExperienceBand = (typeof EXPERIENCE_BANDS)[number]

export const RESUME_FORMATS = ['pdf', 'docx', 'doc'] as const
export type ResumeFormat = (typeof RESUME_FORMATS)[number]

export const PARSE_METHODS = ['text', 'vision', 'manual'] as const
export type ParseMethod = (typeof PARSE_METHODS)[number]

export const DUPLICATE_FLAGS = ['none', 'email_match', 'name_match'] as const
export type DuplicateFlag = (typeof DUPLICATE_FLAGS)[number]

/** Candidates whose organisation function is Freshers skip the employment fields. */
export const FRESHERS: OrganisationFunction = 'Freshers'

/** PRD: max 5 MB upload. Expressed in KB because `resume_size_kb` is the stored column. */
export const MAX_RESUME_SIZE_KB = 5120
export const MAX_RESUME_SIZE_BYTES = MAX_RESUME_SIZE_KB * 1024

/** Below this many extracted characters we treat a PDF as scanned and fall back to vision. */
export const MIN_TEXT_LAYER_CHARS = 200

export const EARLIEST_GRADUATION_YEAR = 1960

/** Retention period from the DPDP notice. */
export const RETENTION_MONTHS = 36
/** Re-consent invitation goes out this many days before expiry. */
export const RECONSENT_LEAD_DAYS = 30

export const EXPERIENCE_SUMMARY_MAX_WORDS = 100
export const ACHIEVEMENTS_MAX_WORDS = 200

/**
 * Version stamped onto every consent record. Bump this whenever the notice text
 * in `components/ConsentNotice.tsx` changes, so we can prove which wording a
 * given candidate actually agreed to.
 */
export const CONSENT_NOTICE_VERSION = '1.0'
