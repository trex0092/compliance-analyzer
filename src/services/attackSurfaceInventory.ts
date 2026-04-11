/**
 * Attack Surface Inventory — subsystem #70 (Phase 7 Cluster H).
 *
 * Enumerates every INPUT the brain reads and computes an influence
 * score — "how much does a small change in this input move the
 * verdict?". Gives the security team a prioritised list of inputs
 * to harden.
 *
 * Deterministic sensitivity analysis: perturbs each input by ±10%
 * (numerics) or toggle (booleans) and measures how often the verdict
 * changes. High-influence inputs are the ones a real attacker would
 * target.
 *
 * Regulatory basis:
 *   - NIST AI RMF MS-1.2 (bias + sensitivity analysis)
 *   - EU AI Act Art.15 (robustness measurement)
 *   - FDL No.10/2025 Art.20 (documented reasoning)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerdictProbe = (
  signals: Record<string, unknown>
) => 'pass' | 'flag' | 'escalate' | 'freeze';

export interface AttackSurfaceInput {
  baselineSignals: Record<string, unknown>;
  probe: VerdictProbe;
}

export interface SurfaceScore {
  signal: string;
  influence: number; // 0 = no change, 1 = always flips verdict
  sampleSize: number;
}

export interface AttackSurfaceReport {
  baselineVerdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  surface: SurfaceScore[];
  totalInputs: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Analyser
// ---------------------------------------------------------------------------

function perturbValue(val: unknown): unknown[] {
  if (typeof val === 'number') {
    return [val * 0.9, val * 1.1, val * 0.5, val * 1.5, 0];
  }
  if (typeof val === 'boolean') {
    return [!val];
  }
  if (typeof val === 'string') {
    return ['', 'modified', val + '-tampered'];
  }
  return [];
}

export function inventoryAttackSurface(
  input: AttackSurfaceInput
): AttackSurfaceReport {
  const baselineVerdict = input.probe(input.baselineSignals);
  const scores: SurfaceScore[] = [];

  for (const [key, val] of Object.entries(input.baselineSignals)) {
    const perturbations = perturbValue(val);
    if (perturbations.length === 0) continue;

    let flips = 0;
    for (const newVal of perturbations) {
      const perturbed = { ...input.baselineSignals, [key]: newVal };
      const newVerdict = input.probe(perturbed);
      if (newVerdict !== baselineVerdict) flips += 1;
    }

    const influence = flips / perturbations.length;
    if (influence > 0) {
      scores.push({
        signal: key,
        influence: Math.round(influence * 100) / 100,
        sampleSize: perturbations.length,
      });
    }
  }

  scores.sort((a, b) => b.influence - a.influence);

  const narrative =
    scores.length === 0
      ? `Attack surface inventory: verdict ${baselineVerdict} is stable to all ±10% perturbations.`
      : `Attack surface inventory: ${scores.length} influential input(s). ` +
        `Top: ${scores[0].signal} (${(scores[0].influence * 100).toFixed(0)}% flip rate). ` +
        `Harden these inputs first.`;

  return {
    baselineVerdict,
    surface: scores,
    totalInputs: Object.keys(input.baselineSignals).length,
    narrative,
  };
}
