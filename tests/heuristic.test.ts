import { describe, expect, it } from 'vitest'
import {
  extractCurrentRole,
  extractEducation,
  extractFieldsHeuristically,
  isUsefulExtraction,
  splitSections,
} from '../lib/parse/heuristic'

/**
 * The extractor is tested against several deliberately different resume layouts.
 * Testing only against the sample fixture would fit the parser to one shape and
 * tell us nothing about the resumes candidates actually send.
 */

const NOW = new Date('2026-08-15T00:00:00Z')
const KNOWN = [
  'Indian Institute of Technology Bombay',
  'Indian Institute of Management Bangalore',
  'Anna University',
  'Delhi Technological University',
]

const read = (text: string) =>
  extractFieldsHeuristically(text, { knownInstitutions: KNOWN, now: NOW })

/* ------------------------------------------------------------------ */

/** Conventional layout: contact block, headed sections, dashes between fields. */
const CONVENTIONAL = `Priya Sharma
Bengaluru, Karnataka, India
priya.sharma@example.com | +91 98765 43210

SUMMARY
Data engineer with eight years building large scale data platforms.

EXPERIENCE
Acme Analytics, Bengaluru - Senior Data Engineer, April 2022 to present
Runs the streaming ingestion pipeline.

EDUCATION
Indian Institute of Management Bangalore - MBA, 2021
Indian Institute of Technology Bombay - B.Tech Computer Science, 2016

SKILLS
Python, SQL, Apache Airflow, Kafka`

/** Sparser layout: no summary, uppercase name, education across two lines. */
const TWO_LINE_EDUCATION = `RAHUL VERMA
rahul.verma@example.in
+91 90000 11111
Chennai

PROFESSIONAL EXPERIENCE
Zenith Systems
Software Engineer
Jun 2021 - Present

ACADEMIC QUALIFICATIONS
B.E Electronics and Communication
Anna University, 2020

TECHNICAL SKILLS
Java; Spring Boot; PostgreSQL; team player`

/** A fresher: no employment history at all. */
const FRESHER = `Ananya Iyer
ananya.iyer@example.com
Mobile: 9876501234
Coimbatore, Tamil Nadu

OBJECTIVE
Final year student seeking a graduate role in analytics.

EDUCATION
Delhi Technological University
B.Sc Statistics, 2022 - 2026

SKILLS
R, Python, Excel`

/** Doctoral candidate, three levels of education. */
const DOCTORAL = `Dr. Meera Krishnan
meera.k@example.org
+91 80 4567 8900
Hyderabad

EXPERIENCE
Globex Pharma - Director of Research, January 2019 to present

EDUCATION
PhD Medicinal Chemistry, Indian Institute of Technology Bombay, 2013
M.Sc Chemistry, Anna University, 2008
B.Sc Chemistry, Anna University, 2006`

/* ------------------------------------------------------------------ */

describe('contact details', () => {
  it('reads name, email and phone from a conventional layout', () => {
    const f = read(CONVENTIONAL)
    expect(f.firstName).toBe('Priya')
    expect(f.lastName).toBe('Sharma')
    expect(f.email).toBe('priya.sharma@example.com')
    expect(f.phone).toBe('+91 98765 43210')
  })

  it('reads an uppercase name', () => {
    const f = read(TWO_LINE_EDUCATION)
    expect(f.firstName).toBe('RAHUL')
    expect(f.lastName).toBe('VERMA')
  })

  it('reads a labelled phone number', () => {
    expect(read(FRESHER).phone).toContain('9876501234')
  })

  it('reads a phone number written with an area code', () => {
    expect(read(DOCTORAL).phone).toBe('+91 80 4567 8900')
  })

  it('does not mistake a year for a phone number', () => {
    const f = read('Someone Here\nsomeone@example.com\n\nEDUCATION\nAnna University, 2016')
    expect(f.phone).toBeNull()
  })

  it('lowercases the email', () => {
    expect(read('A Person\nA.Person@Example.COM\n').email).toBe('a.person@example.com')
  })

  it('does not treat a heading as a name', () => {
    const f = read('CURRICULUM VITAE\nasha@example.com\n')
    expect(f.firstName).toBeNull()
  })
})

describe('location', () => {
  it('keeps a full city, state and country line', () => {
    expect(read(CONVENTIONAL).currentLocation).toBe('Bengaluru, Karnataka, India')
  })

  it('reads a bare city', () => {
    expect(read(TWO_LINE_EDUCATION).currentLocation).toBe('Chennai')
  })

  it('prefers an explicit label over a guess', () => {
    const f = read('A Person\na@example.com\nMumbai\n\nCurrent Location: Pune, Maharashtra\n')
    expect(f.currentLocation).toBe('Pune, Maharashtra')
  })
})

