/**
 * Verdict Drift Monitor — subsystem #55.
 *
 * Catches prompt injection, model upgrade regressions, and data drift
 * by comparing the current week's verdict distribution to a rolling
 * baseline (default: 12 weeks). If the distribution shifts by more
 * than a configurable chi-square threshold, the monitor fires an
 * alert so the MLRO can investigate whether the brain has quietly
 * changed its behaviour.
 *
 * Important: this is a META-signal that watches the brain itself, not
 * any particular case. A single drift alert does NOT flip any case
 * verdict — it's advisory to the operations team. That separation is
 * deliberate: regulatory logic never auto-changes based on drift.
 *
 * Regulatory basis:
 *   - NIST AI RMF MS-2.1 (drift detection)
 *   - EU AI Act Art.72 (post-market monitoring)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface VerdictDistribution {
  pass: number;
  flag: number;
  escalate: number;
  freeze: number;
}

export interface DriftInput {
  /** The current week's verdict counts. */
  currentWeek: VerdictDistribution;
  /** Baseline = average counts per week over the last N weeks. */
  baseline: VerdictDistribution;
  /** Optional chi-square critical value. Default: 7.815 (p=0.05, df=3). */
  criticalChi2?: number;
}

export interface DriftReport {
  hasDrift: boolean;
  chiSquare: number;
  criticalValue: number;
  shifts: {
    verdict: Verdict;
    observed: number;
    expected: number;
    delta: number;
  }[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

export function detectVerdictDrift(input: DriftInput): DriftReport {
  const criticalValue = input.criticalChi2 ?? 7.815;
  const verdicts: Verdict[] = ['pass', 'flag', 'escalate', 'freeze'];

  // Chi-square against the baseline as an expectation
  let chi = 0;
  const shifts: DriftReport['shifts'] = [];

  for (const v of verdicts) {
    const observed = input.currentWeek[v];
    const expected = input.baseline[v];
    if (expected <= 0) continue;
    const diff = observed - expected;
    chi += (diff * diff) / expected;
    shifts.push({
      verdict: v,
      observed,
      expected: Math.round(expected * 100) / 100,
      delta: Math.round(diff * 100) / 100,
    });
  }

  const hasDrift = chi > criticalValue;
  const narrative = hasDrift
    ? `Verdict drift detected: CHI^2=${chi.toFixed(2)} > critical ${criticalValue} (p=0.05, df=3). ` +
      `Largest shifts: ${shifts
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 2)
        .map((s) => `${s.verdict} ${s.delta >= 0 ? '+' : ''}${s.delta}`)
        .join(', ')}. Investigate per NIST AI RMF MS-2.1.`
    : `Verdict drift: CHI^2=${chi.toFixed(2)} <= critical ${criticalValue}. Distribution stable.`;

  return {
    hasDrift,
    chiSquare: Math.round(chi * 100) / 100,
    criticalValue,
    shifts,
    narrative,
  };
}
