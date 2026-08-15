import { EARLIEST_GRADUATION_YEAR, EXPERIENCE_SUMMARY_MAX_WORDS } from '../domain/constants'
import { normaliseName } from '../domain/fields'
import type { ExtractedFields } from './llm'

/**
 * Reading a resume without a language model.
 *
 * The LLM extractor gives the best results, but it needs an API key and it costs
 * money per resume. This does the same job from patterns and structure, so the
 * form still fills itself in when no key is configured and when a call fails.
 *
 * It is deliberately conservative: a field is only reported when the evidence is
 * clear. A blank box the candidate fills in is a much better experience than a
 * confidently wrong one they have to notice and correct — and every value here is
 * shown to the candidate for confirmation before anything is stored.
 */

/* ------------------------------------------------------------------ *
 * Section splitting
 * ------------------------------------------------------------------ */

/** Headings seen on real resumes, grouped by the section they introduce. */
const SECTION_PATTERNS: Record<string, RegExp> = {
  summary: /^(summary|profile|professional summary|career summary|objective|about( me)?)\b/i,
  experience: /^(experience|work experience|professional experience|employment( history)?|career history)\b/i,
  education: /^(education|academic|academics|qualifications?|academic qualifications?)\b/i,
  skills: /^(skills|key skills|technical skills|core competenc(y|ies)|technologies)\b/i,
  certifications: /^(certifications?|licenses?|awards?|achievements?)\b/i,
}

export type ResumeSections = Partial<Record<keyof typeof SECTION_PATTERNS, string[]>> & {
  /** Everything before the first recognised heading — usually the contact block. */
  header: string[]
}

/**
 * Split the resume into sections keyed by heading. A heading is a short line that
 * matches one of the patterns above; everything until the next heading belongs to
 * it.
 */
export function splitSections(text: string): ResumeSections {
  const lines = text.split('\n').map((line) => line.trim())
  const sections: ResumeSections = { header: [] }
  let current: keyof ResumeSections = 'header'

  for (const line of lines) {
    if (line === '') continue

    // Headings are short. A long line beginning with "Education..." is prose.
    const heading =
      line.length <= 60
        ? (Object.keys(SECTION_PATTERNS) as (keyof typeof SECTION_PATTERNS)[]).find((name) =>
            SECTION_PATTERNS[name]!.test(line),
          )
        : undefined

    if (heading) {
      current = heading
      sections[current] ??= []
      continue
    }

    sections[current] ??= []
    sections[current]!.push(line)
  }

  return sections
}

/* ------------------------------------------------------------------ *
 * Contact details
 * ------------------------------------------------------------------ */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

/**
 * Phone numbers, in the shapes resumes actually use: `+91 98765 43210`,
 * `(080) 4567-8900`, `98765 43210`. Requires either a leading `+` or at least
 * eight digits, so years and postcodes are not mistaken for numbers.
 */
const PHONE_PATTERN = /(\+\d[\d\s().-]{7,17}\d)|(\b\d[\d\s().-]{8,16}\d\b)/

function extractEmail(text: string): string | null {
  return text.match(EMAIL_PATTERN)?.[0]?.toLowerCase() ?? null
}

function extractPhone(text: string): string | null {
  // Search line by line so a match cannot run across a line break and swallow
  // unrelated digits.
  for (const line of text.split('\n')) {
    const candidate = line.match(PHONE_PATTERN)?.[0]?.trim()
    if (!candidate) continue
    const digits = (candidate.match(/\d/g) ?? []).length
    if (digits >= 8 && digits <= 15) {
      return candidate.replace(/\s{2,}/g, ' ')
    }
  }
  return null
}

const NON_NAME_WORDS =
  /\b(resume|curriculum|vitae|cv|profile|address|phone|email|mobile|contact|linkedin|github)\b/i

/**
 * The candidate's name, taken from the contact block at the top.
 *
 * Looks for the first short line of two to four alphabetic words that is not an
 * address, a heading or a contact detail. This is where resumes almost always put
 * the name.
 */
function extractName(headerLines: string[]): { first: string | null; last: string | null } {
  for (const line of headerLines.slice(0, 6)) {
    if (line.includes('@') || /\d/.test(line) || NON_NAME_WORDS.test(line)) continue

    // Strip common decorations, then require plain words.
    const cleaned = line.replace(/[|,·•—–-]+/g, ' ').replace(/\s+/g, ' ').trim()
    const words = cleaned.split(' ').filter(Boolean)
    if (words.length < 2 || words.length > 4) continue
    if (!words.every((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word))) continue

    // A line in sentence case is more likely prose than a name.
    const looksLikeAName = words.every((word) => /^[A-Z]/.test(word)) || cleaned === cleaned.toUpperCase()
    if (!looksLikeAName) continue

    return { first: words[0]!, last: words.slice(1).join(' ') }
  }
  return { first: null, last: null }
}

