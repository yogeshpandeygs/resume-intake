import { z } from 'zod'
import {
  ACHIEVEMENTS_MAX_WORDS,
  EARLIEST_GRADUATION_YEAR,
  EXPERIENCE_SUMMARY_MAX_WORDS,
  FRESHERS,
  INDUSTRY_GROUPS,
  ORGANISATION_FUNCTIONS,
  type ExperienceBand,
} from './constants'
import { istCivilDate } from './dates'

/* ------------------------------------------------------------------ *
 * Derived values
 * ------------------------------------------------------------------ */

/**
 * Experience band from total years of experience (PRD field 20).
 *
 * The PRD's bands are written as `0–3 / 3.1–10 / 10.1–15 / 15+`, which leaves the
 * boundaries between them unstated. Because the input is constrained to one decimal
 * place, no real value falls in the gaps, so we resolve them as:
 *
 *   <= 3.0  Early careers
 *   <= 10.0 Mid-career
 *   <= 15.0 Senior professionals
 *   >  15.0 Executive professionals
 *
 * Comparison is done in tenths to keep binary floating point out of it —
 * `3.1 * 10` is not exactly 31, but `Math.round(3.1 * 10)` is.
 */
export function experienceBand(totalYears: number): ExperienceBand {
  const tenths = Math.round(totalYears * 10)
  if (tenths <= 30) return 'Early careers'
  if (tenths <= 100) return 'Mid-career'
  if (tenths <= 150) return 'Senior professionals'
  return 'Executive professionals'
}

/** `SUB-YYYY-NNNNNN`, e.g. `SUB-2026-000417`. */
export function formatSubmissionId(year: number, sequence: number): string {
  return `SUB-${year}-${String(sequence).padStart(6, '0')}`
}

export const SUBMISSION_ID_PATTERN = /^SUB-\d{4}-\d{6}$/

/* ------------------------------------------------------------------ *
 * Normalisation (duplicate detection)
 * ------------------------------------------------------------------ */

/**
 * Fold accents and diacritics: `Ramírez` -> `ramirez`.
 * NFD splits a letter into base + combining mark, then we drop the marks.
 */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Email key for duplicate matching: lowercased and trimmed. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Name key for duplicate matching: lowercased, trimmed, accents folded, and
 * internal runs of whitespace collapsed so `De  Souza` matches `de souza`.
 */
export function normaliseName(name: string): string {
  return foldAccents(name.trim().toLowerCase()).replace(/\s+/g, ' ')
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export function countWords(value: string): number {
  const trimmed = value.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * A text field bounded by both a character limit (so the column can't be abused)
 * and a word limit (the PRD's actual constraint on summaries).
 */
const boundedText = (opts: {
  label: string
  words: number
  chars: number
  required: boolean
}) => {
  const base = z
    .string()
    .trim()
    .max(opts.chars, `${opts.label} is too long`)
    .refine((v) => countWords(v) <= opts.words, {
      message: `${opts.label} must be ${opts.words} words or fewer`,
    })
  return opts.required
    ? base.refine((v) => v.length > 0, { message: `${opts.label} is required` })
    : base
}

/** Upper bound on year-of-passing fields: allows for candidates graduating next year. */
export function maxGraduationYear(now: Date = new Date()): number {
  return istCivilDate(now).year + 1
}

const yearOfPassing = (now: Date) =>
  z
    .number()
    .int()
    .min(EARLIEST_GRADUATION_YEAR, `Year must be ${EARLIEST_GRADUATION_YEAR} or later`)
    .max(maxGraduationYear(now), `Year cannot be later than ${maxGraduationYear(now)}`)

/**
 * Phone numbers arrive from resumes in every imaginable shape. We keep the
 * candidate's text (E.164 is "preferred", not required) but insist on enough
 * digits to be a real number.
 */
const phone = z
  .string()
  .trim()
  .min(1, 'Phone number is required')
  .refine((v) => (v.match(/\d/g) ?? []).length >= 8, {
    message: 'Phone number does not have enough digits',
  })

const requiredText = (label: string, max = 300) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`)

const optionalText = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v))

/**
 * The candidate-supplied half of a submission: everything the form posts.
 * System and derived fields (submission id, timestamps, parse method, retention)
 * are added server-side and are deliberately not accepted from the client.
 */
export function submissionInputSchema(now: Date = new Date()) {
  const year = yearOfPassing(now)

  return z
    .object({
      firstName: requiredText('First name', 100),
      lastName: requiredText('Last name', 100),
      email: z.email('Enter a valid email address').trim().toLowerCase(),
      phone,

      highestQualification: requiredText('Highest qualification', 200),
      graduationInstitution: requiredText('Graduation institution'),
      graduationYear: year,
      postgraduationInstitution: optionalText(),
      postgraduationYear: year.optional(),
      doctoralInstitution: optionalText(),
      doctoralYear: year.optional(),

      currentLocation: requiredText('Current location', 200),
      currentOrganisation: optionalText(),
      designation: optionalText(200),
      currentRoleStartDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
        .optional()
        .or(z.literal('').transform(() => undefined)),

      organisationFunction: z.enum(ORGANISATION_FUNCTIONS),
      totalYearsExperience: z
        .number()
        .min(0, 'Experience cannot be negative')
        .max(60, 'Experience looks too high')
        // One decimal place, per the PRD.
        .transform((v) => Math.round(v * 10) / 10),
      industryGroup: z.enum(INDUSTRY_GROUPS),

      experienceSummary: boundedText({
        label: 'Experience summary',
        words: EXPERIENCE_SUMMARY_MAX_WORDS,
        chars: 2000,
        required: true,
      }),
      keySkills: requiredText('Key skills', 2000),
      achievementsCertifications: boundedText({
        label: 'Achievements and certifications',
        words: ACHIEVEMENTS_MAX_WORDS,
        chars: 4000,
        required: false,
      })
        .optional()
        .transform((v) => (v === '' ? undefined : v)),

      consent: z.literal(true, {
        error: () => 'You must consent before submitting',
      }),
    })
    .superRefine((value, ctx) => {
      // Year of passing is required once an institution is named (PRD 11, 13).
      if (value.postgraduationInstitution && value.postgraduationYear === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['postgraduationYear'],
          message: 'Add the post-graduation year of passing',
        })
      }
      if (value.doctoralInstitution && value.doctoralYear === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['doctoralYear'],
          message: 'Add the doctoral year of passing',
        })
      }

      // Employment details are required for everyone except Freshers (PRD 15-17).
      if (value.organisationFunction !== FRESHERS) {
        const required = [
          ['currentOrganisation', value.currentOrganisation, 'Current organisation'],
          ['designation', value.designation, 'Designation'],
          ['currentRoleStartDate', value.currentRoleStartDate, 'Start date of current role'],
        ] as const
        for (const [path, present, label] of required) {
          if (!present) {
            ctx.addIssue({
              code: 'custom',
              path: [path],
              message: `${label} is required unless you select ${FRESHERS}`,
            })
          }
        }
      }
    })
}

export type SubmissionInput = z.infer<ReturnType<typeof submissionInputSchema>>

/** Skills are stored as a semicolon-separated string; this is the canonical tidy-up. */
export function normaliseSkills(raw: string): string {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('; ')
}
