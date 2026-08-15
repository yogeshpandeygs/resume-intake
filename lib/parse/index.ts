import {
  EARLIEST_GRADUATION_YEAR,
  EXPERIENCE_SUMMARY_MAX_WORDS,
  type ParseMethod,
  type ResumeFormat,
} from '../domain/constants'
import { countWords, maxGraduationYear, normaliseSkills } from '../domain/fields'
import { anthropicApiKey } from '../env'
import { extractResumeText, OUTCOME_MESSAGES } from './extract'
import { extractFieldsHeuristically, isUsefulExtraction } from './heuristic'
import { ExtractionRefused, extractFieldsFromPdf, extractFieldsFromText, type ExtractedFields } from './llm'

export { resumeFormatFromFilename, CONTENT_TYPES } from './extract'

/** Values used to pre-fill the form. Everything is optional — the candidate confirms. */
export type Prefill = Partial<{
  firstName: string
  lastName: string
  email: string
  phone: string
  highestQualification: string
  graduationInstitution: string
  graduationYear: number
  postgraduationInstitution: string
  postgraduationYear: number
  doctoralInstitution: string
  doctoralYear: number
  currentLocation: string
  currentOrganisation: string
  designation: string
  currentRoleStartDate: string
  experienceSummary: string
  keySkills: string
}>

/** The success half of `ParseResult`, for helpers that cannot fail. */
export type ParseSuccess = {
  ok: true
  parseMethod: ParseMethod
  prefill: Prefill
  notice?: string
  extractionNotes?: string
}

export type ParseResult =
  | {
      ok: true
      parseMethod: ParseMethod
      prefill: Prefill
      /** Shown above the form when the file needed special handling. */
      notice?: string
      extractionNotes?: string
    }
  | {
      ok: false
      /** Specific, candidate-facing explanation naming the cause. */
      message: string
    }

/* ------------------------------------------------------------------ *
 * Cleaning the model's output
 * ------------------------------------------------------------------ */

function cleanString(value: string | null | undefined, maxLength = 300): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'null') return undefined
  return trimmed.slice(0, maxLength)
}

/**
 * Drop a year that falls outside the accepted range rather than pre-filling a
 * value the form will immediately reject. An empty field the candidate completes
 * is a better experience than a wrong one they have to notice and correct.
 */
function cleanYear(value: number | null | undefined, now: Date): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  if (value < EARLIEST_GRADUATION_YEAR || value > maxGraduationYear(now)) return undefined
  return value
}

