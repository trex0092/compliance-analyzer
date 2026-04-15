/**
 * TM Rule Engine — deterministic UAE threshold rules fired per
 * transaction. These rules are the "hard" floor: a hit here is not
 * a model guess, it's a regulatory bright line (AED 55K DPMS CTR,
 * AED 60K cross-border cash, round-number structuring, etc.).
 *
 * Pure function. Takes a list of transactions + optional high-risk
 * jurisdiction list, returns findings. The orchestrator feeds these
 * into the verdict roll-up alongside the statistical + typology
 * layers.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.15      (suspicious transaction monitoring)
 *   FDL No.10/2025 Art.16      (cross-border cash AED 60K)
 *   FDL No.10/2025 Art.26-27   (STR filing 10 business days)
 *   MoE Circular 08/AML/2021   (DPMS AED 55K cash CTR)
 *   FATF Rec 10, 20, 21        (ongoing monitoring + STR)
 *   FATF Typologies Report 2021 — Gold & Precious Metals
 */

import {
  CROSS_BORDER_CASH_DECLARATION_AED,
  DPMS_CASH_CTR_THRESHOLD_AED,
  STRUCTURING_BELOW_PERCENT,
  type TmFinding,
  type Transaction,
} from '../domain/transaction';

// ---------------------------------------------------------------------------
// High-risk jurisdictions — FATF grey + black list + UAE-specific
// ---------------------------------------------------------------------------

/**
 * Default high-risk jurisdiction list for the gold / precious-metals
 * sector. Caller may pass a different list (e.g. for a non-DPMS
 * tenant or to reflect an updated FATF statement). ISO-3166 alpha-2.
 *
 * Sources at time of writing (April 2026):
 *   - FATF high-risk jurisdictions (black list): KP, IR, MM
 *   - FATF jurisdictions under increased monitoring (grey list):
 *     AL, BA, BF, CM, HR, DO, GB*, HT, JM, ML, MZ, NG, PH, SN, SY,
 *     SS, TZ, TR, UG, VE, YE
 *   - UAE-specific high-risk for precious metals: VE, CD, RW, SD,
 *     ZW (conflict-gold transit routes)
 *
 * (*) GB listed by FATF in 2024; subject to quarterly review.
 */
