/**
 * CSV generation for the admin export.
 *
 * Hand-rolled rather than pulled from a library, per the PRD: the file is streamed
 * server-side, and the two rules that matter (RFC 4180 quoting and the spreadsheet
 * formula-injection guard) are a dozen lines between them.
 */

/** Excel on Windows needs a BOM to read the file as UTF-8 rather than the ANSI codepage. */
export const UTF8_BOM = '﻿'

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than text.
 * Candidate free text is untrusted input; a resume summary beginning `=cmd|...`
 * would otherwise execute on open.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r']

/**
 * Neutralise a leading formula trigger by prefixing a single quote, which
 * spreadsheets read as "the rest of this cell is literal text".
 */
export function guardFormulaInjection(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGERS.includes(value[0]!)) {
    return `'${value}`
  }
  return value
}

/** RFC 4180: quote when the value contains a delimiter, quote or line break; double any quotes. */
function quote(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Render one value as a CSV field: null and undefined become empty, everything else
 * is stringified, guarded against formula injection, then quoted if it needs it.
 */
export function csvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  return quote(guardFormulaInjection(String(value)))
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvField).join(',')
}

/**
 * Build the complete CSV text. Rows are supplied as an iterable so callers can
 * stream a cursor rather than materialising every record in memory.
 */
export function* csvLines(
  header: readonly string[],
  rows: Iterable<readonly unknown[]>,
): Generator<string> {
  yield UTF8_BOM + csvRow(header) + '\r\n'
  for (const row of rows) {
    yield csvRow(row) + '\r\n'
  }
}

/** Same as `csvLines` but for an async row source (a database cursor). */
export async function* csvLinesAsync(
  header: readonly string[],
  rows: AsyncIterable<readonly unknown[]>,
): AsyncGenerator<string> {
  yield UTF8_BOM + csvRow(header) + '\r\n'
  for await (const row of rows) {
    yield csvRow(row) + '\r\n'
  }
}

/** `candidate_submissions_2026-08-15.csv` */
export function exportFilename(dateIso: string): string {
  return `candidate_submissions_${dateIso}.csv`
}
