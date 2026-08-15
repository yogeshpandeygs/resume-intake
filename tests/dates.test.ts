import { describe, expect, it } from 'vitest'
import {
  addMonths,
  daysBetween,
  formatCivilDate,
  istCivilDate,
  monthsToExpiry,
  parseCivilDate,
  retentionExpiryDate,
  toIstIso,
} from '../lib/domain/dates'
import { RETENTION_MONTHS } from '../lib/domain/constants'

describe('IST conversion', () => {
  it('renders the offset explicitly', () => {
    expect(toIstIso(new Date('2026-08-15T07:07:04Z'))).toBe('2026-08-15T12:37:04+05:30')
  })

  it('rolls the IST date forward for late-evening UTC instants', () => {
    // 19:00 UTC is 00:30 the next day in India.
    expect(istCivilDate(new Date('2026-08-15T19:00:00Z'))).toEqual({
      year: 2026,
      month: 8,
      day: 16,
    })
  })

  it('handles the year boundary', () => {
    expect(toIstIso(new Date('2025-12-31T18:30:00Z'))).toBe('2026-01-01T00:00:00+05:30')
  })
})

describe('addMonths', () => {
  it('adds whole months', () => {
    expect(addMonths({ year: 2026, month: 8, day: 15 }, 36)).toEqual({
      year: 2029,
      month: 8,
      day: 15,
    })
  })

  it('clamps to the end of a shorter target month', () => {
    // 31 January + 1 month is 28 February, not 3 March.
    expect(addMonths({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 28,
    })
  })

  it('accounts for leap years when clamping', () => {
    expect(addMonths({ year: 2028, month: 1, day: 31 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    })
  })

  it('crosses the year boundary', () => {
    expect(addMonths({ year: 2026, month: 11, day: 10 }, 3)).toEqual({
      year: 2027,
      month: 2,
      day: 10,
    })
  })
})

describe('retention', () => {
  it('expires 36 months after submission', () => {
    const submitted = new Date('2026-08-15T07:00:00Z')
    expect(retentionExpiryDate(submitted, RETENTION_MONTHS)).toBe('2029-08-15')
  })

  it('counts from the IST date, not the UTC date', () => {
    // 2026-08-15T19:00Z is already 16 August in India.
    const submitted = new Date('2026-08-15T19:00:00Z')
    expect(retentionExpiryDate(submitted, RETENTION_MONTHS)).toBe('2029-08-16')
  })
})

describe('monthsToExpiry', () => {
  it('reports the full retention period on the day of submission', () => {
    const now = new Date('2026-08-15T07:00:00Z')
    expect(monthsToExpiry('2029-08-15', now)).toBe(36)
  })

  it('decreases as time passes', () => {
    expect(monthsToExpiry('2029-08-15', new Date('2027-08-15T07:00:00Z'))).toBe(24)
    expect(monthsToExpiry('2029-08-15', new Date('2029-07-15T07:00:00Z'))).toBe(1)
  })

  it('rounds down a partial month', () => {
    // 20 July to 15 August is not yet a whole month.
    expect(monthsToExpiry('2029-08-15', new Date('2029-07-20T07:00:00Z'))).toBe(0)
  })

  it('reads 0 for a record only days past expiry, not -1', () => {
    expect(monthsToExpiry('2029-08-15', new Date('2029-08-20T07:00:00Z'))).toBe(0)
  })

  it('goes negative once the record is a full month overdue for erasure', () => {
    expect(monthsToExpiry('2029-08-15', new Date('2029-09-16T07:00:00Z'))).toBe(-1)
    expect(monthsToExpiry('2029-08-15', new Date('2029-11-20T07:00:00Z'))).toBe(-3)
  })

  it('is computed rather than stored, so it changes with the clock', () => {
    // The same record read a year apart must not report the same figure —
    // this is why months_to_expiry is not a column.
    const expiry = '2029-08-15'
    const first = monthsToExpiry(expiry, new Date('2026-08-15T07:00:00Z'))
    const later = monthsToExpiry(expiry, new Date('2027-08-15T07:00:00Z'))
    expect(first).not.toBe(later)
  })
})

describe('civil date helpers', () => {
  it('round-trips through format and parse', () => {
    const d = { year: 2026, month: 3, day: 7 }
    expect(parseCivilDate(formatCivilDate(d))).toEqual(d)
  })

  it('zero-pads month and day', () => {
    expect(formatCivilDate({ year: 2026, month: 3, day: 7 })).toBe('2026-03-07')
  })

  it('rejects a malformed date string', () => {
    expect(() => parseCivilDate('15/08/2026')).toThrow()
  })

  it('counts days between dates', () => {
    expect(daysBetween({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 8, day: 31 })).toBe(30)
    expect(daysBetween({ year: 2029, month: 7, day: 16 }, { year: 2029, month: 8, day: 15 })).toBe(30)
  })
})
