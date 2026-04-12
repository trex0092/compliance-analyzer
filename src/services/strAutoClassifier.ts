/**
 * STR/SAR/CTR Auto-Classifier
 *
 * Automatically classifies a suspicious transaction report into the correct
 * UAE FIU filing category: STR, SAR, CTR, DPMSR, CNMR or EOCN_FREEZE.
 * Determines the applicable deadline using business-days logic.
 *
 * Regulatory: FDL No.10/2025 Art.26-27, Cabinet Res 134/2025 Art.19,
 *             Cabinet Res 74/2020 Art.4-7 (EOCN/CNMR), MoE Circular
 *             08/AML/2021 (DPMSR), UAE FIU goAML Filing Guidelines 2024.
 *
 * All thresholds and deadlines are imported from src/domain/constants.ts —
 * the single source of regulatory truth. Never hardcode here.
 */

import {
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
  DPMS_CASH_THRESHOLD_AED,
} from '../domain/constants';
import { addBusinessDays } from '../utils/businessDays';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FilingCategory =
  | 'STR'           // Suspicious Transaction Report — primary AML
  | 'SAR'           // Suspicious Activity Report — where no completed transaction
  | 'CTR'           // Cash Transaction Report — AED 55K threshold (DPMS)
  | 'DPMSR'         // DPMS Report — quarterly DPMS sector obligation
  | 'CNMR'          // Counter-Narcotics Money Report — drug-related proceeds
  | 'EOCN_FREEZE'   // EOCN / TFS Asset Freeze notification
  | 'NONE';         // Insufficient grounds for any filing

export type FilingUrgency = 'immediate' | 'urgent' | 'standard' | 'periodic';

export interface FilingDeadline {
  businessDays?: number;   // null for clock-hour deadlines
  clockHours?: number;     // for EOCN freeze (24h)
  description: string;
  regulatoryRef: string;
}

/**
 * Filing deadlines sourced from src/domain/constants.ts.
 *
 * STR/SAR: UAE FIU interprets "without delay" as absolute immediacy. The
 * backstop constant is 0 business days — there is no grace period. File the
 * moment suspicion solidifies. This was previously hardcoded as 10 business
 * days in this file, which was a regulatory violation of FDL Art.26-27.
 */
export const FILING_DEADLINES: Record<Exclude<FilingCategory, 'NONE'>, FilingDeadline> = {
  STR: {
    businessDays: STR_FILING_DEADLINE_BUSINESS_DAYS,
    description: 'STR must be filed WITHOUT DELAY upon suspicion formation (FIU: absolute immediacy)',
    regulatoryRef: 'FDL No.10/2025 Art.26-27; UAE FIU goAML Filing Guidelines 2024',
  },
  SAR: {
    businessDays: STR_FILING_DEADLINE_BUSINESS_DAYS,
    description: 'SAR must be filed WITHOUT DELAY upon suspicion formation (FIU: absolute immediacy)',
    regulatoryRef: 'FDL No.10/2025 Art.26-27; UAE FIU goAML Filing Guidelines 2024',
  },
  CTR: {
    businessDays: CTR_FILING_DEADLINE_BUSINESS_DAYS,
    description: `CTR must be filed within ${CTR_FILING_DEADLINE_BUSINESS_DAYS} business days of transaction`,
    regulatoryRef: 'MoE Circular 08/AML/2021; FDL Art.16',
  },
  DPMSR: {
    businessDays: CTR_FILING_DEADLINE_BUSINESS_DAYS,
    description: `DPMSR filed quarterly within ${CTR_FILING_DEADLINE_BUSINESS_DAYS} business days of quarter end`,
    regulatoryRef: 'MoE Circular 08/AML/2021',
  },
  CNMR: {
    businessDays: CNMR_FILING_DEADLINE_BUSINESS_DAYS,
    description: `CNMR filed within ${CNMR_FILING_DEADLINE_BUSINESS_DAYS} business days of sanctions confirmation`,
    regulatoryRef: 'Cabinet Res 74/2020 Art.7',
  },
  EOCN_FREEZE: {
    clockHours: 24,
    description: 'EOCN freeze notification within 24 clock hours of confirmation',
    regulatoryRef: 'Cabinet Res 74/2020 Art.4',
  },
};

