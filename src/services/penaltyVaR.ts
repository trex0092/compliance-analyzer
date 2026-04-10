/**
 * Monte Carlo Penalty Value-at-Risk.
 *
 * Treats regulatory penalty exposure as a financial risk and computes
 * VaR / Expected Shortfall over a simulated distribution of outcomes.
 *
 * Use case: the CO needs to answer "what's our maximum plausible
 * regulatory penalty exposure over the next 12 months, with 99%
 * confidence?" This lets them size the compliance budget and
 * negotiate insurance coverage.
 *
 * Method:
 *   1. Each potential violation has a probability distribution over
 *      occurrence (Bernoulli) + a severity distribution over the
 *      fine amount (truncated log-normal or bounded uniform).
 *   2. For N Monte Carlo trials, we sample occurrence + severity per
 *      violation type and sum losses.
 *   3. Report VaR at configurable confidence, Expected Shortfall
 *      (tail average), maximum observed, and per-violation contribution.
 *
 * Penalty ranges are anchored on Cabinet Res 71/2024 (AED 10K–100M).
 *
 * Regulatory basis:
 *   - Cabinet Res 71/2024 (administrative penalties AED 10K–100M)
 *   - FDL Art.41-49 (penalty schedule)
 *   - FATF Rec 35 (proportionate sanctions)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViolationType {
  id: string;
  description: string;
  /** Annual probability of occurrence in [0, 1]. */
  annualProbability: number;
  /** Minimum and maximum penalty in AED. Distribution is log-uniform. */
  minPenalty: number;
  maxPenalty: number;
  regulatoryRef: string;
}

export interface VaRConfig {
  trials: number;
  confidence: number; // e.g. 0.95, 0.99
  seed?: number;
}

export interface VaRReport {
  trials: number;
  confidence: number;
  expectedLoss: number;
  valueAtRisk: number;
  expectedShortfall: number;
  maxObserved: number;
  minObserved: number;
  byViolation: Array<{
    id: string;
    description: string;
    expectedContribution: number;
    probabilityOfLoss: number;
  }>;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export function runPenaltyVaR(violations: readonly ViolationType[], config: VaRConfig): VaRReport {
  if (config.trials < 1) throw new Error('trials must be >= 1');
  if (config.confidence <= 0 || config.confidence >= 1)
    throw new Error('confidence must be in (0, 1)');

  const rand = mulberry32(config.seed ?? 42);
  const losses: number[] = new Array(config.trials);
  const occurrenceCounts = new Map<string, number>();
  const contributionSums = new Map<string, number>();
  for (const v of violations) {
    occurrenceCounts.set(v.id, 0);
    contributionSums.set(v.id, 0);
  }

  for (let t = 0; t < config.trials; t++) {
    let total = 0;
    for (const v of violations) {
      if (rand() < v.annualProbability) {
        const penalty = sampleLogUniform(v.minPenalty, v.maxPenalty, rand);
        total += penalty;
        occurrenceCounts.set(v.id, (occurrenceCounts.get(v.id) ?? 0) + 1);
        contributionSums.set(v.id, (contributionSums.get(v.id) ?? 0) + penalty);
      }
    }
    losses[t] = total;
  }

  losses.sort((a, b) => a - b);
  const idx = Math.min(losses.length - 1, Math.floor(config.confidence * losses.length));
  const valueAtRisk = losses[idx];
  const tail = losses.slice(idx);
  const expectedShortfall = tail.length === 0 ? 0 : tail.reduce((s, x) => s + x, 0) / tail.length;
  const expectedLoss = losses.reduce((s, x) => s + x, 0) / losses.length;

  const byViolation = violations.map((v) => ({
    id: v.id,
    description: v.description,
    expectedContribution: round2((contributionSums.get(v.id) ?? 0) / config.trials),
    probabilityOfLoss: round4((occurrenceCounts.get(v.id) ?? 0) / config.trials),
  }));

  return {
    trials: config.trials,
    confidence: config.confidence,
    expectedLoss: round2(expectedLoss),
    valueAtRisk: round2(valueAtRisk),
    expectedShortfall: round2(expectedShortfall),
    maxObserved: round2(losses[losses.length - 1]),
    minObserved: round2(losses[0]),
    byViolation,
  };
}

function sampleLogUniform(min: number, max: number, rand: () => number): number {
  if (min <= 0 || max <= 0) return min + rand() * (max - min);
  const a = Math.log(min);
  const b = Math.log(max);
  return Math.exp(a + rand() * (b - a));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Pre-baked UAE DPMS violation catalogue
// ---------------------------------------------------------------------------

export const UAE_DPMS_VIOLATIONS: readonly ViolationType[] = [
  {
    id: 'missing_cdd',
    description: 'Missing or inadequate CDD on customer',
    annualProbability: 0.1,
    minPenalty: 50_000,
    maxPenalty: 1_000_000,
    regulatoryRef: 'FDL Art.12-14; Cabinet Res 71/2024',
  },
  {
    id: 'late_str',
    description: 'STR filed after 10-business-day deadline',
    annualProbability: 0.08,
    minPenalty: 25_000,
    maxPenalty: 500_000,
    regulatoryRef: 'FDL Art.26-27; Cabinet Res 71/2024',
  },
  {
    id: 'failed_freeze_24h',
    description: 'Asset freeze not executed within 24 hours',
    annualProbability: 0.02,
    minPenalty: 500_000,
    maxPenalty: 10_000_000,
    regulatoryRef: 'Cabinet Res 74/2020 Art.4',
  },
  {
    id: 'ubo_not_recorded',
    description: 'UBO over 25% not recorded in register',
    annualProbability: 0.05,
    minPenalty: 50_000,
    maxPenalty: 1_000_000,
    regulatoryRef: 'Cabinet Decision 109/2023',
  },
  {
    id: 'ctr_threshold_miss',
    description: 'Cash transaction ≥ AED 55K not reported via goAML',
    annualProbability: 0.12,
    minPenalty: 25_000,
    maxPenalty: 200_000,
    regulatoryRef: 'MoE Circular 08/AML/2021',
  },
  {
    id: 'no_co_appointed',
    description: 'Compliance Officer not appointed / not notified',
    annualProbability: 0.01,
    minPenalty: 100_000,
    maxPenalty: 2_000_000,
    regulatoryRef: 'FDL Art.20; Cabinet Res 134/2025 Art.18',
  },
  {
    id: 'sanctions_list_outdated',
    description: 'Sanctions list not refreshed within required window',
    annualProbability: 0.15,
    minPenalty: 10_000,
    maxPenalty: 250_000,
    regulatoryRef: 'FDL Art.22; Cabinet Res 74/2020',
  },
  {
    id: 'tipping_off',
    description: 'Subject informed of STR filing',
    annualProbability: 0.005,
    minPenalty: 1_000_000,
    maxPenalty: 100_000_000,
    regulatoryRef: 'FDL Art.29',
  },
];
