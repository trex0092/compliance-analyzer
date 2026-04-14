/**
 * Clamp Suggestion Log — MLRO-reviewed suggestions for brain
 * clamp-threshold tuning.
 *
 * Why this exists:
 *   The brain has several clamp thresholds (sanctions match min,
 *   ensemble stability threshold, uncertainty width bands, debate
 *   threshold). A self-improving system would auto-tune these from
 *   live data — we intentionally DO NOT do that because an
 *   auto-tuned regulator threshold is a compliance liability.
 *
 *   This module is the safe alternative. It collects empirical
 *   signals (false positives, false negatives, uncertainty drift)
 *   and proposes candidate tweaks as pending suggestions. Every
 *   suggestion lands in a log with status `pending_mlro_review`
 *   — never applied automatically. The MLRO opens a dashboard,
 *   reviews the suggestion against the evidence, and manually
 *   flips the status to `accepted` / `rejected` / `deferred`.
 *
 *   Pure function. No network. No auto-apply.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO must consciously set thresholds)
 *   FDL No.10/2025 Art.24    (10-year retention on the log)
 *   Cabinet Res 134/2025 Art.19 (internal review — suggestions
 *                                 are review inputs)
 *   NIST AI RMF 1.0 GOVERN-4  (AI governance — threshold owners)
 *   EU AI Act Art.14          (human oversight, high-risk AI)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClampKey =
  | 'sanctionsMatchMin'
  | 'ensembleStabilityThreshold'
  | 'uncertaintyCriticalWidth'
  | 'debateThreshold'
  | 'dpmsCashThresholdAED'
  | 'crossBorderCashThresholdAED';

export type SuggestionStatus = 'pending_mlro_review' | 'accepted' | 'rejected' | 'deferred';

export interface ClampSuggestion {
  id: string;
  clampKey: ClampKey;
  currentValue: number;
  proposedValue: number;
  /** Delta in absolute units. */
  delta: number;
  /** Evidence count contributing to the suggestion. */
  evidenceCount: number;
  /** Plain-English rationale. */
  rationale: string;
  status: SuggestionStatus;
  createdAtIso: string;
  regulatory: string;
}

export interface EvidenceSignal {
  /** True positive = brain correctly flagged. */
  truePositive: number;
  /** False positive = brain flagged a clean case. */
  falsePositive: number;
  /** False negative = brain missed a real case. */
  falseNegative: number;
  /** Total cases scored against this clamp. */
  totalCases: number;
}

// ---------------------------------------------------------------------------
// Suggestion builder — pure function
// ---------------------------------------------------------------------------

export interface BuildSuggestionInput {
  clampKey: ClampKey;
  currentValue: number;
  /** Minimum acceptable value — suggestion clamped to this. */
  minValue: number;
  /** Maximum acceptable value — suggestion clamped to this. */
  maxValue: number;
  /** Step the suggestion may move in a single round. */
  step: number;
  evidence: EvidenceSignal;
  now?: () => Date;
  regulatory: string;
}

/**
 * Propose a candidate clamp tweak based on false-positive /
 * false-negative rates. Returns null when evidence does not
 * support any movement.
 */
export function buildClampSuggestion(input: BuildSuggestionInput): ClampSuggestion | null {
  const { evidence, currentValue, minValue, maxValue, step } = input;
  if (evidence.totalCases < 10) return null; // Not enough data.

  const fpRate = evidence.falsePositive / evidence.totalCases;
  const fnRate = evidence.falseNegative / evidence.totalCases;

  let proposed = currentValue;
  let rationale = '';

  // High FP rate → raise the clamp (require more evidence to flag).
  if (fpRate >= 0.2 && fpRate > fnRate * 2) {
    proposed = Math.min(maxValue, currentValue + step);
    rationale =
      `FP rate ${(fpRate * 100).toFixed(1)}% over ${evidence.totalCases} cases ` +
      `exceeds 20% and is 2x FN rate. Proposing clamp raise by ${step} to ` +
      `reduce false positives (FATF Rec 10 proportionality).`;
  }
  // High FN rate → lower the clamp (flag more aggressively).
  else if (fnRate >= 0.05 && fnRate > fpRate * 2) {
    proposed = Math.max(minValue, currentValue - step);
    rationale =
      `FN rate ${(fnRate * 100).toFixed(1)}% over ${evidence.totalCases} cases ` +
      `exceeds 5% and is 2x FP rate. Proposing clamp reduction by ${step} to ` +
      `catch more real cases (FDL Art.20 CO duty of care).`;
  } else {
    return null;
  }

  if (proposed === currentValue) return null;

  const now = input.now ?? (() => new Date());
  return {
    id: `suggestion:${input.clampKey}:${now().getTime()}`,
    clampKey: input.clampKey,
    currentValue,
    proposedValue: proposed,
    delta: proposed - currentValue,
    evidenceCount: evidence.totalCases,
    rationale,
    status: 'pending_mlro_review',
    createdAtIso: now().toISOString(),
    regulatory: input.regulatory,
  };
}

// ---------------------------------------------------------------------------
// In-memory log — suggestions survive across builds inside a single
// process; production wires this to Netlify Blob storage.
// ---------------------------------------------------------------------------

export class ClampSuggestionLog {
  private readonly entries: ClampSuggestion[] = [];

  append(s: ClampSuggestion): void {
    this.entries.push({ ...s });
  }

  /** Read all entries. Snapshot — mutations to the return array do not affect the log. */
  all(): readonly ClampSuggestion[] {
    return this.entries.slice();
  }

  /** Read entries with a specific status. */
  byStatus(status: SuggestionStatus): readonly ClampSuggestion[] {
    return this.entries.filter((e) => e.status === status);
  }

  /**
   * MLRO decision — flip a suggestion's status. Never throws; missing
   * ids return false so callers can distinguish "unknown" from "ok".
   */
  decide(id: string, status: Exclude<SuggestionStatus, 'pending_mlro_review'>): boolean {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx < 0) return false;
    this.entries[idx] = { ...this.entries[idx]!, status };
    return true;
  }

  size(): number {
    return this.entries.length;
  }
}
