import { describe, expect, it } from 'vitest'
import { csvField, csvLines, csvRow, exportFilename, guardFormulaInjection, UTF8_BOM } from '../lib/csv'
import { EXPORT_COLUMNS } from '../lib/export-columns'

describe('formula injection guard', () => {
  // Candidate free text is untrusted; a spreadsheet evaluates these on open.
  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralises a leading %j', (trigger) => {
    const value = `${trigger}cmd|' /C calc'!A0`
    expect(guardFormulaInjection(value)).toBe(`'${value}`)
  })

  it('leaves ordinary text alone', () => {
    expect(guardFormulaInjection('Priya Sharma')).toBe('Priya Sharma')
    expect(guardFormulaInjection('')).toBe('')
  })

  it('only guards the leading character, not triggers inside the value', () => {
    expect(guardFormulaInjection('C++ and C-')).toBe('C++ and C-')
  })

  it('guards a negative number, which is the acceptable cost of the rule', () => {
    // -5 is indistinguishable from a formula to the guard; text is the safe reading.
    expect(guardFormulaInjection('-5')).toBe("'-5")
  })
})

describe('csvField', () => {
  it('renders null and undefined as empty', () => {
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })

  it('quotes values containing a comma', () => {
    expect(csvField('Bengaluru, Karnataka')).toBe('"Bengaluru, Karnataka"')
  })

  it('doubles embedded quotes', () => {
    expect(csvField('He said "hello"')).toBe('"He said ""hello"""')
  })

  it('quotes values containing newlines', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"')
  })

  it('quotes after applying the injection guard, not before', () => {
    // The guard adds a leading quote character; the value must still be wrapped
    // because it contains a comma.
    expect(csvField('=SUM(A1,A2)')).toBe(`"'=SUM(A1,A2)"`)
  })

  it('renders numbers without quoting', () => {
    expect(csvField(2016)).toBe('2016')
    expect(csvField(0)).toBe('0')
  })
})

describe('csvRow', () => {
  it('joins fields with commas', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c')
  })

  it('preserves empty columns so the row stays aligned', () => {
    expect(csvRow(['a', null, 'c'])).toBe('a,,c')
  })
})

describe('csvLines', () => {
  it('starts with a UTF-8 BOM so Excel on Windows reads accented names correctly', () => {
    const [first] = [...csvLines(['a'], [])]
    expect(first.startsWith(UTF8_BOM)).toBe(true)
  })

  it('emits the header then one line per row, CRLF terminated', () => {
    const out = [...csvLines(['x', 'y'], [[1, 2], [3, 4]])].join('')
    expect(out).toBe(`${UTF8_BOM}x,y\r\n1,2\r\n3,4\r\n`)
  })

  it('round-trips an accented name intact', () => {
    const out = [...csvLines(['name'], [['Ramírez']])].join('')
    expect(out).toContain('Ramírez')
  })
})

describe('export contract', () => {
  it('has exactly the 34 PRD columns in order', () => {
    expect(EXPORT_COLUMNS).toHaveLength(34)
    expect(EXPORT_COLUMNS[0]).toBe('submission_id')
    expect(EXPORT_COLUMNS[33]).toBe('months_to_expiry')
  })

  it('excludes the three fields held but never exported', () => {
    const forbidden = ['withdrawal_token', 'consent_ip', 'resume_blob_path']
    for (const name of forbidden) {
      expect(EXPORT_COLUMNS as readonly string[]).not.toContain(name)
    }
  })

  it('names the file with the export date', () => {
    expect(exportFilename('2026-08-15')).toBe('candidate_submissions_2026-08-15.csv')
  })
})