export interface ClassificationInput {
  /** Amount in AED */
  amountAED: number;
  /** Was this a cash transaction? */
  isCash: boolean;
  /** Was the transaction actually completed? (false → SAR not STR) */
  transactionCompleted: boolean;
  /** Is there a confirmed or potential sanctions match? */
  sanctionsMatchConfidence: number;   // 0–1
  /** Involves drug proceeds or CNMR-listed substances? */
  narcoticsProceedsIndicated: boolean;
  /** Is the entity a DPMS dealer subject to sector reporting? */
  isDpmsDealer: boolean;
  /** Has the suspicious activity already been filed as STR/SAR? */
  priorFilingExists: boolean;
  /** AML/typology indicators present */
  amlIndicators: string[];
  /** Date of triggering event */
  eventDate: string;
}

export interface ClassificationResult {
  primaryCategory: FilingCategory;
  additionalCategories: FilingCategory[];
  urgency: FilingUrgency;
  deadline: FilingDeadline | null;
  deadlineDueDate: string | null;      // ISO date string
  rationale: string;
  goamlFormCode: string;
  tipOffProhibited: boolean;          // FDL Art.29
  requiresFourEyes: boolean;
  regulatoryRefs: string[];
  filingInstructions: string[];
}

// ─── Classification Logic ─────────────────────────────────────────────────────
// addBusinessDays is imported from src/utils/businessDays.ts — the canonical
// implementation that includes UAE public holidays and uses Sat/Sun weekend
// (UAE government standard since 2022). Never redefine locally.