/** Cities that appear often enough in Indian resumes to be worth matching directly. */
const CITIES = [
  'Bengaluru', 'Bangalore', 'Mumbai', 'Delhi', 'New Delhi', 'Gurugram', 'Gurgaon',
  'Noida', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad', 'Jaipur',
  'Chandigarh', 'Kochi', 'Cochin', 'Thiruvananthapuram', 'Coimbatore', 'Indore',
  'Bhopal', 'Nagpur', 'Lucknow', 'Kanpur', 'Patna', 'Bhubaneswar', 'Guwahati',
  'Visakhapatnam', 'Vadodara', 'Surat', 'Mysuru', 'Mysore', 'Mangaluru',
  'Trivandrum', 'Faridabad', 'Ghaziabad', 'Dehradun', 'Raipur', 'Ranchi',
]

/**
 * Current location, preferred from an explicit `Location:` label, otherwise from
 * a recognised city in the contact block.
 */
function extractLocation(text: string, headerLines: string[]): string | null {
  const labelled = text.match(/^\s*(?:current\s+)?location\s*[:\-]\s*(.+)$/im)?.[1]?.trim()
  if (labelled) return labelled.slice(0, 200)

  for (const line of headerLines.slice(0, 6)) {
    if (line.includes('@')) continue
    const city = CITIES.find((name) => new RegExp(`\\b${name}\\b`, 'i').test(line))
    if (city) {
      // Keep the whole line when it reads like "Bengaluru, Karnataka, India".
      return /^[\w\s,.'-]{3,80}$/.test(line) ? line.replace(/\s+/g, ' ') : city
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Education
 * ------------------------------------------------------------------ */

const DEGREE_LEVELS = [
  { level: 'doctoral' as const, pattern: /\b(ph\.?\s?d|d\.?phil|doctorate|doctoral)\b/i },
  {
    level: 'postgraduate' as const,
    pattern:
      /\b(m\.?\s?tech|m\.?\s?e\b|m\.?\s?sc|m\.?\s?s\b|m\.?\s?a\b|m\.?\s?com|mba|pgdm|pgp\b|ll\.?m|master'?s?)\b/i,
  },
  {
    level: 'graduate' as const,
    pattern:
      /\b(b\.?\s?tech|b\.?\s?e\b|b\.?\s?sc|b\.?\s?a\b|b\.?\s?com|bba|bca|ll\.?b|mbbs|b\.?\s?arch|bachelor'?s?)\b/i,
  },
]

type DegreeLevel = 'doctoral' | 'postgraduate' | 'graduate'

/** The degree token as written, e.g. `B.Tech`, so the candidate sees their own wording. */
function degreeMention(line: string): { level: DegreeLevel; text: string } | undefined {
  for (const { level, pattern } of DEGREE_LEVELS) {
    const match = line.match(pattern)
    if (match) return { level, text: match[0].trim() }
  }
  return undefined
}

function plausibleYear(value: string, now: Date): number | undefined {
  const year = Number.parseInt(value, 10)
  const max = now.getFullYear() + 1
  return year >= EARLIEST_GRADUATION_YEAR && year <= max ? year : undefined
}

/** The last plausible year on a line — resumes write ranges as "2012 - 2016". */
function lastYearOnLine(line: string, now: Date): number | undefined {
  const years = [...line.matchAll(/\b(19|20)\d{2}\b/g)]
    .map((m) => plausibleYear(m[0], now))
    .filter((y): y is number => y !== undefined)
  return years.length > 0 ? years[years.length - 1] : undefined
}

/**
 * Find an institution on a line: first by matching the seeded reference list,
 * then by the naming patterns institutions follow.
 */
function institutionOnLine(line: string, known: string[]): string | undefined {
  // Longest first, so "Indian Institute of Technology Bombay" wins over a
  // shorter list entry that is a prefix of it.
  for (const name of known) {
    if (line.toLowerCase().includes(name.toLowerCase())) return name
  }

  const pattern =
    /\b((?:[A-Z][\w.'&-]*\s+){0,6}(?:University|Institute|College|School|Academy|Polytechnic)(?:\s+of\s+[A-Z][\w.'&-]*(?:\s+[A-Z][\w.'&-]*){0,3})?)/
  const match = line.match(pattern)?.[1]?.trim()
  if (match && match.length >= 6 && match.length <= 120) return match

  return undefined
}

export interface EducationEntry {
  level: DegreeLevel
  institution?: string
  year?: number
  degreeText?: string
}

/**
 * Read the education section into one entry per level.
 *
 * An institution and a year on the same line belong together; when a line names a
 * degree but no institution, the nearest neighbouring line is used, because
 * resumes commonly split the two across a line break.
 */
export function extractEducation(
  sections: ResumeSections,
  known: string[],
  now: Date,
): EducationEntry[] {
  const lines = sections.education ?? []
  const entries: EducationEntry[] = []

  lines.forEach((line, index) => {
    const degree = degreeMention(line)
    if (!degree) return

    const neighbours = [line, lines[index + 1] ?? '', lines[index - 1] ?? '']
    const institution = neighbours.map((l) => institutionOnLine(l, known)).find(Boolean)
    const year = neighbours.map((l) => lastYearOnLine(l, now)).find((y) => y !== undefined)

    entries.push({ level: degree.level, institution, year, degreeText: degree.text })
  })

  // A resume that lists an institution without naming the degree still tells us
  // where they studied.
  if (entries.length === 0) {
    for (const line of lines) {
      const institution = institutionOnLine(line, known)
      if (institution) {
        entries.push({ level: 'graduate', institution, year: lastYearOnLine(line, now) })
        break
      }
    }
  }

  return entries
}

/* ------------------------------------------------------------------ *
 * Current role
 * ------------------------------------------------------------------ */

/**
 * A date range ending in "present", with an optional leading month:
 * `April 2022 to present`, `Jun 2021 - Present`, `2023 – Current`.
 *
 * The month group is wrapped so that the whole thing is optional. Written as
 * `(jan|...)[a-z]*?` the quantifier would apply only to the trailing letters and
 * the month would be mandatory, which silently loses every role written without
 * one.
 */
const CURRENT_ROLE_PATTERN =
  /(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*)?(\d{4})\s*(?:-|–|—|to|until)\s*(?:present|current|now|ongoing|to\s+date|date)\b/i

const MONTH_NUMBERS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

export interface CurrentRole {
  organisation?: string
  designation?: string
  startDate?: string
}

/** A line that could name an organisation or a job title — short and not a date. */
function isCandidateLine(line: string | undefined): line is string {
  return (
    typeof line === 'string' &&
    line.trim().length > 1 &&
    line.trim().length <= 100 &&
    !CURRENT_ROLE_PATTERN.test(line)
  )
}

/**
 * The present role, identified by a date range ending in "present".
 *
 * Covers the two layouts that account for most resumes:
 *
 *   Acme Analytics, Bengaluru - Senior Data Engineer, April 2022 to present
 *
 *   Zenith Systems
 *   Software Engineer
 *   Jun 2021 - Present
 *
 * In the second, the date stands alone and the two lines above it are the title
 * and the organisation, in that order going upwards.
 */
export function extractCurrentRole(sections: ResumeSections): CurrentRole {
  const lines = sections.experience ?? []

  for (const [index, line] of lines.entries()) {
    const match = line.match(CURRENT_ROLE_PATTERN)
    if (!match) continue

    const [, month, year] = match
    const monthNumber = month ? (MONTH_NUMBERS[month.slice(0, 3).toLowerCase()] ?? '01') : '01'
    const startDate = year ? `${year}-${monthNumber}-01` : undefined

    // Whatever the line says besides the dates.
    const remainder = line
      .replace(CURRENT_ROLE_PATTERN, '')
      .replace(/^[\s,;|–—-]+|[\s,;|–—-]+$/g, '')
      .trim()

    let organisation: string | undefined
    let designation: string | undefined

    if (remainder.length > 0) {
      const parts = remainder.split(/\s+[-–—|]\s+/).map((p) => p.replace(/[,;]\s*$/, '').trim())
      organisation = parts[0] || undefined
      designation = parts[1] || undefined

      // A line carrying only a job title: the organisation is above it.
      if (!designation && isCandidateLine(lines[index - 1])) {
        designation = organisation
        organisation = lines[index - 1]!.split(/\s+[-–—|]\s+/)[0]?.trim()
      }
    } else {
      // Date-only line: read upwards for title, then organisation.
      if (isCandidateLine(lines[index - 1])) designation = lines[index - 1]!.trim()
      if (isCandidateLine(lines[index - 2])) organisation = lines[index - 2]!.trim()

      // Only one line above: treat it as the organisation rather than guessing
      // a job title the resume never gave.
      if (organisation === undefined && designation !== undefined) {
        organisation = designation
        designation = undefined
      }
    }

    // Organisations are often written "Acme Analytics, Bengaluru".
    if (organisation) organisation = organisation.split(',')[0]!.trim()

    return {
      organisation: organisation?.slice(0, 200) || undefined,
      designation: designation?.slice(0, 200) || undefined,
      startDate,
    }
  }

  return {}
}

/* ------------------------------------------------------------------ *
 * Summary and skills
 * ------------------------------------------------------------------ */

function extractSummary(sections: ResumeSections): string | null {
  const lines = sections.summary ?? []
  if (lines.length === 0) return null

  const words = lines.join(' ').replace(/\s+/g, ' ').trim().split(' ')
  if (words.length === 0) return null
  return words.slice(0, EXPERIENCE_SUMMARY_MAX_WORDS).join(' ')
}

/** Traits rather than skills; they carry no signal for the hiring team. */
const SOFT_SKILL_NOISE =
  /^(team\s?(player|work)|hard\s?working|self\s?motivated|quick\s?learner|good\s+communication|leadership|problem\s?solving|detail\s?oriented)$/i

function extractSkills(sections: ResumeSections): string | null {
  const lines = sections.skills ?? []
  if (lines.length === 0) return null

  const skills = lines
    .join(', ')
    // Resumes separate skills with commas, semicolons, bullets or pipes.
    .split(/[,;•·|]|\s{2,}/)
    .map((skill) => skill.replace(/^[-–—*\s]+/, '').trim())
    .filter((skill) => skill.length >= 2 && skill.length <= 60)
    .filter((skill) => !SOFT_SKILL_NOISE.test(skill))
    // Drop a leading "Languages:"-style label.
    .map((skill) => skill.replace(/^[A-Za-z ]{3,20}:\s*/, '').trim())
    .filter(Boolean)

  const unique = [...new Map(skills.map((s) => [s.toLowerCase(), s])).values()]
  return unique.length > 0 ? unique.slice(0, 40).join('; ') : null
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

export interface HeuristicOptions {
  /** The seeded institution list, which makes institution matching far more reliable. */
  knownInstitutions?: string[]
  now?: Date
}

/**
 * Extract what can be read confidently from resume text.
 *
 * Returns the same shape as the LLM extractor so the two are interchangeable
 * downstream, with `null` for anything not found.
 */
export function extractFieldsHeuristically(
  text: string,
  options: HeuristicOptions = {},
): ExtractedFields {
  const now = options.now ?? new Date()
  // Longest first so the most specific institution name wins.
  const known = [...(options.knownInstitutions ?? [])].sort((a, b) => b.length - a.length)

  const sections = splitSections(text)
  const header = sections.header ?? []

  const name = extractName(header)
  const education = extractEducation(sections, known, now)
  const role = extractCurrentRole(sections)

  const byLevel = (level: DegreeLevel) => education.find((entry) => entry.level === level)
  const graduate = byLevel('graduate')
  const postgraduate = byLevel('postgraduate')
  const doctoral = byLevel('doctoral')

  // Highest qualification is the most advanced degree actually named.
  const highest = doctoral ?? postgraduate ?? graduate

  const found: string[] = []
  const note = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '') found.push(label)
    return value
  }

  const fields: ExtractedFields = {
    firstName: note('name', name.first) as string | null,
    lastName: name.last,
    email: note('email', extractEmail(text)) as string | null,
    phone: note('phone', extractPhone(text)) as string | null,

    highestQualification: note('qualification', highest?.degreeText ?? null) as string | null,
    graduationInstitution: note('education', graduate?.institution ?? null) as string | null,
    graduationYear: graduate?.year ?? null,
    postgraduationInstitution: postgraduate?.institution ?? null,
    postgraduationYear: postgraduate?.year ?? null,
    doctoralInstitution: doctoral?.institution ?? null,
    doctoralYear: doctoral?.year ?? null,

    currentLocation: note('location', extractLocation(text, header)) as string | null,
    currentOrganisation: note('employer', role.organisation ?? null) as string | null,
    designation: role.designation ?? null,
    currentRoleStartDate: role.startDate ?? null,

    experienceSummary: note('summary', extractSummary(sections)) as string | null,
    keySkills: note('skills', extractSkills(sections)) as string | null,

    extractionNotes:
      found.length > 0
        ? `Read automatically from your resume: ${found.join(', ')}. Please check each field.`
        : 'We could not read much from this file automatically — please fill in the details below.',
  }

  return fields
}

/** True when enough was found to be worth pre-filling the form. */
export function isUsefulExtraction(fields: ExtractedFields): boolean {
  const signals = [
    fields.email,
    fields.phone,
    fields.firstName,
    fields.graduationInstitution,
    fields.keySkills,
    fields.experienceSummary,
  ].filter(Boolean)
  return signals.length >= 2
}

/** Exported for tests: the normalisation used when comparing institution names. */
export const institutionKey = normaliseName
