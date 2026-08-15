/**
 * Date handling for the intake app.
 *
 * Every candidate-facing timestamp in the PRD is "ISO 8601 with IST offset", and
 * retention is counted in calendar months from the submission date. India does not
 * observe DST, so IST is a fixed +05:30 and we can do the whole thing with plain
 * arithmetic rather than pulling in a timezone library.
 */

export const IST_OFFSET_MINUTES = 330
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000

/** A calendar date as seen on a wall clock in India. */
export interface CivilDate {
  year: number
  month: number // 1-12
  day: number // 1-31
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/**
 * Shift an instant so that the UTC getters read out IST wall-clock values.
 * The returned Date is only meaningful when read with `getUTC*` accessors.
 */
function shiftToIst(instant: Date): Date {
  return new Date(instant.getTime() + IST_OFFSET_MS)
}

/** The calendar date in India at the given instant. */
export function istCivilDate(instant: Date): CivilDate {
  const shifted = shiftToIst(instant)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** ISO 8601 timestamp carrying the IST offset, e.g. `2026-08-15T18:37:04+05:30`. */
export function toIstIso(instant: Date): string {
  const s = shiftToIst(instant)
  const date = `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`
  const time = `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`
  return `${date}T${time}+05:30`
}

/** `YYYY-MM-DD` for a civil date. */
export function formatCivilDate(d: CivilDate): string {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`
}

export function parseCivilDate(value: string): CivilDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${value}`)
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Add calendar months, clamping the day to the end of the target month.
 * 31 Jan + 1 month is 28 Feb (29 in a leap year), not 3 March.
 */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const zeroBased = date.month - 1 + months
  const year = date.year + Math.floor(zeroBased / 12)
  const month = ((zeroBased % 12) + 12) % 12 + 1
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) }
}

/** Retention expiry: RETENTION_MONTHS calendar months after the submission date in IST. */
export function retentionExpiryDate(submittedAt: Date, months: number): string {
  return formatCivilDate(addMonths(istCivilDate(submittedAt), months))
}

/** Complete calendar months from `from` to `to`. Assumes `to` is on or after `from`. */
function completeMonthsBetween(from: CivilDate, to: CivilDate): number {
  const months = (to.year - from.year) * 12 + (to.month - from.month)
  return to.day < from.day ? months - 1 : months
}

/**
 * Whole calendar months remaining until expiry, counted in IST. Negative once the
 * record is past its expiry date.
 *
 * Magnitude is truncated toward zero in both directions, so the number always reads
 * as "complete months away": a record expiring in 29 days reports 0 rather than
 * rounding up to 1, and one that expired 3 days ago also reports 0 rather than -1.
 *
 * Deliberately computed on read rather than stored: a `months_to_expiry` column
 * written at insert time is wrong the following month.
 */
export function monthsToExpiry(expiry: string | CivilDate, now: Date): number {
  const target = typeof expiry === 'string' ? parseCivilDate(expiry) : expiry
  const today = istCivilDate(now)
  const overdue =
    target.year < today.year ||
    (target.year === today.year &&
      (target.month < today.month || (target.month === today.month && target.day < today.day)))
  if (!overdue) return completeMonthsBetween(today, target)
  const elapsed = completeMonthsBetween(target, today)
  // Negating a zero month count yields -0, which compares unequal to 0.
  return elapsed === 0 ? 0 : -elapsed
}

/** Add days, rolling over month and year boundaries correctly. */
export function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

/** Whole days between two civil dates (b - a). Used by the expiry sweep. */
export function daysBetween(a: CivilDate, b: CivilDate): number {
  const toUtc = (d: CivilDate) => Date.UTC(d.year, d.month - 1, d.day)
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000)
}
