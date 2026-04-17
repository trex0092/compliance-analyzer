export function nowIso(): string {
  return new Date().toISOString();
}

export function isValidDate(dateStr: string): boolean {
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

export function addMonths(dateIso: string, months: number): string {
  const d = new Date(dateIso);
  if (isNaN(d.getTime())) return new Date().toISOString();
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Clamp to last day of target month if overflow occurred (e.g., Jan 31 + 1 month)
  if (d.getDate() !== originalDay) d.setDate(0);
  return d.toISOString();
}

export function addYears(dateIso: string, years: number): string {
  const d = new Date(dateIso);
  if (isNaN(d.getTime())) return new Date().toISOString();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

/**
 * Format a date string as dd/mm/yyyy in the UAE / Asia/Dubai timezone
 * (UTC+4, no DST). This is the mandatory format for UAE compliance
 * documents (FDL, goAML filings, MoE reports). Do NOT rely on the
 * runtime's local timezone — Netlify functions execute in UTC, so
 * `d.getDate()` would return the UTC day-of-month, which can be off
 * by one near midnight Dubai. Use Intl.DateTimeFormat with an
 * explicit `timeZone` for correctness.
 */
/** Short format for UI display: dd/mm/yyyy (Dubai-local). */
export function formatDate(dateStr: string): string {
  return formatDateDDMMYYYY(dateStr);
}

const DUBAI_DDMMYYYY = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DUBAI_YYYYMMDD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatDateDDMMYYYY(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return DUBAI_DDMMYYYY.format(d);
}

/**
 * Return the calendar date the given instant falls on in the UAE /
 * Asia/Dubai timezone, formatted as `YYYY-MM-DD`. Use this to compare
 * "is this Dubai-today?" instead of `getDate()` on a UTC-runtime
 * Date object.
 */
export function dubaiDateYmd(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '';
  return DUBAI_YYYYMMDD.format(d);
}

/** True when the two instants fall on the same Dubai-local calendar date. */
export function isSameDubaiDate(a: Date, b: Date): boolean {
  return dubaiDateYmd(a) === dubaiDateYmd(b);
}
