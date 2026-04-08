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
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export function addYears(dateIso: string, years: number): string {
  const d = new Date(dateIso);
  if (isNaN(d.getTime())) return new Date().toISOString();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

/**
 * Format a date string as dd/mm/yyyy — the mandatory format for UAE
 * compliance documents (FDL, goAML filings, MoE reports).
 * Do NOT use toLocaleDateString() which varies by browser locale.
 */
export function formatDateDDMMYYYY(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}
