/**
 * Asana Operational — Asana Phase 3 Cluster P.
 *
 * Four operational helpers:
 *
 *   P1 timeTrackingLogger     — per-analyst-per-case time log
 *   P2 capacityHeatmap        — weekly hours per analyst with overflow flag
 *   P3 filingFunnelRollup     — funnel count per filing type per quarter
 *   P4 coldStorageRotator     — picks tasks eligible for archival after
 *                               5-year FDL Art.24 retention
 */

// ---------------------------------------------------------------------------
// P1 — Time tracking logger
// ---------------------------------------------------------------------------

export interface TimeEntry {
  analystGid: string;
  taskGid: string;
  hours: number;
  loggedAt: string;
  category: 'review' | 'screening' | 'filing' | 'meeting' | 'other';
}

export interface TimeRollupByAnalyst {
  analystGid: string;
  totalHours: number;
  byCategory: Record<TimeEntry['category'], number>;
}

export function rollupTimeByAnalyst(entries: readonly TimeEntry[]): TimeRollupByAnalyst[] {
  const byAnalyst = new Map<string, TimeRollupByAnalyst>();
  for (const e of entries) {
    const existing = byAnalyst.get(e.analystGid) ?? {
      analystGid: e.analystGid,
      totalHours: 0,
      byCategory: { review: 0, screening: 0, filing: 0, meeting: 0, other: 0 },
    };
    existing.totalHours += e.hours;
    existing.byCategory[e.category] += e.hours;
    byAnalyst.set(e.analystGid, existing);
  }
  return Array.from(byAnalyst.values()).sort((a, b) => b.totalHours - a.totalHours);
}

// ---------------------------------------------------------------------------
// P2 — Capacity heatmap
// ---------------------------------------------------------------------------

export interface CapacityCell {
  analystGid: string;
  weekStartIso: string;
  hours: number;
  weeklyCapacity: number;
  overflow: boolean;
}

export function buildCapacityHeatmap(
  entries: readonly TimeEntry[],
  weeklyCapacity = 40
): CapacityCell[] {
  const byKey = new Map<string, CapacityCell>();
  for (const e of entries) {
    const weekStart = weekStartOf(e.loggedAt);
    const key = `${e.analystGid}|${weekStart}`;
    const existing = byKey.get(key) ?? {
      analystGid: e.analystGid,
      weekStartIso: weekStart,
      hours: 0,
      weeklyCapacity,
      overflow: false,
    };
    existing.hours += e.hours;
    existing.overflow = existing.hours > weeklyCapacity;
    byKey.set(key, existing);
  }
  return Array.from(byKey.values());
}

function weekStartOf(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const dow = d.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1; // Monday = 0
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// P3 — Filing funnel rollup
// ---------------------------------------------------------------------------

export type FilingStatus = 'drafted' | 'under_review' | 'submitted' | 'accepted' | 'rejected';

export interface FilingRow {
  filingType: 'STR' | 'SAR' | 'CTR' | 'DPMSR' | 'CNMR' | 'EOCN';
  status: FilingStatus;
  filedAt: string;
}

export interface FilingFunnelRollup {
  quarter: string;
  filingType: FilingRow['filingType'];
  drafted: number;
  under_review: number;
  submitted: number;
  accepted: number;
  rejected: number;
}

export function rollupFilingFunnel(rows: readonly FilingRow[]): FilingFunnelRollup[] {
  const byKey = new Map<string, FilingFunnelRollup>();
  for (const r of rows) {
    const quarter = quarterOf(r.filedAt);
    const key = `${quarter}|${r.filingType}`;
    const existing = byKey.get(key) ?? {
      quarter,
      filingType: r.filingType,
      drafted: 0,
      under_review: 0,
      submitted: 0,
      accepted: 0,
      rejected: 0,
    };
    existing[r.status] += 1;
    byKey.set(key, existing);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.quarter === b.quarter
      ? a.filingType.localeCompare(b.filingType)
      : a.quarter.localeCompare(b.quarter)
  );
}

function quarterOf(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

// ---------------------------------------------------------------------------
// P4 — Cold storage rotator
// ---------------------------------------------------------------------------

export interface ArchivableTask {
  taskGid: string;
  completedAt: string;
}

export function pickColdStorageEligible(
  tasks: readonly ArchivableTask[],
  now: Date = new Date(),
  retentionYears = 5
): string[] {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - retentionYears);
  return tasks.filter((t) => Date.parse(t.completedAt) < cutoff.getTime()).map((t) => t.taskGid);
}
