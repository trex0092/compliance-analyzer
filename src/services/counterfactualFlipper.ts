/**
 * Counterfactual Flipper — "what single piece of evidence would flip this?"
 *
 * Phase 2 weaponization subsystem #25.
 *
 * For the MLRO reviewing a compliance decision, the most useful question
 * is often: "If I'm wrong about this, what specific new evidence would
 * prove me wrong?". The counterfactual flipper answers that by iterating
 * each signal dimension and computing the minimum change that would
 * push the verdict across a boundary.
 *
 * Example output for a FREEZE verdict:
 *   "The verdict would flip to ESCALATE if:
 *     1. The sanctions match score dropped below 0.9 (currently 0.94)
 *     2. The UBO was shown to be 100% disclosed (currently 30% undisclosed)"
 *
 * This is not a gradient-based explainer — it's a rule-based walker
 * against the known clamp thresholds. Deterministic, interpretable, and
 * fast.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (document reasoning + what would change it)
 *   - Cabinet Res 134/2025 Art.19 (internal review — dissenting views)
 */

import type { Verdict } from './teacherStudent';
import { DEFAULT_CLAMP_POLICY, type ClampPolicy } from './clampPolicy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CounterfactualInput {
  verdict: Verdict;
  signals: {
    sanctionsMatchScore?: number;
    adverseMediaCriticalCount?: number;
    uboUndisclosedPct?: number;
    confirmedWalletHits?: number;
    structuringSeverity?: 'low' | 'medium' | 'high';
  };
}

export interface Counterfactual {
  /** Which signal would need to change. */
  signal: string;
  /** Current value. */
  currentValue: number | string;
  /** Value that would flip the verdict. */
  flipValue: number | string;
  /** Verdict the case would become. */
  flippedVerdict: Verdict;
  /** Regulatory citation for the threshold. */
  citation: string;
}

export interface CounterfactualReport {
  verdict: Verdict;
  counterfactuals: Counterfactual[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Flipper
// ---------------------------------------------------------------------------

export function computeCounterfactuals(
  input: CounterfactualInput,
  policy: Readonly<ClampPolicy> = DEFAULT_CLAMP_POLICY
): CounterfactualReport {
  const counterfactuals: Counterfactual[] = [];

  if (input.verdict === 'freeze' || input.verdict === 'escalate') {
    // What would flip us back towards pass?
    if ((input.signals.sanctionsMatchScore ?? 0) >= 0.9) {
      counterfactuals.push({
        signal: 'sanctionsMatchScore',
        currentValue: input.signals.sanctionsMatchScore ?? 0,
        flipValue: '< 0.5',
        flippedVerdict: 'flag',
        citation: 'FDL Art.20 + Cabinet Res 74/2020 Art.4',
      });
    }
    if ((input.signals.uboUndisclosedPct ?? 0) > policy.uboUndisclosedEscalateAbovePct) {
      counterfactuals.push({
        signal: 'uboUndisclosedPct',
        currentValue: input.signals.uboUndisclosedPct ?? 0,
        flipValue: `<= ${policy.uboUndisclosedEscalateAbovePct}%`,
        flippedVerdict: 'flag',
        citation: 'Cabinet Decision 109/2023',
      });
    }
    if ((input.signals.confirmedWalletHits ?? 0) >= policy.walletConfirmedFreezeCount) {
      counterfactuals.push({
        signal: 'confirmedWalletHits',
        currentValue: input.signals.confirmedWalletHits ?? 0,
        flipValue: 0,
        flippedVerdict: 'flag',
        citation: 'FATF Rec 15 VASP',
      });
    }
    if (
      (input.signals.adverseMediaCriticalCount ?? 0) >= policy.adverseMediaCriticalEscalateCount
    ) {
      counterfactuals.push({
        signal: 'adverseMediaCriticalCount',
        currentValue: input.signals.adverseMediaCriticalCount ?? 0,
        flipValue: 0,
        flippedVerdict: 'flag',
        citation: 'FATF Rec 10 + Cabinet Res 134/2025 Art.14',
      });
    }
  } else {
    // What would flip us towards escalate/freeze?
    if ((input.signals.adverseMediaCriticalCount ?? 0) === 0) {
      counterfactuals.push({
        signal: 'adverseMediaCriticalCount',
        currentValue: 0,
        flipValue: `>= ${policy.adverseMediaCriticalEscalateCount}`,
        flippedVerdict: 'escalate',
        citation: 'FATF Rec 10',
      });
    }
    if ((input.signals.uboUndisclosedPct ?? 0) <= policy.uboUndisclosedEscalateAbovePct) {
      counterfactuals.push({
        signal: 'uboUndisclosedPct',
        currentValue: input.signals.uboUndisclosedPct ?? 0,
        flipValue: `> ${policy.uboUndisclosedEscalateAbovePct}%`,
        flippedVerdict: 'escalate',
        citation: 'Cabinet Decision 109/2023',
      });
    }
    if ((input.signals.confirmedWalletHits ?? 0) === 0) {
      counterfactuals.push({
        signal: 'confirmedWalletHits',
        currentValue: 0,
        flipValue: '>= 1',
        flippedVerdict: 'freeze',
        citation: 'FATF Rec 15 + Cabinet Res 74/2020 Art.4-7',
      });
    }
  }

  const narrative =
    counterfactuals.length === 0
      ? `Counterfactual flipper: no single-signal change would flip the current verdict (${input.verdict}).`
      : `Counterfactual flipper — ${counterfactuals.length} signal(s) could flip the verdict:\n` +
        counterfactuals
          .map(
            (c) =>
              `  - ${c.signal}: ${c.currentValue} → ${c.flipValue} would yield ${c.flippedVerdict} (${c.citation})`
          )
          .join('\n');

  return { verdict: input.verdict, counterfactuals, narrative };
}
