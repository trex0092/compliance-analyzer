/**
 * Regulatory Obligation Calendar
 *
 * Dependency-aware filing deadline calendar for UAE AML/CFT/CPF obligations.
 * Computes all upcoming deadlines for an entity, ordered by urgency, with
 * cross-obligation dependency tracking (e.g. STR must precede CNMR, CNMR
 * must precede EOCN closure).
 *
 * Regulatory: FDL No.10/2025, Cabinet Res 134/2025, Cabinet Res 74/2020,
 *             MoE Circular 08/AML/2021, Cabinet Decision 109/2023,
 *             UAE FIU goAML Filing Guidelines 2024.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ObligationType =
  | 'STR_FILING'
  | 'SAR_FILING'
  | 'CTR_FILING'
  | 'DPMSR_QUARTERLY'
  | 'CNMR_FILING'
  | 'EOCN_FREEZE_NOTIFICATION'
  | 'UBO_REVERIFICATION'
  | 'CDD_REVIEW_SDD'
  | 'CDD_REVIEW_STANDARD'
  | 'EDD_REVIEW'
  | 'PEP_REVIEW'
  | 'POLICY_UPDATE'
  | 'LBMA_ANNUAL_AUDIT'
  | 'GOAML_REGISTRATION_RENEWAL'
  | 'MoE_LICENSE_RENEWAL'
  | 'RECORD_RETENTION_10YR'
  | 'SANCTIONS_LIST_REFRESH';

export type DeadlineStatus = 'upcoming' | 'due_today' | 'overdue' | 'completed' | 'blocked';
export type DeadlineUrgency = 'critical' | 'high' | 'medium' | 'low';

export interface RegulatoryDeadline {
  id: string;
  obligationType: ObligationType;
  description: string;
  triggerDate: string; // ISO date — event that started the clock
  dueDate: string; // ISO date or datetime
  isClockHours: boolean; // true for 24h EOCN
  clockHoursRemaining?: number; // if isClockHours
  businessDaysRemaining?: number; // if calendar-day deadline
  status: DeadlineStatus;
  urgency: DeadlineUrgency;
  dependsOn?: string[]; // ids of obligations that must complete first
  blockedBy?: string[]; // obligations blocking this one
  linkedEntityId?: string;
  linkedTransactionId?: string;
  regulatoryRef: string;
  penaltyRange?: string; // Cabinet Res 71/2024
  actionRequired: string;
}

export interface CalendarInput {
  entityId: string;
  /** Current date (ISO) — injectable for testing */
  asOfDate?: string;
  /** Open obligations to track */
  obligations: PendingObligation[];
}

export interface PendingObligation {
  id: string;
  type: ObligationType;
  triggerDate: string;
  linkedEntityId?: string;
  linkedTransactionId?: string;
  completedAt?: string; // if already done
  blockedByIds?: string[];
}

export interface CalendarReport {
  entityId: string;
  asOfDate: string;
  generatedAt: string;
  totalObligations: number;
  overdueCount: number;
  dueTodayCount: number;
  criticalCount: number;
  deadlines: RegulatoryDeadline[]; // sorted by urgency then dueDate
  narrativeSummary: string;
  regulatoryRefs: string[];
}

// ─── Deadline Definitions ─────────────────────────────────────────────────────

interface ObligationSpec {
  description: string;
  businessDays?: number;
  clockHours?: number;
  regulatoryRef: string;
  penaltyRange?: string;
  actionRequired: string;
}

