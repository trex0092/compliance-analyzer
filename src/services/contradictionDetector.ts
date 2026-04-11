/**
 * Contradiction Detector — flags inter-subsystem disagreements.
 *
 * Phase 2 weaponization subsystem #22.
 *
 * When multiple Weaponized Brain subsystems emit signals that contradict
 * each other (e.g. peerAnomaly says "normal" but structuring says "high"),
 * the contradiction detector flags the decision as "the brain isn't sure,
 * force human review". This is the cheapest way to catch the class of
 * bug where a subsystem's output is out-of-distribution.
 *
 * Contradictions do NOT change the verdict — they force requiresHumanReview
 * and produce a narrative line for the MLRO.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (document dissenting signals)
 *   - Cabinet Res 134/2025 Art.19 (internal review before decision)
 */

import type { Verdict } from './teacherStudent';
import { DEFAULT_CLAMP_POLICY, type ClampPolicy } from './clampPolicy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubsystemSignal {
  /** Subsystem that emitted the signal. */
  name: string;
  /** Implied verdict from this subsystem alone. */
  impliedVerdict: Verdict;
  /** Subsystem-local confidence in [0,1]. */
  confidence: number;
}

export interface ContradictionReport {
  /** True if any material contradiction was detected. */
  hasContradiction: boolean;
  /** Materiality score in [0,1]. Higher = more severe disagreement. */
  score: number;
  /** The pairwise disagreements that triggered the flag. */
  disagreements: Array<{ a: SubsystemSignal; b: SubsystemSignal; rankGap: number }>;
  /** Human-readable summary. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

export function detectContradictions(
  signals: readonly SubsystemSignal[],
  policy: Readonly<ClampPolicy> = DEFAULT_CLAMP_POLICY
): ContradictionReport {
  if (signals.length < 2) {
    return {
      hasContradiction: false,
      score: 0,
      disagreements: [],
      narrative: 'Not enough subsystem signals to compute contradictions.',
    };
  }

  const disagreements: ContradictionReport['disagreements'] = [];
  let maxGap = 0;
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      const gap = Math.abs(
        VERDICT_RANK[signals[i].impliedVerdict] - VERDICT_RANK[signals[j].impliedVerdict]
      );
      if (gap >= 2) {
        // Disagreement spanning at least two verdict ranks is material.
        disagreements.push({ a: signals[i], b: signals[j], rankGap: gap });
        maxGap = Math.max(maxGap, gap);
      }
    }
  }

  // Score: maxGap/3 (max possible rank gap is 3: pass vs freeze).
  const score = maxGap / 3;
  const hasContradiction = score >= policy.contradictionEscalateThreshold;

  const narrative = hasContradiction
    ? `Contradiction detector: ${disagreements.length} material disagreement(s) found. ` +
      disagreements
        .slice(0, 3)
        .map(
          (d) =>
            `${d.a.name}=${d.a.impliedVerdict} vs ${d.b.name}=${d.b.impliedVerdict} (gap ${d.rankGap})`
        )
        .join('; ') +
      '. Forcing human review per FDL Art.20-21.'
    : `Contradiction detector: ${disagreements.length} minor disagreement(s), no material contradictions.`;

  return { hasContradiction, score, disagreements, narrative };
}