export const DEFAULT_HIGH_RISK_JURISDICTIONS: readonly string[] = [
  'KP',
  'IR',
  'MM',
  'AL',
  'BA',
  'BF',
  'CM',
  'HR',
  'DO',
  'HT',
  'JM',
  'ML',
  'MZ',
  'NG',
  'PH',
  'SN',
  'SY',
  'SS',
  'TZ',
  'TR',
  'UG',
  'VE',
  'YE',
  'CD',
  'RW',
  'SD',
  'ZW',
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortHash(input: string): string {
  // Trivial hash for finding ids. Good enough to be stable per session
  // and unique within a scan batch. Not cryptographic.
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function makeFindingId(customerId: string, kind: string, txIds: readonly string[]): string {
  const sorted = [...txIds].sort().join(',');
  return `${customerId}:${kind}:${shortHash(sorted)}`;
}

function isRoundNumber(amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  // Round to 10K, 50K, 100K, 500K, 1M granularity.
  const thresholds = [10_000, 50_000, 100_000, 500_000, 1_000_000];
  return thresholds.some((t) => amount % t === 0);
}

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

/**
 * Rule 1 — DPMS cash CTR threshold (MoE Circular 08/AML/2021).
 * Any single cash transaction ≥ AED 55,000 is mandatory reportable
 * to goAML regardless of customer tier.
 */
function ruleCtrThreshold(tx: Transaction): TmFinding | null {
  if (tx.instrument !== 'cash') return null;
  if (tx.amountAed < DPMS_CASH_CTR_THRESHOLD_AED) return null;
  return {
    id: makeFindingId(tx.customerId, 'ctr-threshold-hit', [tx.id]),
    customerId: tx.customerId,
    kind: 'ctr-threshold-hit',
    severity: 'high',
    message: `Cash transaction of AED ${tx.amountAed.toLocaleString('en-AE')} meets or exceeds the DPMS CTR threshold (AED ${DPMS_CASH_CTR_THRESHOLD_AED.toLocaleString('en-AE')}). File a CTR via goAML within 15 business days.`,
    regulatory: 'MoE Circular 08/AML/2021 / FDL Art.15',
    triggeringTxIds: [tx.id],
    confidence: 1.0,
    suggestedAction: 'flag',
  };
}

/**
 * Rule 2 — structuring / just-below detection for CTR.
 * Flags cash transactions that land in the 5% band just under the
 * CTR threshold (AED 52,250 .. 54,999). Pattern is classic smurfing.
 */
function ruleCtrJustBelow(tx: Transaction): TmFinding | null {
  if (tx.instrument !== 'cash') return null;
  const threshold = DPMS_CASH_CTR_THRESHOLD_AED;
  const bandFloor = threshold * (1 - STRUCTURING_BELOW_PERCENT);
  if (tx.amountAed < bandFloor || tx.amountAed >= threshold) return null;
  return {
    id: makeFindingId(tx.customerId, 'ctr-threshold-just-below', [tx.id]),
    customerId: tx.customerId,
    kind: 'ctr-threshold-just-below',
    severity: 'high',
    message: `Cash transaction of AED ${tx.amountAed.toLocaleString('en-AE')} is within the ${(STRUCTURING_BELOW_PERCENT * 100).toFixed(0)}% structuring band just below the DPMS CTR threshold. Potential smurfing — investigate.`,
    regulatory: 'MoE Circular 08/AML/2021 / FATF Rec 20 (structuring)',
    triggeringTxIds: [tx.id],
    confidence: 0.85,
    suggestedAction: 'escalate',
  };
}

/**
 * Rule 3 — cross-border cash AED 60,000 declaration threshold
 * (FDL Art.16). Any physical cross-border cash movement at or above
 * this value requires a customs declaration.
 */
function ruleCrossBorderCashOver(tx: Transaction): TmFinding | null {
  if (tx.instrument !== 'cash') return null;
  if (!tx.isCrossBorder) return null;
  if (tx.amountAed < CROSS_BORDER_CASH_DECLARATION_AED) return null;
  return {
    id: makeFindingId(tx.customerId, 'cross-border-cash-over-60k', [tx.id]),
    customerId: tx.customerId,
    kind: 'cross-border-cash-over-60k',
    severity: 'critical',
    message: `Cross-border cash movement of AED ${tx.amountAed.toLocaleString('en-AE')} meets or exceeds the AED ${CROSS_BORDER_CASH_DECLARATION_AED.toLocaleString('en-AE')} customs declaration threshold. Verify declaration exists; if not, file CNMR.`,
    regulatory: 'FDL Art.16 / Cabinet Res 74/2020',
    triggeringTxIds: [tx.id],
    confidence: 1.0,
    suggestedAction: 'escalate',
  };
}

/**
 * Rule 4 — just-below structuring on cross-border declaration.
 */
function ruleCrossBorderCashJustBelow(tx: Transaction): TmFinding | null {
  if (tx.instrument !== 'cash') return null;
  if (!tx.isCrossBorder) return null;
  const threshold = CROSS_BORDER_CASH_DECLARATION_AED;
  const bandFloor = threshold * (1 - STRUCTURING_BELOW_PERCENT);
  if (tx.amountAed < bandFloor || tx.amountAed >= threshold) return null;
  return {
    id: makeFindingId(tx.customerId, 'cross-border-cash-just-below', [tx.id]),
    customerId: tx.customerId,
    kind: 'cross-border-cash-just-below',
    severity: 'high',
    message: `Cross-border cash movement of AED ${tx.amountAed.toLocaleString('en-AE')} is within the ${(STRUCTURING_BELOW_PERCENT * 100).toFixed(0)}% structuring band below the declaration threshold.`,
    regulatory: 'FDL Art.16 / FATF Rec 20',
    triggeringTxIds: [tx.id],
    confidence: 0.8,
    suggestedAction: 'escalate',
  };
}

/**
 * Rule 5 — round-number cash trigger. Cash transactions whose AED
 * value is an exact round number (10K/50K/100K/500K/1M) are a
 * typology red flag (not a guarantee, but worth a flag). Only fires
 * when the amount is at least AED 10K to avoid flagging petty cash.
 */
function ruleRoundNumberCash(tx: Transaction): TmFinding | null {
  if (tx.instrument !== 'cash') return null;
  if (tx.amountAed < 10_000) return null;
  if (!isRoundNumber(tx.amountAed)) return null;
  return {
    id: makeFindingId(tx.customerId, 'round-number-cash', [tx.id]),
    customerId: tx.customerId,
    kind: 'round-number-cash',
    severity: 'low',
    message: `Round-number cash transaction of AED ${tx.amountAed.toLocaleString('en-AE')}. Typology red flag — check business rationale.`,
    regulatory: 'FATF Typologies Report 2021 (Gold & Precious Metals)',
    triggeringTxIds: [tx.id],
    confidence: 0.55,
    suggestedAction: 'monitor',
  };
}

/**
 * Rule 6 — high-risk jurisdiction counterparty. Flags any transaction
 * whose counterparty country is on the FATF high-risk list (or the
 * caller-supplied override).
 */
function ruleHighRiskJurisdiction(
  tx: Transaction,
  highRiskList: readonly string[]
): TmFinding | null {
  if (!tx.counterpartyCountry) return null;
  if (!highRiskList.includes(tx.counterpartyCountry)) return null;
  return {
    id: makeFindingId(tx.customerId, 'high-risk-jurisdiction', [tx.id]),
    customerId: tx.customerId,
    kind: 'high-risk-jurisdiction',
    severity: 'medium',
    message: `Counterparty in high-risk jurisdiction ${tx.counterpartyCountry} (${tx.counterpartyName}). Enhanced due diligence required.`,
    regulatory: 'FATF Rec 19 / Cabinet Res 134/2025 Art.14',
    triggeringTxIds: [tx.id],
    confidence: 0.9,
    suggestedAction: 'escalate',
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface RuleEngineOptions {
  readonly highRiskJurisdictions?: readonly string[];
}

/**
 * Run the deterministic rule engine over a batch of transactions.
 * Pure function. Returns every finding across every rule × tx.
 *
 * Duplicate finding ids are automatically coalesced — if a tx
 * triggers the same rule twice via different code paths, only the
 * first finding is kept.
 */
export function runRuleEngine(
  transactions: readonly Transaction[],
  options: RuleEngineOptions = {}
): readonly TmFinding[] {
  const highRiskList = options.highRiskJurisdictions ?? DEFAULT_HIGH_RISK_JURISDICTIONS;
  const seen = new Set<string>();
  const out: TmFinding[] = [];

  const rules: Array<(tx: Transaction) => TmFinding | null> = [
    ruleCtrThreshold,
    ruleCtrJustBelow,
    ruleCrossBorderCashOver,
    ruleCrossBorderCashJustBelow,
    ruleRoundNumberCash,
    (tx) => ruleHighRiskJurisdiction(tx, highRiskList),
  ];

  for (const tx of transactions) {
    for (const rule of rules) {
      const finding = rule(tx);
      if (finding && !seen.has(finding.id)) {
        seen.add(finding.id);
        out.push(finding);
      }
    }
  }

  return out;
}
