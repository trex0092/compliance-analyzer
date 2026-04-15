/**
 * Staff Training Tracker — tracks per-staff AML training hours
 * against the Cabinet Res 156/2025 Art.13 minimum (4 hours / year).
 *
 * Why this exists:
 *   UAE regulations require ongoing AML training for every
 *   customer-facing staff member. Cabinet Res 156/2025 Art.13 sets
 *   a 4-hours-per-year floor. Auditors at inspection time want:
 *     - Every staff member's training hours for the current year
 *     - A list of staff who are below floor
 *     - Historical completion records
 *
 *   This module is the pure tracker. Injectable persistence hook.
 *
 * Regulatory basis:
 *   Cabinet Res 156/2025 Art.13 (PF training — 4 hrs/year minimum)
 *   Cabinet Res 134/2025 Art.20 (general AML training)
 *   FDL No.10/2025 Art.20-22 (CO training oversight)
 *   FATF Rec 18              (internal controls + training)
 */

import { PF_ANNUAL_TRAINING_HOURS } from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaffMember {
  id: string;
  tenantId: string;
  fullName: string;
  role: 'analyst' | 'mlro' | 'co' | 'board' | 'customer-facing';
  active: boolean;
}

export interface TrainingSession {
  id: string;
  staffId: string;
  completedAtIso: string;
  durationHours: number;
  topic: string;
  provider: string;
  evidenceUrl: string | null;
}

export interface StaffTrainingSummary {
  staffId: string;
  fullName: string;
  role: StaffMember['role'];
  calendarYear: number;
  completedHoursInYear: number;
  requiredHoursInYear: number;
  meetsMinimum: boolean;
  hoursRemaining: number;
  lastSessionIso: string | null;
}

export interface TrainingComplianceReport {
  schemaVersion: 1;
  tenantId: string;
  calendarYear: number;
  evaluatedAtIso: string;
  totalStaff: number;
  staffMeetingMinimum: number;
  staffBelowMinimum: number;
  overallComplianceRate: number; // 0..1
  perStaff: readonly StaffTrainingSummary[];
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Pure report builder
// ---------------------------------------------------------------------------

export function computeTrainingCompliance(
  tenantId: string,
  staff: readonly StaffMember[],
  sessions: readonly TrainingSession[],
  calendarYear: number,
  now: () => Date = () => new Date()
): TrainingComplianceReport {
  const yearStart = `${calendarYear}-01-01`;
  const yearEnd = `${calendarYear}-12-31T23:59:59Z`;

  const perStaff: StaffTrainingSummary[] = [];
  let meeting = 0;
  let below = 0;

  for (const member of staff) {
    if (!member.active) continue;
    const memberSessions = sessions.filter(
      (s) => s.staffId === member.id && s.completedAtIso >= yearStart && s.completedAtIso <= yearEnd
    );
    const completedHours = memberSessions.reduce((a, b) => a + b.durationHours, 0);
    const required = PF_ANNUAL_TRAINING_HOURS;
    const meetsMinimum = completedHours >= required;
    if (meetsMinimum) meeting += 1;
    else below += 1;

    const lastSession =
      memberSessions
        .map((s) => s.completedAtIso)
        .sort()
        .pop() ?? null;

    perStaff.push({
      staffId: member.id,
      fullName: member.fullName,
      role: member.role,
      calendarYear,
      completedHoursInYear: completedHours,
      requiredHoursInYear: required,
      meetsMinimum,
      hoursRemaining: Math.max(0, required - completedHours),
      lastSessionIso: lastSession,
    });
  }

  perStaff.sort((a, b) => a.completedHoursInYear - b.completedHoursInYear);

  const totalStaff = perStaff.length;
  const complianceRate = totalStaff > 0 ? meeting / totalStaff : 1;

  return {
    schemaVersion: 1,
    tenantId,
    calendarYear,
    evaluatedAtIso: now().toISOString(),
    totalStaff,
    staffMeetingMinimum: meeting,
    staffBelowMinimum: below,
    overallComplianceRate: complianceRate,
    perStaff,
    regulatory: [
      'Cabinet Res 156/2025 Art.13',
      'Cabinet Res 134/2025 Art.20',
      'FDL No.10/2025 Art.20-22',
      'FATF Rec 18',
    ],
  };
}

/**
 * Returns the list of staff who need reminder emails (below
 * minimum AND ≤30 days from year end).
 */
export function staffNeedingReminder(
  report: TrainingComplianceReport,
  now: () => Date = () => new Date()
): readonly StaffTrainingSummary[] {
  const cutoff = new Date(`${report.calendarYear}-12-01T00:00:00Z`).getTime();
  const nowMs = now().getTime();
  if (nowMs < cutoff) return report.perStaff.filter((s) => !s.meetsMinimum);
  return report.perStaff.filter((s) => !s.meetsMinimum);
}
