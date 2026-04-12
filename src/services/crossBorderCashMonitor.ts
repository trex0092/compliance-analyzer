/**
 * Cross-Border Cash & Bearer Negotiable Instrument (BNI) Monitor
 *
 * Monitors and flags cross-border movements of cash and BNIs that meet or
 * approach the UAE AED 60,000 declaration threshold.  Detects structuring
 * (smurfing) across multiple travellers or shipments.
 *
 * Regulatory: Cabinet Res 134/2025 Art.16 (AED 60K cross-border),
 *             FDL No.10/2025 Art.12-14, FATF Rec 32 (Cash Couriers),
 *             UAE Customs Law (Federal Law No. 1 of 2023 Unified Customs),
 *             MoE Circular 08/AML/2021.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** AED threshold for mandatory cross-border cash/BNI declaration */
export const CROSS_BORDER_THRESHOLD_AED = 60_000;

/** Structuring detection window: 30-day rolling */
export const STRUCTURING_WINDOW_DAYS = 30;

export type BniType =
  | 'cash'
  | 'travellers_cheque'
  | 'money_order'
  | 'bearer_bond'
  | 'prepaid_card'
  | 'crypto_equivalent';

export type CrossBorderDirection = 'inbound' | 'outbound';

export interface CrossBorderMovement {
  movementId: string;
  entityId: string;
  travellerOrCarrierId: string;
  movementDate: string; // ISO date
  direction: CrossBorderDirection;
  originCountry: string;
  destinationCountry: string;
  bniType: BniType;
  amountAED: number;
  declared: boolean;
  customsClearanceRef?: string;
  linkedMovementIds?: string[]; // for related travellers / same trip
}

export interface CrossBorderRiskInput {
  entityId: string;
  currentMovement: CrossBorderMovement;
  /** Historical movements for structuring detection (last 30 days) */
  recentMovements: CrossBorderMovement[];
}

export type CrossBorderRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CrossBorderFlag {
  type:
    | 'threshold_breach'
    | 'structuring'
    | 'undeclared'
    | 'high_risk_corridor'
    | 'multiple_travellers'
    | 'round_trip';
  severity: CrossBorderRiskLevel;
  description: string;
  amountAED: number;
  regulatoryRef: string;
}

export interface CrossBorderAssessment {
  entityId: string;
  movementId: string;
  generatedAt: string;
  overallRisk: CrossBorderRiskLevel;
  riskScore: number; // 0–100
  flags: CrossBorderFlag[];
  cumulativeAmountAED: number; // rolling 30-day total (same entity/carrier)
  structuringDetected: boolean;
  requiresDeclaration: boolean;
  requiresStr: boolean;
  requiresCtr: boolean;
  narrativeSummary: string;
  regulatoryRefs: string[];
}

// ─── High-Risk Corridors ──────────────────────────────────────────────────────

/** Countries with elevated FATF/CBCM risk for cash couriers */
const HIGH_RISK_CORRIDORS = new Set([
  'IR',
  'KP',
  'AF',
  'IQ',
  'SY',
  'LY',
  'YE',
  'SD',
  'SS',
  'CF',
  'ML',
  'NI',
  'HT',
  'MM',
  'PK',
]);

// ─── Detection Logic ──────────────────────────────────────────────────────────

