/**
 * Transaction domain model — input to the Transaction Monitoring
 * Brain (TM Brain) for continuous scanning of customer activity.
 *
 * Why this exists:
 *   The existing Hawkeye Sterling brain is reactive — a human
 *   triggers a screen on a customer, the brain returns a verdict.
 *   Transaction monitoring is proactive: a daily cron walks every
 *   customer's recent transactions and flags anomalies before the
 *   MLRO sees them. To do that we need a canonical Transaction
 *   type + a TMVerdict output that composes with the existing
 *   orchestrator (so TM findings land in the same Asana sections
 *   as CDD findings).
 *
 *   Pure types + regulatory constants + pure helpers. No I/O.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.15     (suspicious transaction monitoring)
 *   FDL No.10/2025 Art.16     (cross-border cash AED 60K threshold)
 *   FDL No.10/2025 Art.26-27  (STR filing within 10 business days
 *                               of suspicion)
 *   Cabinet Res 134/2025 Art.14 (ongoing monitoring of EDD customers)
 *   MoE Circular 08/AML/2021  (DPMS AED 55K CTR threshold via goAML)
 *   FATF Rec 10, 11, 20, 21   (ongoing CDD + record keeping + STR)
 */

import type { CountryCodeIso2, DateDdMmYyyy, IsoTimestamp } from './customerProfile';
import {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
} from './constants';

// ---------------------------------------------------------------------------
// Regulatory thresholds — re-exported from ./constants (single source of truth).
// Do NOT define regulatory values literally here; update ./constants and
// REGULATORY_CONSTANTS_VERSION if a regulation changes.
// ---------------------------------------------------------------------------

/**
 * MoE Circular 08/AML/2021 — DPMS sector cash transaction reporting
 * threshold. Any cash transaction at or above this value triggers a
 * mandatory CTR filing via goAML.
 *
 * Re-export of `DPMS_CASH_THRESHOLD_AED` from ./constants. This alias
 * preserves the local name existing TM rule callers import.
 */
export const DPMS_CASH_CTR_THRESHOLD_AED = DPMS_CASH_THRESHOLD_AED;

/**
 * FDL Art.16 / Cabinet Res 134/2025 Art.16 — cross-border cash/BNI
 * (bearer negotiable instrument) declaration threshold. Any physical
 * cross-border movement at or above this value requires a customs
 * declaration.
 *
 * Re-export of `CROSS_BORDER_CASH_THRESHOLD_AED` from ./constants.
 */
export const CROSS_BORDER_CASH_DECLARATION_AED = CROSS_BORDER_CASH_THRESHOLD_AED;

/**
 * Structuring detection: any amount that lands within this band
 * below a threshold is treated as "just-below", indicating a
 * possible structuring / smurfing attempt. 5% is the standard
 * FATF / FinCEN rule of thumb.
 */
export const STRUCTURING_BELOW_PERCENT = 0.05;

/**
 * Velocity threshold: N transactions within 24 hours of each other
 * against the same counterparty is a velocity anomaly (FATF Rec 20).
 */
export const VELOCITY_24H_COUNT_THRESHOLD = 5;

/**
 * STR / SAR filing deadline in business days from the day the
 * suspicion is raised. Per FDL Art.26-27.
 */
export const STR_FILING_BUSINESS_DAYS = 10;

// ---------------------------------------------------------------------------
// Transaction types
// ---------------------------------------------------------------------------

export type TransactionDirection = 'debit' | 'credit';
export type TransactionInstrument = 'cash' | 'wire' | 'card' | 'cheque' | 'crypto' | 'other';
export type TransactionChannel =
  | 'branch'
  | 'atm'
  | 'online'
  | 'mobile'
  | 'remittance-house'
  | 'courier'
  | 'in-person'
  | 'other';

/**
 * A single transaction record attached to a customer. The monitor
 * accepts an array of these and produces a TMVerdict per customer.
 *
 * `amountAed` is the normalised AED value — the caller converts
 * from the original currency using the published CBUAE rate per
 * CLAUDE.md §7.
 */
export interface Transaction {
  readonly id: string;
  readonly customerId: string;
  /** ISO 8601 timestamp. */
  readonly atIso: IsoTimestamp;
  /** Human-readable dd/mm/yyyy for display + audit. */
  readonly dateDdMmYyyy: DateDdMmYyyy;
  readonly direction: TransactionDirection;
  readonly instrument: TransactionInstrument;
  readonly channel: TransactionChannel;
  /** Original currency code (ISO 4217). */
  readonly currency: string;
  /** Original-currency amount. */
  readonly amount: number;
  /** Normalised AED amount — the rule engine operates on this. */
  readonly amountAed: number;
  /** Counterparty name (free text, may be a bank, a person, a company). */
  readonly counterpartyName: string;
  /**
   * Counterparty country. Empty string if unknown. The rule engine
   * uses this for high-risk jurisdiction flags.
   */
  readonly counterpartyCountry: CountryCodeIso2 | '';
  /** Optional text reference / memo line attached to the transaction. */
  readonly reference?: string;
  /** True if the transaction crosses a border (origin ≠ destination). */
  readonly isCrossBorder: boolean;
  /**
   * Optional geo stamp — e.g. `{ city: "Dubai", country: "AE" }` —
   * used by the cross-border detector and the high-risk location
   * matcher.
   */
  readonly originLocation?: { city?: string; country: CountryCodeIso2 };
  readonly destinationLocation?: { city?: string; country: CountryCodeIso2 };
}

