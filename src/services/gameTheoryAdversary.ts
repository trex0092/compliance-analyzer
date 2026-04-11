/**
 * Game-Theoretic Adversary Simulator — subsystem #93 (Phase 8).
 *
 * Simulates an adversary choosing their optimal evasion strategy
 * against our detection capabilities, then reports which subsystems
 * the adversary would exploit first. Helps prioritise hardening.
 *
 * Model: a two-player zero-sum game. The defender (us) commits to
 * a probability distribution over detection subsystems (budget-
 * constrained attention). The attacker commits to a probability
 * distribution over evasion strategies. Payoff matrix is
 * (detection_rate × severity) minus (attacker_effort × cost).
 *
 * Solver: we don't do a full LP — we use iterative best-response
 * (fictitious play) which converges to the Nash equilibrium for
 * zero-sum games. Fast, deterministic, no solver dependency.
 *
 * This is a MINIMUM-VIABLE implementation — the value is in the
 * framework ("defender chooses detection mix, attacker chooses
 * evasion mix, they reach equilibrium") not in the numerical
 * precision.
 *
 * Regulatory basis:
 *   - NIST AI RMF MS-1.1 (robustness testing)
 *   - EU AI Act Art.15 (accuracy + robustness)
 *   - FATF Rec 1, 18 (risk-based approach, internal controls)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectionStrategy {
  name: string;
  /** Cost per unit of attention (budget-share). */
  cost: number;
}

export interface EvasionStrategy {
  name: string;
  /** Attacker's cost to execute this evasion. */
  cost: number;
}

/** Payoff for the DEFENDER = detection_rate - attacker_cost. */
export type PayoffFn = (
  detection: DetectionStrategy,
  evasion: EvasionStrategy
) => number;

export interface EquilibriumReport {
  defenderMix: ReadonlyArray<{ strategy: string; probability: number }>;
  attackerMix: ReadonlyArray<{ strategy: string; probability: number }>;
  expectedPayoff: number;
  iterations: number;
  topAttackerChoice: string;
  topDefenderChoice: string;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Fictitious play
// ---------------------------------------------------------------------------

export function solveAdversaryGame(
  detections: readonly DetectionStrategy[],
  evasions: readonly EvasionStrategy[],
  payoff: PayoffFn,
  iterations = 500
): EquilibriumReport {
  const n = detections.length;
  const m = evasions.length;
  if (n === 0 || m === 0) {
    return {
      defenderMix: [],
      attackerMix: [],
      expectedPayoff: 0,
      iterations: 0,
      topAttackerChoice: '',
      topDefenderChoice: '',
      narrative: 'Adversary game: empty strategy set.',
    };
  }

  // Precompute payoff matrix
  const M: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      row.push(payoff(detections[i], evasions[j]));
    }
    M.push(row);
  }

  // Fictitious play: both sides best-respond to the empirical
  // distribution of the opponent.
  const defCount = new Array<number>(n).fill(1); // +1 smoothing
  const attCount = new Array<number>(m).fill(1);

  for (let iter = 0; iter < iterations; iter++) {
    // Defender best response to attacker mix
    const totalAtt = attCount.reduce((a, b) => a + b, 0);
    const attMix = attCount.map((c) => c / totalAtt);
    let bestDefIdx = 0;
    let bestDefValue = -Infinity;
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = 0; j < m; j++) v += attMix[j] * M[i][j];
      if (v > bestDefValue) {
        bestDefValue = v;
        bestDefIdx = i;
      }
    }
    defCount[bestDefIdx] += 1;

    // Attacker best response to defender mix (minimise defender payoff)
    const totalDef = defCount.reduce((a, b) => a + b, 0);
    const defMix = defCount.map((c) => c / totalDef);
    let bestAttIdx = 0;
    let bestAttValue = Infinity;
    for (let j = 0; j < m; j++) {
      let v = 0;
      for (let i = 0; i < n; i++) v += defMix[i] * M[i][j];
      if (v < bestAttValue) {
        bestAttValue = v;
        bestAttIdx = j;
      }
    }
    attCount[bestAttIdx] += 1;
  }

  const totalDef = defCount.reduce((a, b) => a + b, 0);
  const totalAtt = attCount.reduce((a, b) => a + b, 0);
  const defMix = defCount.map((c, i) => ({
    strategy: detections[i].name,
    probability: c / totalDef,
  }));
  const attMix = attCount.map((c, j) => ({
    strategy: evasions[j].name,
    probability: c / totalAtt,
  }));

  // Expected payoff under final mixes
  let expected = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      expected += defMix[i].probability * attMix[j].probability * M[i][j];
    }
  }

  const topDef = defMix.reduce((a, b) => (b.probability > a.probability ? b : a));
  const topAtt = attMix.reduce((a, b) => (b.probability > a.probability ? b : a));

  return {
    defenderMix: defMix.sort((a, b) => b.probability - a.probability),
    attackerMix: attMix.sort((a, b) => b.probability - a.probability),
    expectedPayoff: Math.round(expected * 10000) / 10000,
    iterations,
    topDefenderChoice: topDef.strategy,
    topAttackerChoice: topAtt.strategy,
    narrative:
      `Adversary equilibrium: defender should mostly use "${topDef.strategy}" ` +
      `(${(topDef.probability * 100).toFixed(0)}%), attacker will mostly use ` +
      `"${topAtt.strategy}" (${(topAtt.probability * 100).toFixed(0)}%). ` +
      `Expected defender payoff ${expected.toFixed(2)}.`,
  };
}