function cleanDate(value: string | null | undefined): string | undefined {
  const text = cleanString(value, 10)
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined
  // Reject impossible dates that still match the shape, e.g. 2020-13-45.
  const parsed = new Date(`${text}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? undefined : text
}

/** Trim an over-long summary to the word limit rather than failing validation. */
function cleanSummary(value: string | null | undefined): string | undefined {
  const text = cleanString(value, 2000)
  if (!text) return undefined
  if (countWords(text) <= EXPERIENCE_SUMMARY_MAX_WORDS) return text
  return text.split(/\s+/).slice(0, EXPERIENCE_SUMMARY_MAX_WORDS).join(' ')
}

function toPrefill(fields: ExtractedFields, now: Date): Prefill {
  const skills = cleanString(fields.keySkills, 2000)
  return {
    firstName: cleanString(fields.firstName, 100),
    lastName: cleanString(fields.lastName, 100),
    email: cleanString(fields.email, 320)?.toLowerCase(),
    phone: cleanString(fields.phone, 50),
    highestQualification: cleanString(fields.highestQualification, 200),
    graduationInstitution: cleanString(fields.graduationInstitution),
    graduationYear: cleanYear(fields.graduationYear, now),
    postgraduationInstitution: cleanString(fields.postgraduationInstitution),
    postgraduationYear: cleanYear(fields.postgraduationYear, now),
    doctoralInstitution: cleanString(fields.doctoralInstitution),
    doctoralYear: cleanYear(fields.doctoralYear, now),
    currentLocation: cleanString(fields.currentLocation, 200),
    currentOrganisation: cleanString(fields.currentOrganisation),
    designation: cleanString(fields.designation, 200),
    currentRoleStartDate: cleanDate(fields.currentRoleStartDate),
    experienceSummary: cleanSummary(fields.experienceSummary),
    keySkills: skills ? normaliseSkills(skills) : undefined,
  }
}

/* ------------------------------------------------------------------ *
 * Orchestration
 * ------------------------------------------------------------------ */

/**
 * Run the full parse for one uploaded resume.
 *
 * Every path that fails to produce fields still lets the candidate proceed: the
 * file is already stored, and manual entry is a first-class outcome rather than an
 * error. The only hard failures are files we could not accept at all.
 */
export async function parseResume(
  data: Uint8Array,
  format: ResumeFormat,
  now: Date = new Date(),
  options: { knownInstitutions?: string[] } = {},
): Promise<ParseResult> {
  const extraction = await extractResumeText(data, format)

  if (extraction.kind === 'failed') {
    return { ok: false, message: extraction.reason }
  }

  if (extraction.kind === 'manual') {
    return {
      ok: true,
      parseMethod: 'manual',
      prefill: {},
      notice: OUTCOME_MESSAGES[extraction.reason],
    }
  }

  /**
   * Read the extracted text without a model. This is the answer whenever the LLM
   * is unavailable, and always runs first for text resumes because it costs
   * nothing — a resume it reads well needs no API call at all.
   */
  const readLocally = (): ParseSuccess | undefined => {
    if (extraction.kind !== 'text') return undefined
    const fields = extractFieldsHeuristically(extraction.text, {
      knownInstitutions: options.knownInstitutions,
      now,
    })
    if (!isUsefulExtraction(fields)) return undefined
    return {
      ok: true,
      parseMethod: 'text',
      prefill: toPrefill(fields, now),
      extractionNotes: cleanString(fields.extractionNotes, 500),
    }
  }

  // A scanned page has no text to work from, so vision is the only route and it
  // requires a key. Text resumes can always fall back to reading locally.
  const needsVision = extraction.kind === 'vision'

  if (!anthropicApiKey) {
    const local = readLocally()
    if (local) return local
    return {
      ok: true,
      parseMethod: 'manual',
      prefill: {},
      notice: needsVision
        ? 'This looks like a scanned resume, and reading scans is not configured. Please fill in the form below — your file has been saved and will be attached to your application.'
        : 'We could not read much from this file automatically. Please fill in the form below — your file has been saved and will be attached to your application.',
    }
  }

  try {
    if (extraction.kind === 'vision') {
      const fields = await extractFieldsFromPdf(data)
      return {
        ok: true,
        parseMethod: 'vision',
        prefill: toPrefill(fields, now),
        notice: OUTCOME_MESSAGES['scanned-pdf'],
        extractionNotes: cleanString(fields.extractionNotes, 500),
      }
    }

    const fields = await extractFieldsFromText(extraction.text)
    return {
      ok: true,
      parseMethod: 'text',
      prefill: toPrefill(fields, now),
      extractionNotes: cleanString(fields.extractionNotes, 500),
    }
  } catch (error) {
    if (!(error instanceof ExtractionRefused)) {
      console.error('Resume field extraction failed', error)
    }

    // A model outage or refusal must not cost the candidate their application.
    // Fall back to reading the text locally, and only then to manual entry.
    const local = readLocally()
    if (local) {
      return {
        ...local,
        notice:
          'We read your details from the text of your resume. Please check each field carefully.',
      }
    }

    return {
      ok: true,
      parseMethod: 'manual',
      prefill: {},
      notice:
        'Automatic reading is unavailable at the moment. Please fill in the form below — your file has been saved and will be attached to your application.',
    }
  }
}