// ---------------------------------------------------------------------------
// TM verdict types
// ---------------------------------------------------------------------------

export type TmVerdict = 'pass' | 'flag' | 'escalate' | 'freeze' | 'auto-str';

export type TmFindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type TmFindingKind =
  // Rule engine
  | 'ctr-threshold-hit'
  | 'ctr-threshold-just-below'
  | 'cross-border-cash-over-60k'
  | 'cross-border-cash-just-below'
  | 'round-number-cash'
  | 'high-risk-jurisdiction'
  // Statistical
  | 'velocity-burst'
  | 'dormancy-break'
  | 'amount-zscore-outlier'
  | 'peer-anomaly'
  | 'benford-first-digit-drift'
  // Typology
  | 'smurfing'
  | 'layering'
  | 'round-trip'
  | 'tbml-price-anomaly'
  | 'hawala-pattern'
  | 'shell-passthrough';

/**
 * A single finding emitted by the TM brain. The orchestrator
 * aggregates findings per customer → one TMVerdict.
 */
export interface TmFinding {
  /** Stable id for idempotency: `${customerId}:${kind}:${sha256(sortedTxIds)}`. */
  readonly id: string;
  readonly customerId: string;
  readonly kind: TmFindingKind;
  readonly severity: TmFindingSeverity;
  /** Plain-English explanation for the MLRO. */
  readonly message: string;
  /** Regulatory anchor (article or FATF rec). */
  readonly regulatory: string;
  /** Transaction ids that triggered this finding. Empty for bucket-level findings. */
  readonly triggeringTxIds: readonly string[];
  /** Model confidence in [0, 1]. 1.0 for hard threshold rules, variable for statistical + typology. */
  readonly confidence: number;
  /** Suggested action — the orchestrator uses this to derive the verdict. */
  readonly suggestedAction: 'monitor' | 'flag' | 'escalate' | 'freeze' | 'auto-str';
}

export interface TmVerdictRecord {
  readonly schemaVersion: 1;
  readonly customerId: string;
  readonly evaluatedAtIso: IsoTimestamp;
  /** Transaction window evaluated (inclusive). */
  readonly windowStartIso: IsoTimestamp;
  readonly windowEndIso: IsoTimestamp;
  readonly scannedTxCount: number;
  readonly verdict: TmVerdict;
  readonly findings: readonly TmFinding[];
  /** Highest severity across all findings. */
  readonly topSeverity: TmFindingSeverity;
  /**
   * Deadline to file an STR if `verdict === 'auto-str'`. Computed by
   * the business-days util using FDL Art.26-27 → 10 business days
   * from `evaluatedAtIso`.
   */
  readonly strFilingDeadlineDdMmYyyy?: DateDdMmYyyy;
  readonly summary: string;
  readonly regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compare two severities. Returns the highest (most severe). Used by
 * the orchestrator to roll per-finding severities up to a verdict-
 * level top severity.
 */
export function maxSeverity(a: TmFindingSeverity, b: TmFindingSeverity): TmFindingSeverity {
  const order: TmFindingSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
  return order.indexOf(a) > order.indexOf(b) ? a : b;
}

/**
 * Roll a list of findings up to the top severity. Empty list → `info`.
 */
export function topSeverityOf(findings: readonly TmFinding[]): TmFindingSeverity {
  if (findings.length === 0) return 'info';
  return findings.reduce<TmFindingSeverity>((acc, f) => maxSeverity(acc, f.severity), 'info');
}

/**
 * Map a top severity + suggested-action mix to a TM verdict. Pure.
 *
 * The orchestrator uses a simple precedence ladder so operator-facing
 * behaviour stays predictable:
 *
 *   - Any finding suggesting auto-str → 'auto-str' (highest)
 *   - Any finding suggesting freeze   → 'freeze'
 *   - Any finding suggesting escalate → 'escalate'
 *   - Any finding at 'high' or above  → 'escalate'
 *   - Any finding at 'medium'         → 'flag'
 *   - Otherwise                        → 'pass'
 */
export function rollUpVerdict(findings: readonly TmFinding[]): TmVerdict {
  if (findings.length === 0) return 'pass';
  const actions = findings.map((f) => f.suggestedAction);
  if (actions.includes('auto-str')) return 'auto-str';
  if (actions.includes('freeze')) return 'freeze';
  if (actions.includes('escalate')) return 'escalate';
  const top = topSeverityOf(findings);
  if (top === 'high' || top === 'critical') return 'escalate';
  if (top === 'medium') return 'flag';
  return 'pass';
}

/**
 * Cluster transactions into 24-hour velocity windows. Returns arrays
 * of transaction ids that happened within a 24h window of each other.
 * Pure — caller injects the transaction list pre-sorted by `atIso`.
 */
export function clusterByVelocity(
  txs: readonly Transaction[],
  windowMs = 24 * 60 * 60 * 1000
): readonly (readonly string[])[] {
  if (txs.length === 0) return [];
  const sorted = [...txs].sort((a, b) => Date.parse(a.atIso) - Date.parse(b.atIso));
  const clusters: string[][] = [];
  let current: string[] = [];
  let currentStart = 0;
  for (const tx of sorted) {
    const t = Date.parse(tx.atIso);
    if (current.length === 0) {
      current = [tx.id];
      currentStart = t;
      continue;
    }
    if (t - currentStart <= windowMs) {
      current.push(tx.id);
    } else {
      clusters.push(current);
      current = [tx.id];
      currentStart = t;
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}
