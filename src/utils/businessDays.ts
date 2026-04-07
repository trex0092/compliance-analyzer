/**
 * UAE Business Day Calculator
 *
 * UAE weekend: Friday & Saturday (changed from Fri-Sat to Sat-Sun in 2022,
 * but private sector still varies — this uses Sat-Sun as government standard).
 * Includes UAE public holidays.
 *
 * CRITICAL: Filing deadlines (STR, CTR, CNMR) are measured in BUSINESS days
 * per FDL No.10/2025. Using calendar days is a regulatory violation risk.
 */

/** UAE public holidays — update annually */
const UAE_PUBLIC_HOLIDAYS_2026: string[] = [
  "2026-01-01", // New Year's Day
  "2026-03-19", // Eid Al Fitr (estimated — confirm with Awqaf)
  "2026-03-20",
  "2026-03-21",
  "2026-05-26", // Arafat Day (estimated)
  "2026-05-27", // Eid Al Adha (estimated)
  "2026-05-28",
  "2026-05-29",
  "2026-06-17", // Islamic New Year (estimated)
  "2026-08-26", // Prophet's Birthday (estimated)
  "2026-12-01", // Commemoration Day
  "2026-12-02", // National Day
  "2026-12-03", // National Day
];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 6 || day === 0; // Saturday=6, Sunday=0
}

function isPublicHoliday(d: Date): boolean {
  return UAE_PUBLIC_HOLIDAYS_2026.includes(toDateStr(d));
}

export function isBusinessDay(d: Date): boolean {
  return !isWeekend(d) && !isPublicHoliday(d);
}

/**
 * Add N business days to a date.
 * Used for filing deadline calculations (STR, CTR, CNMR).
 */
export function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDay(result)) added++;
  }
  return result;
}

/**
 * Count business days between two dates (exclusive of start, inclusive of end).
 * Used for checking if a filing deadline has been met.
 */
export function countBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  while (current < end) {
    current.setDate(current.getDate() + 1);
    if (isBusinessDay(current)) count++;
  }
  return count;
}

/**
 * Check if a filing deadline has been breached.
 * @param eventDate - When the triggering event occurred
 * @param deadlineBusinessDays - Number of business days allowed
 * @param now - Current date (defaults to today)
 * @returns { breached, daysElapsed, deadlineDate, daysRemaining }
 */
export function checkDeadline(
  eventDate: Date,
  deadlineBusinessDays: number,
  now: Date = new Date()
): {
  breached: boolean;
  businessDaysElapsed: number;
  deadlineDate: Date;
  businessDaysRemaining: number;
} {
  const deadlineDate = addBusinessDays(eventDate, deadlineBusinessDays);
  const businessDaysElapsed = countBusinessDays(eventDate, now);
  const businessDaysRemaining = Math.max(0, deadlineBusinessDays - businessDaysElapsed);

  return {
    breached: now > deadlineDate,
    businessDaysElapsed,
    deadlineDate,
    businessDaysRemaining,
  };
}

/**
 * Check EOCN 24-hour asset freeze deadline.
 * This uses HOURS, not business days — asset freeze is a 24h clock.
 */
export function checkEOCNDeadline(
  matchConfirmedAt: Date,
  now: Date = new Date()
): {
  breached: boolean;
  hoursElapsed: number;
  hoursRemaining: number;
} {
  const hoursElapsed = (now.getTime() - matchConfirmedAt.getTime()) / (1000 * 60 * 60);
  return {
    breached: hoursElapsed >= 24,
    hoursElapsed: Math.round(hoursElapsed * 10) / 10,
    hoursRemaining: Math.max(0, Math.round((24 - hoursElapsed) * 10) / 10),
  };
}