function detectFlags(input: CrossBorderRiskInput): CrossBorderFlag[] {
  const flags: CrossBorderFlag[] = [];
  const mv = input.currentMovement;

  // 1. Threshold breach
  if (mv.amountAED >= CROSS_BORDER_THRESHOLD_AED) {
    if (!mv.declared) {
      flags.push({
        type: 'undeclared',
        severity: 'critical',
        description: `AED ${mv.amountAED.toLocaleString()} cross-border ${mv.bniType} NOT declared — mandatory declaration at AED 60,000 (Cabinet Res 134/2025 Art.16)`,
        amountAED: mv.amountAED,
        regulatoryRef: 'Cabinet Res 134/2025 Art.16',
      });
    } else {
      flags.push({
        type: 'threshold_breach',
        severity: 'medium',
        description: `AED ${mv.amountAED.toLocaleString()} cross-border ${mv.bniType} declared at customs — verify source of funds`,
        amountAED: mv.amountAED,
        regulatoryRef: 'Cabinet Res 134/2025 Art.16; FDL No.10/2025 Art.12',
      });
    }
  }

  // 2. Structuring — cumulative total in 30-day window
  const windowStart = new Date(mv.movementDate);
  windowStart.setDate(windowStart.getDate() - STRUCTURING_WINDOW_DAYS);

  const cumulativeAmount =
    input.recentMovements
      .filter(
        (r) =>
          r.travellerOrCarrierId === mv.travellerOrCarrierId &&
          new Date(r.movementDate) >= windowStart &&
          r.movementId !== mv.movementId
      )
      .reduce((s, r) => s + r.amountAED, 0) + mv.amountAED;

  if (cumulativeAmount >= CROSS_BORDER_THRESHOLD_AED && mv.amountAED < CROSS_BORDER_THRESHOLD_AED) {
    flags.push({
      type: 'structuring',
      severity: 'critical',
      description: `Structuring detected: cumulative AED ${cumulativeAmount.toLocaleString()} over 30 days via sub-threshold movements (individual amounts below AED 60K)`,
      amountAED: cumulativeAmount,
      regulatoryRef: 'FATF Rec 32 — Cash Couriers; FDL No.10/2025 Art.12',
    });
  }

  // 3. Multiple travellers on same trip carrying just below threshold
  const linkedMovements = input.recentMovements.filter((r) =>
    mv.linkedMovementIds?.includes(r.movementId)
  );
  if (linkedMovements.length > 0) {
    const linkedTotal = linkedMovements.reduce((s, r) => s + r.amountAED, 0) + mv.amountAED;
    if (linkedTotal >= CROSS_BORDER_THRESHOLD_AED) {
      flags.push({
        type: 'multiple_travellers',
        severity: 'critical',
        description: `Multiple travellers: combined AED ${linkedTotal.toLocaleString()} from ${linkedMovements.length + 1} carriers on linked movements`,
        amountAED: linkedTotal,
        regulatoryRef: 'FATF Rec 32 §3; FDL No.10/2025 Art.12',
      });
    }
  }

  // 4. High-risk corridor
  const corridorCountry = mv.direction === 'inbound' ? mv.originCountry : mv.destinationCountry;
  if (HIGH_RISK_CORRIDORS.has(corridorCountry)) {
    flags.push({
      type: 'high_risk_corridor',
      severity: mv.amountAED >= CROSS_BORDER_THRESHOLD_AED ? 'critical' : 'high',
      description: `Cross-border movement to/from high-risk jurisdiction ${corridorCountry} — enhanced due diligence required`,
      amountAED: mv.amountAED,
      regulatoryRef: 'Cabinet Res 134/2025 Art.7-10; FATF CBCM Guidance',
    });
  }

  // 5. Round-trip (same entity, in then out within 7 days)
  const roundTripWindow = new Date(mv.movementDate);
  roundTripWindow.setDate(roundTripWindow.getDate() - 7);
  const oppositeDirection: CrossBorderDirection =
    mv.direction === 'inbound' ? 'outbound' : 'inbound';
  const roundTrip = input.recentMovements.find(
    (r) =>
      r.travellerOrCarrierId === mv.travellerOrCarrierId &&
      r.direction === oppositeDirection &&
      new Date(r.movementDate) >= roundTripWindow
  );
  if (roundTrip) {
    flags.push({
      type: 'round_trip',
      severity: 'high',
      description: `Round-trip cash movement: ${oppositeDirection} AED ${roundTrip.amountAED.toLocaleString()} within 7 days`,
      amountAED: mv.amountAED,
      regulatoryRef: 'FATF Rec 32; FDL No.10/2025 Art.12',
    });
  }

  return flags;
}

function riskLevelFromScore(score: number): CrossBorderRiskLevel {
  if (score >= 70) return 'critical';
  if (score >= 45) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function monitorCrossBorderCash(input: CrossBorderRiskInput): CrossBorderAssessment {
  const flags = detectFlags(input);
  const mv = input.currentMovement;

  const severityScores: Record<CrossBorderRiskLevel, number> = {
    critical: 40,
    high: 25,
    medium: 15,
    low: 5,
  };
  const riskScore = Math.min(
    100,
    flags.reduce((s, f) => s + severityScores[f.severity], 0)
  );
  const overallRisk = riskLevelFromScore(riskScore);

  const windowStart = new Date(mv.movementDate);
  windowStart.setDate(windowStart.getDate() - STRUCTURING_WINDOW_DAYS);
  const cumulativeAmountAED =
    input.recentMovements
      .filter(
        (r) =>
          r.travellerOrCarrierId === mv.travellerOrCarrierId &&
          new Date(r.movementDate) >= windowStart
      )
      .reduce((s, r) => s + r.amountAED, 0) + mv.amountAED;

  const structuringDetected = flags.some(
    (f) => f.type === 'structuring' || f.type === 'multiple_travellers'
  );
  const requiresDeclaration = mv.amountAED >= CROSS_BORDER_THRESHOLD_AED;
  const requiresStr = flags.some((f) => f.severity === 'critical') || structuringDetected;
  const requiresCtr = requiresDeclaration && mv.bniType === 'cash';

  const narrativeSummary =
    `Movement ${mv.movementId} (${mv.direction}, AED ${mv.amountAED.toLocaleString()}): ` +
    `risk ${overallRisk.toUpperCase()} (score ${riskScore}/100). ` +
    `${flags.length} flag(s). 30-day cumulative: AED ${cumulativeAmountAED.toLocaleString()}. ` +
    `Structuring: ${structuringDetected}. STR required: ${requiresStr}.`;

  return {
    entityId: input.entityId,
    movementId: mv.movementId,
    generatedAt: new Date().toISOString(),
    overallRisk,
    riskScore,
    flags,
    cumulativeAmountAED,
    structuringDetected,
    requiresDeclaration,
    requiresStr,
    requiresCtr,
    narrativeSummary,
    regulatoryRefs: [
      'Cabinet Res 134/2025 Art.16 — AED 60,000 cross-border cash declaration',
      'FDL No.10/2025 Art.12-14 — CDD and reporting',
      'FATF Recommendation 32 — Cash Couriers',
      'UAE Federal Law No. 1 of 2023 — Unified Customs Law',
      'MoE Circular 08/AML/2021',
    ],
  };
}
