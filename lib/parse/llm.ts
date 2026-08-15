import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { anthropicModel, requireAnthropicApiKey } from '../env'

/**
 * Mapping resume text (or a scanned resume's pages) to the structured fields the
 * form pre-fills.
 *
 * Only the fields the PRD marks `parsed` are extracted here. Organisation
 * function, total years of experience and industry group are `selected` by the
 * candidate, and achievements are `typed` — asking the model to guess at those
 * would put words in the candidate's mouth on fields they are meant to own.
 */

/**
 * Every field is nullable so the model has an honest way to say "not in this
 * resume". Without that, a required field is an invitation to invent one.
 *
 * No min/max constraints: structured outputs does not support them, and the
 * values are validated properly by the form schema afterwards anyway.
 */
const extractedFieldsSchema = z.object({
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),

  highestQualification: z.string().nullable(),
  graduationInstitution: z.string().nullable(),
  graduationYear: z.number().int().nullable(),
  postgraduationInstitution: z.string().nullable(),
  postgraduationYear: z.number().int().nullable(),
  doctoralInstitution: z.string().nullable(),
  doctoralYear: z.number().int().nullable(),

  currentLocation: z.string().nullable(),
  currentOrganisation: z.string().nullable(),
  designation: z.string().nullable(),
  /** YYYY-MM-DD; the model is told to use the first of the month when only a month is given. */
  currentRoleStartDate: z.string().nullable(),

  experienceSummary: z.string().nullable(),
  /** Semicolon-separated, matching the storage format. */
  keySkills: z.string().nullable(),

  /** The model's own read on how much of the resume it could make sense of. */
  extractionNotes: z.string().nullable(),
})

export type ExtractedFields = z.infer<typeof extractedFieldsSchema>

const SYSTEM_PROMPT = `You extract structured details from candidate resumes for a recruitment intake form. The candidate reviews and corrects everything you return, so accuracy matters more than completeness.

Rules:
- Only report what the resume actually states. If a field is absent, return null. Never infer, guess, or fill a field from a typical value.
- Names: split the candidate's full name into first and last. If there is a single name, put it in firstName and return null for lastName.
- highestQualification: the most advanced degree named, as written (for example "B.Tech", "MBA", "PhD").
- Education institutions: return the institution for each level separately. Leave postgraduate and doctoral fields null unless the resume shows study at that level.
- Years of passing are four-digit years. If a resume shows a range, use the ending year.
- currentLocation: the candidate's own city or region, not an employer's head office.
- currentOrganisation and designation describe the present role. If the candidate is not currently employed, return null for both.
- currentRoleStartDate: format as YYYY-MM-DD. When only a month and year are given use the first of that month; when only a year is given use January 1st.
- experienceSummary: at most 100 words, written in plain prose, describing what this person does and has done. Do not add praise or adjectives the resume does not support.
- keySkills: the candidate's concrete skills and technologies, separated by semicolons. Skip generic traits like "team player" or "hard working".
- extractionNotes: briefly note anything you could not read or found ambiguous, or null if the resume was clear.`

let cachedClient: Anthropic | undefined

function client(): Anthropic {
  cachedClient ??= new Anthropic({ apiKey: requireAnthropicApiKey() })
  return cachedClient
}

export class ExtractionRefused extends Error {
  constructor() {
    super('The model declined to process this document')
    this.name = 'ExtractionRefused'
  }
}

/**
 * `max_tokens` bounds thinking *and* the response together, and thinking is on by
 * default on the current Opus models. A resume's worth of JSON is small, but the
 * budget has to leave room for the reasoning in front of it or the response
 * truncates mid-object.
 */
const MAX_TOKENS = 16_000

async function runExtraction(
  content: Anthropic.ContentBlockParam[],
  effort: 'low' | 'medium',
): Promise<ExtractedFields> {
  const message = await client().messages.parse({
    model: anthropicModel,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: {
      format: zodOutputFormat(extractedFieldsSchema),
      effort,
    },
    messages: [{ role: 'user', content }],
  })

  // A refusal returns HTTP 200 with an empty or partial body, so this has to be
  // checked before reading the parsed output. Vanishingly unlikely for a resume,
  // but the app already has a graceful answer: fall through to manual entry.
  if (message.stop_reason === 'refusal') {
    throw new ExtractionRefused()
  }

  if (!message.parsed_output) {
    throw new Error('Field extraction did not return a usable result')
  }

  return message.parsed_output
}

/** Extract fields from a resume that had a readable text layer. */
export async function extractFieldsFromText(text: string): Promise<ExtractedFields> {
  // Guard against a pathologically long resume blowing the context window.
  const bounded = text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[truncated]` : text

  return runExtraction(
    [
      {
        type: 'text',
        text: `Extract the candidate's details from this resume.\n\n<resume>\n${bounded}\n</resume>`,
      },
    ],
    'low',
  )
}

/**
 * Extract fields from a scanned, image-only PDF.
 *
 * The PDF is handed to Claude as a document block rather than being rasterised
 * here: the API renders the pages itself, which removes a native canvas
 * dependency that would not run on serverless anyway. Effort is raised a step
 * because reading a photocopied CV is harder than reading its text layer.
 */
export async function extractFieldsFromPdf(data: Uint8Array): Promise<ExtractedFields> {
  const base64 = Buffer.from(data).toString('base64')

  return runExtraction(
    [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      },
      {
        type: 'text',
        text: 'This resume is a scan with no text layer. Read the pages and extract the candidate\'s details.',
      },
    ],
    'medium',
  )
}