describe('education', () => {
  it('assigns graduate and postgraduate entries to the right levels', () => {
    const f = read(CONVENTIONAL)
    expect(f.graduationInstitution).toBe('Indian Institute of Technology Bombay')
    expect(f.graduationYear).toBe(2016)
    expect(f.postgraduationInstitution).toBe('Indian Institute of Management Bangalore')
    expect(f.postgraduationYear).toBe(2021)
  })

  it('reports the most advanced degree as the highest qualification', () => {
    expect(read(CONVENTIONAL).highestQualification).toBe('MBA')
    expect(read(DOCTORAL).highestQualification).toMatch(/phd/i)
    expect(read(FRESHER).highestQualification).toMatch(/b\.?\s?sc/i)
  })

  it('pairs a degree with an institution written on the next line', () => {
    const f = read(TWO_LINE_EDUCATION)
    expect(f.graduationInstitution).toBe('Anna University')
    expect(f.graduationYear).toBe(2020)
  })

  it('takes the end of a year range as the year of passing', () => {
    // "2022 - 2026" is a course duration; the candidate passes in 2026.
    expect(read(FRESHER).graduationYear).toBe(2026)
  })

  it('fills all three levels when present', () => {
    const f = read(DOCTORAL)
    expect(f.doctoralInstitution).toBe('Indian Institute of Technology Bombay')
    expect(f.doctoralYear).toBe(2013)
    expect(f.postgraduationYear).toBe(2008)
    expect(f.graduationYear).toBe(2006)
  })

  it('leaves optional levels null when the candidate has only a first degree', () => {
    const f = read(FRESHER)
    expect(f.postgraduationInstitution).toBeNull()
    expect(f.doctoralInstitution).toBeNull()
  })

  it('recognises an institution outside the seeded list', () => {
    const entries = extractEducation(
      splitSections('EDUCATION\nB.Tech, Vellore Institute of Technology, 2019'),
      [],
      NOW,
    )
    expect(entries[0]?.institution).toContain('Vellore Institute of Technology')
  })

  it('ignores a year outside the accepted range', () => {
    const entries = extractEducation(
      splitSections('EDUCATION\nB.Tech, Anna University, 1872'),
      KNOWN,
      NOW,
    )
    expect(entries[0]?.year).toBeUndefined()
  })
})

describe('current role', () => {
  it('reads organisation, designation and start date from one line', () => {
    const f = read(CONVENTIONAL)
    expect(f.currentOrganisation).toBe('Acme Analytics')
    expect(f.designation).toBe('Senior Data Engineer')
    expect(f.currentRoleStartDate).toBe('2022-04-01')
  })

  it('reads a role split across lines', () => {
    const f = read(TWO_LINE_EDUCATION)
    expect(f.currentOrganisation).toBe('Zenith Systems')
    expect(f.designation).toBe('Software Engineer')
    expect(f.currentRoleStartDate).toBe('2021-06-01')
  })

  it('leaves employment blank for a candidate with no current role', () => {
    const f = read(FRESHER)
    expect(f.currentOrganisation).toBeNull()
    expect(f.designation).toBeNull()
    expect(f.currentRoleStartDate).toBeNull()
  })

  it('ignores a past role that has already ended', () => {
    const role = extractCurrentRole(
      splitSections('EXPERIENCE\nOld Corp - Analyst, Jan 2015 to Dec 2018'),
    )
    expect(role.organisation).toBeUndefined()
  })

  it('defaults to January when only a year is given', () => {
    const role = extractCurrentRole(
      splitSections('EXPERIENCE\nAcme Ltd - Engineer, 2023 - Present'),
    )
    expect(role.startDate).toBe('2023-01-01')
  })
})

describe('summary and skills', () => {
  it('reads the summary section', () => {
    expect(read(CONVENTIONAL).experienceSummary).toContain('Data engineer with eight years')
  })

  it('caps the summary at the 100-word limit', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const f = read(`A Person\na@example.com\n\nSUMMARY\n${long}`)
    expect(f.experienceSummary!.split(/\s+/).length).toBeLessThanOrEqual(100)
  })

  it('returns skills separated by semicolons, as the field expects', () => {
    expect(read(CONVENTIONAL).keySkills).toBe('Python; SQL; Apache Airflow; Kafka')
  })

  it('drops generic traits that are not skills', () => {
    expect(read(TWO_LINE_EDUCATION).keySkills).not.toMatch(/team player/i)
    expect(read(TWO_LINE_EDUCATION).keySkills).toContain('Java')
  })

  it('de-duplicates repeated skills', () => {
    const f = read('A Person\na@example.com\n\nSKILLS\nPython, python, SQL, Python')
    expect(f.keySkills!.split('; ')).toHaveLength(2)
  })
})

describe('usefulness gate', () => {
  it('accepts an extraction with several fields found', () => {
    expect(isUsefulExtraction(read(CONVENTIONAL))).toBe(true)
    expect(isUsefulExtraction(read(FRESHER))).toBe(true)
  })

  it('rejects text that is not a resume', () => {
    const f = read('This document intentionally left blank.')
    expect(isUsefulExtraction(f)).toBe(false)
  })

  it('explains what it found, so the candidate knows what to check', () => {
    expect(read(CONVENTIONAL).extractionNotes).toMatch(/check/i)
  })
})

describe('section splitting', () => {
  it('groups lines under their heading', () => {
    const sections = splitSections(CONVENTIONAL)
    expect(sections.header).toContain('Priya Sharma')
    expect(sections.education?.join(' ')).toContain('B.Tech')
    expect(sections.skills?.join(' ')).toContain('Python')
  })

  it('recognises headings under alternative names', () => {
    const sections = splitSections('PROFILE\nSomething\n\nACADEMICS\nB.Tech, 2016')
    expect(sections.summary).toEqual(['Something'])
    expect(sections.education).toEqual(['B.Tech, 2016'])
  })

  it('does not treat a long prose line as a heading', () => {
    const sections = splitSections(
      'SUMMARY\nExperience across education technology and analytics for over a decade in India.',
    )
    expect(sections.education).toBeUndefined()
    expect(sections.summary).toHaveLength(1)
  })
})
