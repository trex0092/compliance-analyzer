/**
 * Sandbox Replay — re-run a historical case against ANY constants
 * version (not just current), for what-if analysis.
 *
 * Why this exists:
 *   src/services/caseReplayStore.ts already supports replaying a
 *   stored case against the CURRENT regulatory baseline. That answers
 *   "would this verdict change under today's rules?" but not the more
 *   interesting question: "would this verdict have been different if
 *   we had had next quarter's proposed AED 50K threshold?".
 *
 *   This module is the sandbox layer. It takes a stored case + an
 *   ARBITRARY regulatory baseline (not the current one) and re-runs
 *   the verdict computation. It is PURE — no I/O, no global state.
 *   The baseline is passed in by the caller; the caller resolves it
 *   from a specific historical snapshot, a draft constants file, or
 *   even a hand-crafted what-if vector.
 *
 *   This unlocks:
 *     - "Show me the impact of dropping AED 55K to AED 50K across
 *       last quarter."
 *     - "What if Cabinet Res 156/2025 PF threshold was applied
 *       retroactively?"
 *     - "Run this case under the EU 6AMLD baseline."
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reasoned what-if analysis)
 *   FDL No.10/2025 Art.24    (audit trail of every replay)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   FATF Rec 1               (continuous risk assessment)
 *   NIST AI RMF 1.0 MEASURE-4 (validation + counterfactual replay)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal stored-case shape — every field below is required. */
export interface StoredCase {
  id: string;
  tenantId: string;
  decidedAtIso: string;
  features: Record<string, number>;
  /** Verdict as decided originally. */
  verdictAtTime: 'pass' | 'flag' | 'escalate' | 'freeze';
}

/**
 * Arbitrary regulatory baseline — the same shape the live constants
 * exporter uses, but trimmed to the keys the sandbox cares about.
 */
export interface SandboxBaseline {
  /** Human-friendly version label. */
  versionLabel: string;
  /** Captured-at ISO timestamp (or "draft"). */
  capturedAtIso: string;
  /** Threshold values (AED). */
  thresholds: Record<string, number>;
  /** Citation that justifies this baseline. */
  citation: string;
}

/** Function that maps (features, baseline) → verdict. Pure. */
export type SandboxVerdictFn = (
  features: Readonly<Record<string, number>>,
  baseline: Readonly<SandboxBaseline>
) => { verdict: StoredCase['verdictAtTime']; confidence: number };

export interface SandboxReplayResult {
  schemaVersion: 1;
  caseId: string;
  baselineLabel: string;
  /** Verdict the case originally produced. */
  originalVerdict: StoredCase['verdictAtTime'];
  /** Verdict the case produces under the sandbox baseline. */
  replayedVerdict: StoredCase['verdictAtTime'];
  /** Confidence under the sandbox baseline. */
  replayedConfidence: number;
  /** Did the verdict change? */
  changed: boolean;
  /**
   * Coarse impact band:
   *   - none      : no change
   *   - softened  : verdict moved DOWN the severity ladder
   *   - hardened  : verdict moved UP the severity ladder
   */
  impact: 'none' | 'softened' | 'hardened';
  finding: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<StoredCase['verdictAtTime'], number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function sandboxReplayCase(
  storedCase: StoredCase,
  baseline: SandboxBaseline,
  verdictFn: SandboxVerdictFn
): SandboxReplayResult {
  const result = verdictFn(storedCase.features, baseline);
  const changed = result.verdict !== storedCase.verdictAtTime;
  let impact: SandboxReplayResult['impact'] = 'none';
  if (changed) {
    impact =
      VERDICT_RANK[result.verdict] < VERDICT_RANK[storedCase.verdictAtTime]
        ? 'softened'
        : 'hardened';
  }
  return {
    schemaVersion: 1,
    caseId: storedCase.id,
    baselineLabel: baseline.versionLabel,
    originalVerdict: storedCase.verdictAtTime,
    replayedVerdict: result.verdict,
    replayedConfidence: result.confidence,
    changed,
    impact,
    finding: changed
      ? `Case ${storedCase.id} ${impact} under "${baseline.versionLabel}" baseline ` +
        `(${storedCase.verdictAtTime} → ${result.verdict}).`
      : `Case ${storedCase.id} stable under "${baseline.versionLabel}" baseline.`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 1',
      'NIST AI RMF 1.0 MEASURE-4',
    ],
  };
}

export interface SandboxBatchReport {
  schemaVersion: 1;
  baselineLabel: string;
  total: number;
  changed: number;
  hardened: number;
  softened: number;
  results: readonly SandboxReplayResult[];
  summary: string;
  regulatory: readonly string[];
}

export function sandboxReplayBatch(
  cases: readonly StoredCase[],
  baseline: SandboxBaseline,
  verdictFn: SandboxVerdictFn
): SandboxBatchReport {
  const results = cases.map((c) => sandboxReplayCase(c, baseline, verdictFn));
  const changed = results.filter((r) => r.changed).length;
  const hardened = results.filter((r) => r.impact === 'hardened').length;
  const softened = results.filter((r) => r.impact === 'softened').length;

  return {
    schemaVersion: 1,
    baselineLabel: baseline.versionLabel,
    total: cases.length,
    changed,
    hardened,
    softened,
    results,
    summary:
      `Sandbox replay against "${baseline.versionLabel}": ${changed}/${cases.length} ` +
      `verdicts changed (${hardened} hardened, ${softened} softened).`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 MEASURE-4',
    ],
  };
}

// Exports for tests.
export const __test__ = { VERDICT_RANK };
