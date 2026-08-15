import { sql } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type {
  DuplicateFlag,
  ExperienceBand,
  IndustryGroup,
  OrganisationFunction,
  ParseMethod,
  ResumeFormat,
} from '../domain/constants'

/**
 * The 34 PRD columns, plus three fields held in the database but deliberately
 * never exported: `withdrawalTokenHash`, `consentIp` and `resumeBlobPath`.
 *
 * Enum-valued columns are `text` narrowed with `$type` rather than Postgres enums:
 * the values are already enforced by Zod on the way in, and this keeps adding an
 * industry group from being a migration that rewrites a type.
 */
export const submissions = pgTable(
  'submissions',
  {
    // Internal key. `submissionId` is the candidate- and admin-facing reference.
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: text('submission_id').notNull().unique(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),

    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),

    /**
     * Normalised shadow copies backing the duplicate check. A unique index across
     * all three makes the "exact match on all three blocks submission" rule
     * race-safe, instead of a check-then-insert that two concurrent requests can
     * both pass.
     */
    emailNorm: text('email_norm').notNull(),
    firstNameNorm: text('first_name_norm').notNull(),
    lastNameNorm: text('last_name_norm').notNull(),

    highestQualification: text('highest_qualification').notNull(),
    graduationInstitution: text('graduation_institution').notNull(),
    graduationYear: integer('graduation_year').notNull(),
    postgraduationInstitution: text('postgraduation_institution'),
    postgraduationYear: integer('postgraduation_year'),
    doctoralInstitution: text('doctoral_institution'),
    doctoralYear: integer('doctoral_year'),

    currentLocation: text('current_location').notNull(),
    currentOrganisation: text('current_organisation'),
    designation: text('designation'),
    currentRoleStartDate: date('current_role_start_date'),

    organisationFunction: text('organisation_function').$type<OrganisationFunction>().notNull(),
    totalYearsExperience: numeric('total_years_experience', {
      precision: 4,
      scale: 1,
      mode: 'number',
    }).notNull(),
    experienceBand: text('experience_band').$type<ExperienceBand>().notNull(),
    industryGroup: text('industry_group').$type<IndustryGroup>().notNull(),

    experienceSummary: text('experience_summary').notNull(),
    keySkills: text('key_skills').notNull(),
    achievementsCertifications: text('achievements_certifications'),

    resumeFilename: text('resume_filename').notNull(),
    resumeFormat: text('resume_format').$type<ResumeFormat>().notNull(),
    resumeSizeKb: integer('resume_size_kb').notNull(),
    parseMethod: text('parse_method').$type<ParseMethod>().notNull(),

    refCode: text('ref_code'),
    duplicateFlag: text('duplicate_flag').$type<DuplicateFlag>().notNull().default('none'),

    consentNoticeVersion: text('consent_notice_version').notNull(),
    consentTimestamp: timestamp('consent_timestamp', { withTimezone: true }).notNull(),
    retentionExpiryDate: date('retention_expiry_date').notNull(),

    /* --- held but never exported ------------------------------------- */

    /**
     * SHA-256 of the withdrawal token. The token itself exists only in the email:
     * it is a bearer credential that erases a record, so storing it in plaintext
     * would make a database read equivalent to the ability to delete.
     */
    withdrawalTokenHash: text('withdrawal_token_hash').notNull(),
    consentIp: text('consent_ip'),
    resumeBlobPath: text('resume_blob_path').notNull(),

    /* --- consent lifecycle bookkeeping -------------------------------- */

    /** Set when the candidate renews, which pushes `retentionExpiryDate` out again. */
    renewedAt: timestamp('renewed_at', { withTimezone: true }),
    /** Stops the T-30 mailer sending the same invitation on every cron tick. */
    reconsentNoticeSentAt: timestamp('reconsent_notice_sent_at', { withTimezone: true }),
  },
  (t) => [
    // The duplicate-block rule, enforced by the database rather than by a query.
    uniqueIndex('submissions_identity_unique').on(t.emailNorm, t.firstNameNorm, t.lastNameNorm),
    // Supports the `email_match` / `name_match` flag lookups and admin search.
    index('submissions_email_norm_idx').on(t.emailNorm),
    index('submissions_name_norm_idx').on(t.firstNameNorm, t.lastNameNorm),
    // Dashboard filters.
    index('submissions_band_idx').on(t.experienceBand),
    index('submissions_industry_idx').on(t.industryGroup),
    index('submissions_ref_code_idx').on(t.refCode),
    index('submissions_graduation_year_idx').on(t.graduationYear),
    // Expiry sweep and re-consent mailer scan by this.
    index('submissions_retention_idx').on(t.retentionExpiryDate),
  ],
)

export type Submission = typeof submissions.$inferSelect
export type NewSubmission = typeof submissions.$inferInsert

/**
 * Per-year counter behind `SUB-YYYY-NNNNNN`. Allocated with `UPDATE ... RETURNING`
 * inside the insert transaction so two concurrent submissions cannot be handed
 * the same sequence number.
 */
export const submissionCounters = pgTable('submission_counters', {
  year: integer('year').primaryKey(),
  lastValue: integer('last_value').notNull().default(0),
})

/** Seed list backing the institution type-ahead; candidates may still type anything. */
export const institutions = pgTable(
  'institutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Lowercased, accent-folded — the column the type-ahead actually searches. */
    nameNorm: text('name_norm').notNull(),
  },
  (t) => [uniqueIndex('institutions_name_norm_unique').on(t.nameNorm)],
)

/**
 * Every CSV export, with the filters that produced it and the row count.
 * The admin session is read-only, so this is the only record of what left the system.
 */
export const exportLog = pgTable('export_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  exportedAt: timestamp('exported_at', { withTimezone: true }).notNull().defaultNow(),
  filters: jsonb('filters').notNull(),
  rowCount: integer('row_count').notNull(),
})

/**
 * Outbound mail. With the email provider stubbed, this table *is* the mail
 * transport: the withdrawal and re-consent flows write here and the messages are
 * inspectable in the admin UI and in tests. Swapping in a real provider means
 * draining this table rather than rewriting the callers.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    kind: text('kind').$type<'submission_receipt' | 'reconsent_invitation'>().notNull(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    /** Free text, not a foreign key: the record is erased before the mail is purged. */
    submissionRef: text('submission_ref'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('outbox_created_at_idx').on(t.createdAt)],
)

/**
 * Fixed-window rate limiting, per IP and per email. Kept in Postgres rather than
 * Redis so the app has one backing service in every environment; the volumes a
 * recruitment form sees are nowhere near needing anything faster.
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
})

/**
 * Uploads that have landed in storage. Because the file is uploaded before the
 * form is submitted, an abandoned application leaves a blob with no row in
 * `submissions` — the daily sweep uses this table to find and delete them.
 */
export const uploads = pgTable(
  'uploads',
  {
    path: text('path').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    filename: text('filename').notNull(),
    sizeKb: integer('size_kb').notNull(),
    /** Set when a submission claims this upload; unclaimed rows are sweepable. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [index('uploads_claimed_created_idx').on(t.claimedAt, t.createdAt)],
)

/** Convenience for the sweep queries. */
export const NOW = sql`now()`