const OBLIGATION_SPECS: Record<ObligationType, ObligationSpec> = {
  STR_FILING: {
    businessDays: 10,
    description: 'Suspicious Transaction Report filing',
    regulatoryRef: 'FDL No.10/2025 Art.26',
    penaltyRange: 'AED 10K–100M (Cabinet Res 71/2024)',
    actionRequired:
      'Submit STR via goAML. Include full narrative, entities, transactions. Four-eyes required.',
  },
  SAR_FILING: {
    businessDays: 10,
    description: 'Suspicious Activity Report filing',
    regulatoryRef: 'FDL No.10/2025 Art.26',
    penaltyRange: 'AED 10K–100M (Cabinet Res 71/2024)',
    actionRequired: 'Submit SAR via goAML for activity without completed transaction.',
  },
  CTR_FILING: {
    businessDays: 15,
    description: 'Cash Transaction Report (AED 55K DPMS)',
    regulatoryRef: 'MoE Circular 08/AML/2021',
    penaltyRange: 'AED 10K–5M',
    actionRequired: 'Submit CTR via goAML for cash transactions ≥ AED 55,000.',
  },
  DPMSR_QUARTERLY: {
    businessDays: 15,
    description: 'DPMS Quarterly Report to MoE/FIU',
    regulatoryRef: 'MoE Circular 08/AML/2021',
    penaltyRange: 'AED 10K–5M',
    actionRequired: 'Submit quarterly DPMSR via goAML within 15 business days of quarter end.',
  },
  CNMR_FILING: {
    businessDays: 5,
    description: 'Counter-Narcotics Money Report (post-sanctions)',
    regulatoryRef: 'Cabinet Res 74/2020 Art.7',
    penaltyRange: 'AED 50K–100M',
    actionRequired: 'Submit CNMR to EOCN within 5 business days of sanctions confirmation.',
  },
  EOCN_FREEZE_NOTIFICATION: {
    clockHours: 24,
    description: 'Asset freeze EOCN notification (24h)',
    regulatoryRef: 'Cabinet Res 74/2020 Art.4',
    penaltyRange: 'AED 100K–100M + criminal',
    actionRequired:
      'FREEZE ASSET IMMEDIATELY. Notify EOCN within 24 clock hours. DO NOT notify subject (Art.29).',
  },
  UBO_REVERIFICATION: {
    businessDays: 15,
    description: 'UBO re-verification after ownership change',
    regulatoryRef: 'Cabinet Decision 109/2023',
    penaltyRange: 'AED 10K–50M',
    actionRequired:
      'Re-verify beneficial ownership ≥25% within 15 working days of change notification.',
  },
  CDD_REVIEW_SDD: {
    businessDays: 260,
    description: 'Simplified CDD annual review (12 months)',
    regulatoryRef: 'Cabinet Res 134/2025 Art.7',
    actionRequired: 'Conduct annual CDD review for low-risk customers. Re-score risk.',
  },
  CDD_REVIEW_STANDARD: {
    businessDays: 130,
    description: 'Standard CDD 6-month review',
    regulatoryRef: 'Cabinet Res 134/2025 Art.8',
    actionRequired: 'Conduct 6-month CDD review. Verify documents. Re-screen sanctions.',
  },
  EDD_REVIEW: {
    businessDays: 65,
    description: 'Enhanced Due Diligence 3-month review',
    regulatoryRef: 'Cabinet Res 134/2025 Art.9',
    actionRequired:
      'Conduct quarterly EDD review. Verify source of funds, wealth. Senior management sign-off.',
  },
  PEP_REVIEW: {
    businessDays: 65,
    description: 'PEP relationship review (3-month)',
    regulatoryRef: 'Cabinet Res 134/2025 Art.14',
    penaltyRange: 'AED 100K+',
    actionRequired: 'Board-level approval for continued PEP relationship. Full EDD re-run.',
  },
  POLICY_UPDATE: {
    businessDays: 22,
    description: 'Policy update after new MoE circular',
    regulatoryRef: 'MoE Circular 08/AML/2021',
    actionRequired:
      'Update AML/CFT policy within 30 days of new circular publication. Circulate to staff.',
  },
  LBMA_ANNUAL_AUDIT: {
    businessDays: 260,
    description: 'LBMA RGG annual audit',
    regulatoryRef: 'LBMA Responsible Gold Guidance v9 §3.2',
    actionRequired: 'Commission independent LBMA supply-chain audit. Submit to LBMA member portal.',
  },
  GOAML_REGISTRATION_RENEWAL: {
    businessDays: 260,
    description: 'goAML system registration renewal',
    regulatoryRef: 'UAE FIU goAML Guidelines 2024',
    actionRequired:
      'Renew goAML registration. Update entity details, CO contact, digital certificate.',
  },
  MoE_LICENSE_RENEWAL: {
    businessDays: 30,
    description: 'MoE DPMS licence renewal',
    regulatoryRef: 'MoE Circular 08/AML/2021',
    penaltyRange: 'Licence suspension',
    actionRequired: 'Submit MoE DPMS licence renewal with updated AML attestation.',
  },
  RECORD_RETENTION_10YR: {
    businessDays: 0,
    description: 'Record retention check (10-year minimum)',
    regulatoryRef: 'FDL No.10/2025 Art.24',
    penaltyRange: 'AED 10K–50M',
    actionRequired:
      'Verify all transaction and CDD records retained for minimum 10 years from relationship end.',
  },
  SANCTIONS_LIST_REFRESH: {
    businessDays: 1,
    description: 'Sanctions list refresh (next business day)',
    regulatoryRef: 'Cabinet Res 74/2020 Art.3; FDL No.10/2025 Art.35',
    actionRequired:
      'Refresh UN, OFAC, EU, UK, UAE, EOCN sanctions lists. Re-screen all active customers.',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addBusinessDays(fromDate: Date, days: number): Date {
  if (days === 0) return new Date(fromDate);
  const result = new Date(fromDate);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    // UAE government standard weekend: Saturday (6) + Sunday (0),
    // effective 1 Jan 2022. Previously Fri/Sat. Matches the
    // authoritative implementation in src/utils/businessDays.ts.
    // CLAUDE.md §"Regulatory Domain Knowledge" — deadlines under
    // FDL No.(10)/2025 Art.24 + Cabinet Res 134/2025 must use UAE
    // business days, not calendar days.
    if (dow !== 6 && dow !== 0) added++;
  }
  return result;
}

function computeDueDate(
  triggerDate: string,
  spec: ObligationSpec
): { dueDate: string; isClockHours: boolean } {
  const trigger = new Date(triggerDate);
  if (spec.clockHours !== null && spec.clockHours !== undefined) {
    const due = new Date(trigger.getTime() + spec.clockHours * 3_600_000);
    return { dueDate: due.toISOString(), isClockHours: true };
  }
  const due = addBusinessDays(trigger, spec.businessDays ?? 0);
  return { dueDate: due.toISOString().split('T')[0], isClockHours: false };
}

function computeUrgency(dueDate: Date, now: Date, isClockHours: boolean): DeadlineUrgency {
  const diffMs = dueDate.getTime() - now.getTime();
  if (isClockHours) {
    if (diffMs <= 0) return 'critical';
    if (diffMs <= 6 * 3_600_000) return 'critical';
    if (diffMs <= 18 * 3_600_000) return 'high';
    return 'medium';
  }
  const diffDays = diffMs / 86_400_000;
  if (diffDays < 0) return 'critical';
  if (diffDays <= 2) return 'critical';
  if (diffDays <= 7) return 'high';
  if (diffDays <= 30) return 'medium';
  return 'low';
}

function computeStatus(
  dueDate: Date,
  now: Date,
  completed?: string,
  blockedBy?: string[]
): DeadlineStatus {
  if (completed) return 'completed';
  if (blockedBy && blockedBy.length > 0) return 'blocked';
  const diffDays = (dueDate.getTime() - now.getTime()) / 86_400_000;
  if (diffDays < 0) return 'overdue';
  if (diffDays < 1) return 'due_today';
  return 'upcoming';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function buildRegulatoryCalendar(input: CalendarInput): CalendarReport {
  const now = input.asOfDate ? new Date(input.asOfDate) : new Date();
  const asOfDate = now.toISOString().split('T')[0];

  const deadlines: RegulatoryDeadline[] = input.obligations.map((obl) => {
    const spec = OBLIGATION_SPECS[obl.type];
    if (!spec) throw new Error(`Unknown obligation type: ${obl.type}`);

    const { dueDate, isClockHours } = computeDueDate(obl.triggerDate, spec);
    const dueDateObj = new Date(dueDate);
    const urgency = computeUrgency(dueDateObj, now, isClockHours);
    const status = computeStatus(dueDateObj, now, obl.completedAt, obl.blockedByIds);

    const diffMs = dueDateObj.getTime() - now.getTime();
    const clockHoursRemaining = isClockHours ? Math.max(0, diffMs / 3_600_000) : undefined;
    const businessDaysRemaining =
      !isClockHours && diffMs > 0 ? Math.ceil(((diffMs / 86_400_000) * 5) / 7) : undefined;

    return {
      id: obl.id,
      obligationType: obl.type,
      description: spec.description,
      triggerDate: obl.triggerDate,
      dueDate,
      isClockHours,
      clockHoursRemaining,
      businessDaysRemaining,
      status,
      urgency,
      dependsOn: obl.blockedByIds,
      blockedBy: obl.blockedByIds,
      linkedEntityId: obl.linkedEntityId,
      linkedTransactionId: obl.linkedTransactionId,
      regulatoryRef: spec.regulatoryRef,
      penaltyRange: spec.penaltyRange,
      actionRequired: spec.actionRequired,
    };
  });

  // Sort: critical overdue first, then by dueDate
  deadlines.sort((a, b) => {
    const urgencyOrder: Record<DeadlineUrgency, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const uDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (uDiff !== 0) return uDiff;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const overdueCount = deadlines.filter((d) => d.status === 'overdue').length;
  const dueTodayCount = deadlines.filter((d) => d.status === 'due_today').length;
  const criticalCount = deadlines.filter((d) => d.urgency === 'critical').length;

  const narrativeSummary =
    `Entity ${input.entityId} — Regulatory Calendar as of ${asOfDate}: ` +
    `${deadlines.length} obligation(s). Overdue: ${overdueCount}. Due today: ${dueTodayCount}. ` +
    `Critical: ${criticalCount}. ` +
    (overdueCount > 0
      ? `IMMEDIATE ACTION REQUIRED on ${overdueCount} overdue obligation(s). `
      : '') +
    (deadlines[0]
      ? `Highest priority: ${deadlines[0].description} (due ${deadlines[0].dueDate}).`
      : '');

  return {
    entityId: input.entityId,
    asOfDate,
    generatedAt: now.toISOString(),
    totalObligations: deadlines.length,
    overdueCount,
    dueTodayCount,
    criticalCount,
    deadlines,
    narrativeSummary,
    regulatoryRefs: [
      'FDL No.10/2025 — UAE AML/CFT/CPF Law',
      'Cabinet Res 134/2025 — AML Implementing Regulations',
      'Cabinet Res 74/2020 Art.4-7 — TFS / Asset Freeze',
      'Cabinet Res 71/2024 — Administrative Penalties',
      'Cabinet Decision 109/2023 — UBO Register',
      'MoE Circular 08/AML/2021 — DPMS Sector Guidance',
      'UAE FIU goAML Filing Guidelines 2024',
      'LBMA Responsible Gold Guidance v9',
    ],
  };
}