function computeDueDate(eventDate: string, deadline: FilingDeadline): string | null {
  const event = new Date(eventDate);
  if (isNaN(event.getTime())) return null;

  if (deadline.clockHours != null) {
    const due = new Date(event.getTime() + deadline.clockHours * 3_600_000);
    return due.toISOString();
  }
  if (deadline.businessDays != null) {
    return addBusinessDays(event, deadline.businessDays).toISOString().split('T')[0];
  }
  return null;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function classifyFiling(input: ClassificationInput): ClassificationResult {
  const categories: FilingCategory[] = [];
  const rationale: string[] = [];
  const filingInstructions: string[] = [];

  // ── EOCN_FREEZE — highest priority ──────────────────────────────────────────
  if (input.sanctionsMatchConfidence >= 0.9) {
    categories.push('EOCN_FREEZE');
    rationale.push(`Sanctions match confidence ${(input.sanctionsMatchConfidence * 100).toFixed(0)}% ≥ 90% — immediate asset freeze required (Cabinet Res 74/2020 Art.4)`);
    filingInstructions.push('IMMEDIATE: Execute asset freeze. Notify EOCN within 24 clock hours. File CNMR within 5 business days. DO NOT notify subject (Art.29).');
  }

  // ── CNMR ────────────────────────────────────────────────────────────────────
  if (input.narcoticsProceedsIndicated) {
    categories.push('CNMR');
    rationale.push('Narcotics proceeds indicators detected — CNMR obligation triggered');
    filingInstructions.push(
      `File CNMR via goAML within ${CNMR_FILING_DEADLINE_BUSINESS_DAYS} business days. Reference drug-trafficking red flags in narrative.`
    );
  }

  // ── STR / SAR ────────────────────────────────────────────────────────────────
  if (input.amlIndicators.length > 0 || input.sanctionsMatchConfidence >= 0.5) {
    if (input.transactionCompleted) {
      categories.push('STR');
      rationale.push(`STR: ${input.amlIndicators.length} AML indicator(s) + completed transaction`);
      filingInstructions.push(
        'File STR via goAML WITHOUT DELAY (FIU: absolute immediacy) upon suspicion formation. Include all AML indicators in narrative. FDL Art.26-27.'
      );
    } else {
      categories.push('SAR');
      rationale.push('SAR: Suspicious activity without completed transaction');
      filingInstructions.push(
        'File SAR via goAML WITHOUT DELAY (FIU: absolute immediacy) upon suspicion formation. Document why transaction was not completed. FDL Art.26-27.'
      );
    }
  }

  // ── CTR ──────────────────────────────────────────────────────────────────────
  if (input.isCash && input.amountAED >= DPMS_CASH_THRESHOLD_AED && input.isDpmsDealer) {
    categories.push('CTR');
    rationale.push(
      `CTR: Cash transaction AED ${input.amountAED.toLocaleString()} ≥ AED ${DPMS_CASH_THRESHOLD_AED.toLocaleString()} threshold (MoE Circular 08/AML/2021)`
    );
    filingInstructions.push(
      `File CTR via goAML within ${CTR_FILING_DEADLINE_BUSINESS_DAYS} business days of transaction. Mandatory regardless of suspicion.`
    );
  }

  // ── DPMSR ────────────────────────────────────────────────────────────────────
  if (input.isDpmsDealer && !input.priorFilingExists && categories.length === 0) {
    categories.push('DPMSR');
    rationale.push('DPMSR: DPMS dealer with no triggered STR/CTR — standard quarterly report');
    filingInstructions.push(
      'Include in next quarterly DPMSR submission to MoE/goAML. Retain supporting documentation per RECORD_RETENTION_YEARS (10 years, FDL Art.24).'
    );
  }

  // ── No filing ────────────────────────────────────────────────────────────────
  if (categories.length === 0) {
    categories.push('NONE');
    rationale.push('No STR/CTR/CNMR/DPMSR trigger conditions met');
  }

  const primaryCategory = categories[0];
  const additionalCategories = categories.slice(1);

  const urgencyMap: Record<FilingCategory, FilingUrgency> = {
    EOCN_FREEZE: 'immediate',
    CNMR: 'urgent',
    STR: 'urgent',
    SAR: 'urgent',
    CTR: 'standard',
    DPMSR: 'periodic',
    NONE: 'standard',
  };

  const deadline = primaryCategory !== 'NONE' ? FILING_DEADLINES[primaryCategory] ?? null : null;
  const deadlineDueDate = deadline ? computeDueDate(input.eventDate, deadline) : null;

  // goAML form codes (UAE FIU schema)
  const goamlFormCodes: Record<FilingCategory, string> = {
    STR: 'STR_DPMS_V4',
    SAR: 'SAR_V4',
    CTR: 'CTR_DPMS_V4',
    DPMSR: 'DPMSR_Q_V2',
    CNMR: 'CNMR_V3',
    EOCN_FREEZE: 'EOCN_TFS_V3',
    NONE: '',
  };

  return {
    primaryCategory,
    additionalCategories,
    urgency: urgencyMap[primaryCategory],
    deadline,
    deadlineDueDate,
    rationale: rationale.join('; '),
    goamlFormCode: goamlFormCodes[primaryCategory],
    tipOffProhibited: primaryCategory !== 'NONE',
    requiresFourEyes: ['STR', 'SAR', 'CNMR', 'EOCN_FREEZE'].includes(primaryCategory),
    regulatoryRefs: [
      'FDL No.10/2025 Art.26-27 — STR/SAR filing obligation',
      'FDL No.10/2025 Art.29 — No tipping off',
      'Cabinet Res 74/2020 Art.4-7 — EOCN/CNMR',
      'MoE Circular 08/AML/2021 — CTR/DPMSR (AED 55K)',
      'Cabinet Res 134/2025 Art.19 — Internal review before STR',
      'UAE FIU goAML Filing Guidelines 2024',
    ],
    filingInstructions,
  };
}
