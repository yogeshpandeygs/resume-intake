import { MIN_TEXT_LAYER_CHARS, RESUME_FORMATS, type ResumeFormat } from '../domain/constants'

/**
 * Turning an uploaded file into text, before any LLM is involved.
 *
 * Three inputs, three routes:
 *   - PDF with a text layer -> unpdf
 *   - .docx                 -> mammoth
 *   - .doc (legacy binary)  -> no route; the candidate fills the form manually
 *
 * A PDF that yields almost no text is a scan, and goes to the vision path rather
 * than being reported as a failure.
 */

export type ExtractionOutcome =
  /** Usable text; hand it to the LLM extractor. */
  | { kind: 'text'; text: string; pages?: number }
  /** Image-only PDF — let Claude read the document visually instead. */
  | { kind: 'vision'; reason: 'scanned-pdf' }
  /** No extraction route exists; fall back to manual entry with the file kept. */
  | { kind: 'manual'; reason: 'legacy-doc' | 'empty-docx' }
  /** Nothing worked and the candidate needs to be told why. */
  | { kind: 'failed'; reason: string }

export function resumeFormatFromFilename(filename: string): ResumeFormat | undefined {
  const ext = filename.toLowerCase().split('.').pop()
  return (RESUME_FORMATS as readonly string[]).includes(ext ?? '')
    ? (ext as ResumeFormat)
    : undefined
}

export const CONTENT_TYPES: Record<ResumeFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
}

/** Collapse the whitespace PDF extraction tends to scatter through the text. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractPdf(data: Uint8Array): Promise<ExtractionOutcome> {
  try {
    const { extractText } = await import('unpdf')
    const { text, totalPages } = await extractText(data, { mergePages: true })
    const tidied = tidy(Array.isArray(text) ? text.join('\n') : text)

    // A scanned CV still produces a handful of stray characters from embedded
    // fonts or metadata, so "almost nothing" rather than "nothing" is the signal.
    if (tidied.length < MIN_TEXT_LAYER_CHARS) {
      return { kind: 'vision', reason: 'scanned-pdf' }
    }
    return { kind: 'text', text: tidied, pages: totalPages }
  } catch (error) {
    // A PDF we cannot even open may still be readable as an image by Claude,
    // so this is not the end of the road.
    if (error instanceof Error && /password|encrypt/i.test(error.message)) {
      return {
        kind: 'failed',
        reason:
          'This PDF is password protected. Please remove the password and upload it again.',
      }
    }
    return { kind: 'vision', reason: 'scanned-pdf' }
  }
}

async function extractDocx(data: Uint8Array): Promise<ExtractionOutcome> {
  try {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(data) as unknown as Buffer,
    })
    const tidied = tidy(value)
    if (tidied.length < MIN_TEXT_LAYER_CHARS) {
      // A .docx holding only images has no second route: mammoth cannot render it
      // and there are no pages to show Claude.
      return { kind: 'manual', reason: 'empty-docx' }
    }
    return { kind: 'text', text: tidied }
  } catch {
    return {
      kind: 'failed',
      reason:
        'We could not read this Word file. It may be corrupted — try re-saving it as a PDF and uploading again.',
    }
  }
}

/**
 * Extract text from an uploaded resume.
 *
 * Legacy `.doc` is accepted and stored but never parsed: mammoth handles the
 * Open XML `.docx` format only, and the old OLE compound-document format has no
 * parser that runs on serverless. Rather than turn those candidates away, the file
 * is kept and the form is filled in by hand.
 */
export async function extractResumeText(
  data: Uint8Array,
  format: ResumeFormat,
): Promise<ExtractionOutcome> {
  switch (format) {
    case 'pdf':
      return extractPdf(data)
    case 'docx':
      return extractDocx(data)
    case 'doc':
      return { kind: 'manual', reason: 'legacy-doc' }
  }
}

/** Candidate-facing explanation for each non-text outcome. */
export const OUTCOME_MESSAGES: Record<string, string> = {
  'scanned-pdf':
    'This looks like a scanned resume, so we are reading it as an image. This can take a few seconds.',
  'legacy-doc':
    'We can store .doc files but cannot read them automatically. Please fill in the form below — your file has been saved and will be attached to your application.',
  'empty-docx':
    'We could not find any text in this document. Please fill in the form below — your file has been saved and will be attached to your application.',
}
