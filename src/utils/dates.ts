export function nowIso(): string {
  return new Date().toISOString();
}

export function addMonths(dateIso: string, months: number): string {
  const d = new Date(dateIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export function addYears(dateIso: string, years: number): string {
  const d = new Date(dateIso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}
