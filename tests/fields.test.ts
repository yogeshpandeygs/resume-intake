import { describe, expect, it } from 'vitest'
import {
  countWords,
  experienceBand,
  formatSubmissionId,
  normaliseEmail,
  normaliseName,
  normaliseSkills,
  submissionInputSchema,
  SUBMISSION_ID_PATTERN,
} from '../lib/domain/fields'

describe('experienceBand', () => {
  // The PRD's bands leave their boundaries unstated; these pin down the
  // resolution documented in fields.ts so it can't drift silently.
  it.each([
    [0, 'Early careers'],
    [1.5, 'Early careers'],
    [3.0, 'Early careers'],
    [3.1, 'Mid-career'],
    [7.5, 'Mid-career'],
    [10.0, 'Mid-career'],
    [10.1, 'Senior professionals'],
    [15.0, 'Senior professionals'],
    [15.1, 'Executive professionals'],
    [32.4, 'Executive professionals'],
  ])('%s years -> %s', (years, band) => {
    expect(experienceBand(years)).toBe(band)
  })

  it('is not fooled by binary floating point at the boundaries', () => {
    // 0.1 + 3 is 3.1000000000000005; a naive `> 3` comparison gets this wrong.
    expect(experienceBand(0.1 + 3)).toBe('Mid-career')
    expect(experienceBand(10.1)).toBe('Senior professionals')
  })
})

describe('submission id', () => {
  it('formats as SUB-YYYY-NNNNNN', () => {
    expect(formatSubmissionId(2026, 417)).toBe('SUB-2026-000417')
    expect(formatSubmissionId(2026, 1)).toBe('SUB-2026-000001')
    expect(formatSubmissionId(2026, 999999)).toBe('SUB-2026-999999')
  })

  it('matches the documented pattern', () => {
    expect(SUBMISSION_ID_PATTERN.test(formatSubmissionId(2026, 42))).toBe(true)
  })
})

describe('normalisation', () => {
  it('lowercases and trims email', () => {
    expect(normaliseEmail('  Priya.Sharma@Example.COM ')).toBe('priya.sharma@example.com')
  })

  it('folds accents in names', () => {
    expect(normaliseName('Ramírez')).toBe('ramirez')
    expect(normaliseName('José')).toBe('jose')
    expect(normaliseName('Ångström')).toBe('angstrom')
  })

  it('collapses internal whitespace so spacing variants match', () => {
    expect(normaliseName('De  Souza')).toBe(normaliseName('de souza'))
    expect(normaliseName('  Van Der Berg ')).toBe('van der berg')
  })

  it('makes accented and unaccented spellings of the same name collide', () => {
    expect(normaliseName('Ramírez')).toBe(normaliseName('RAMIREZ'))
  })

  it('tidies semicolon-separated skills', () => {
    expect(normaliseSkills('Python ;; SQL;  Airflow ;')).toBe('Python; SQL; Airflow')
  })
})

describe('countWords', () => {
  it('counts words, not characters', () => {
    expect(countWords('one two three')).toBe(3)
    expect(countWords('  spaced   out  ')).toBe(2)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })
})

/* ------------------------------------------------------------------ */

const NOW = new Date('2026-08-15T12:00:00Z')

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Priya',
    lastName: 'Sharma',
    email: 'priya@example.com',
    phone: '+91 98765 43210',
    highestQualification: 'B.Tech',
    graduationInstitution: 'IIT Bombay',
    graduationYear: 2016,
    currentLocation: 'Bengaluru',
    currentOrganisation: 'Acme Corp',
    designation: 'Senior Engineer',
    currentRoleStartDate: '2022-04-01',
    organisationFunction: 'Operations',
    totalYearsExperience: 8.5,
    industryGroup: 'IT',
    experienceSummary: 'Eight years building data platforms.',
    keySkills: 'Python; SQL',
    consent: true,
    ...overrides,
  }
}

describe('submissionInputSchema', () => {
  const schema = submissionInputSchema(NOW)

  it('accepts a complete submission', () => {
    const result = schema.safeParse(validInput())
    expect(result.success).toBe(true)
  })

  it('blocks submission when consent is not given', () => {
    const result = schema.safeParse(validInput({ consent: false }))
    expect(result.success).toBe(false)
  })

  it('requires employment fields for non-Freshers', () => {
    const result = schema.safeParse(
      validInput({ currentOrganisation: '', designation: '', currentRoleStartDate: '' }),
    )
    expect(result.success).toBe(false)
    const paths = result.error!.issues.map((i) => i.path.join('.'))
    expect(paths).toContain('currentOrganisation')
    expect(paths).toContain('designation')
    expect(paths).toContain('currentRoleStartDate')
  })

  it('waives employment fields for Freshers', () => {
    const result = schema.safeParse(
      validInput({
        organisationFunction: 'Freshers',
        currentOrganisation: '',
        designation: '',
        currentRoleStartDate: '',
        totalYearsExperience: 0,
      }),
    )
    expect(result.success).toBe(true)
  })

  it('requires a post-graduation year once an institution is named', () => {
    const result = schema.safeParse(validInput({ postgraduationInstitution: 'IIM Ahmedabad' }))
    expect(result.success).toBe(false)
    expect(result.error!.issues.map((i) => i.path.join('.'))).toContain('postgraduationYear')
  })

  it('requires a doctoral year once an institution is named', () => {
    const result = schema.safeParse(validInput({ doctoralInstitution: 'IISc' }))
    expect(result.success).toBe(false)
    expect(result.error!.issues.map((i) => i.path.join('.'))).toContain('doctoralYear')
  })

  it('accepts optional education blocks left empty', () => {
    const result = schema.safeParse(
      validInput({ postgraduationInstitution: '', doctoralInstitution: '' }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects years outside 1960 - (current + 1)', () => {
    expect(schema.safeParse(validInput({ graduationYear: 1959 })).success).toBe(false)
    expect(schema.safeParse(validInput({ graduationYear: 2028 })).success).toBe(false)
    expect(schema.safeParse(validInput({ graduationYear: 2027 })).success).toBe(true)
  })

  it('enforces the 100-word cap on the experience summary', () => {
    const long = Array.from({ length: 101 }, (_, i) => `word${i}`).join(' ')
    expect(schema.safeParse(validInput({ experienceSummary: long })).success).toBe(false)

    const atLimit = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
    expect(schema.safeParse(validInput({ experienceSummary: atLimit })).success).toBe(true)
  })

  it('enforces the 200-word cap on achievements', () => {
    const long = Array.from({ length: 201 }, (_, i) => `word${i}`).join(' ')
    expect(schema.safeParse(validInput({ achievementsCertifications: long })).success).toBe(false)
  })

  it('rounds experience to one decimal place', () => {
    const result = schema.safeParse(validInput({ totalYearsExperience: 8.47 }))
    expect(result.success).toBe(true)
    expect(result.data!.totalYearsExperience).toBe(8.5)
  })

  it('rejects a phone number without enough digits', () => {
    expect(schema.safeParse(validInput({ phone: '12345' })).success).toBe(false)
  })

  it('rejects a malformed email', () => {
    expect(schema.safeParse(validInput({ email: 'not-an-email' })).success).toBe(false)
  })

  it('lowercases the email it returns', () => {
    const result = schema.safeParse(validInput({ email: 'Priya.Sharma@Example.COM' }))
    expect(result.data!.email).toBe('priya.sharma@example.com')
  })
})
