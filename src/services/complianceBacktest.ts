/**
 * Compliance Policy Backtester.
 *
 * Replays a historical set of cases through a NEW policy function and
 * reports what would have been decided differently versus the ORIGINAL
 * ground-truth outcomes. Essential for defending any policy change to
 * a regulator: "if we had used this policy last year, what would have
 * changed?"
 *
 * Key metrics:
 *
 *  - Agreement rate (% of cases where new policy matches historical)
 *  - Confusion matrix (historical × new verdicts)
 *  - False-negative count (missed flags the old policy caught)
 *  - False-positive count (new flags the old policy did not raise)
 *  - Precision, recall, F1 relative to the historical ground truth
 *  - Disagreement list (for review), capped at topN
 *
 * The backtester is pure — it takes a policy function and a dataset
 * and returns a report. No side effects, deterministic.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review of policy
 *     effectiveness — mandatory justification for changes)
 *   - FATF Methodology 2022 §3 (policy effectiveness assessment)
 *   - FDL Art.20 (CO must document the basis for any policy change)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BacktestVerdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface HistoricalCase {
  id: string;
  decidedAtIso: string;
  features: Record<string, unknown>;
  historicalVerdict: BacktestVerdict;
  /** Was the historical verdict later confirmed as correct? */
  groundTruthConfirmed?: boolean;
}

export type PolicyFunction = (features: Record<string, unknown>) => BacktestVerdict;

export interface Disagreement {
  caseId: string;
  historicalVerdict: BacktestVerdict;
  newVerdict: BacktestVerdict;
  direction: 'upgrade' | 'downgrade' | 'lateral';
}

export interface BacktestReport {
  totalCases: number;
  agreementRate: number;
  falsePositives: number; // new flags, old did not
  falseNegatives: number; // old flags, new did not
  precision: number;
  recall: number;
  f1: number;
  confusionMatrix: Record<BacktestVerdict, Record<BacktestVerdict, number>>;
  disagreements: Disagreement[];
  confirmedFalseNegatives: number; // ground-truth confirmed cases the new policy would miss
  summary: string;
}

// ---------------------------------------------------------------------------
// Verdict ordering
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<BacktestVerdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

function directionOf(a: BacktestVerdict, b: BacktestVerdict): Disagreement['direction'] {
  if (VERDICT_RANK[b] > VERDICT_RANK[a]) return 'upgrade';
  if (VERDICT_RANK[b] < VERDICT_RANK[a]) return 'downgrade';
  return 'lateral';
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function backtest(
  cases: readonly HistoricalCase[],
  newPolicy: PolicyFunction,
  options: { topDisagreements?: number } = {}
): BacktestReport {
  const topN = options.topDisagreements ?? 50;
  const confusion: Record<BacktestVerdict, Record<BacktestVerdict, number>> = {
    pass: { pass: 0, flag: 0, escalate: 0, freeze: 0 },
    flag: { pass: 0, flag: 0, escalate: 0, freeze: 0 },
    escalate: { pass: 0, flag: 0, escalate: 0, freeze: 0 },
    freeze: { pass: 0, flag: 0, escalate: 0, freeze: 0 },
  };

  let agree = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let confirmedFalseNegatives = 0;
  const disagreements: Disagreement[] = [];

  for (const kase of cases) {
    const newVerdict = newPolicy(kase.features);
    confusion[kase.historicalVerdict][newVerdict]++;
    if (newVerdict === kase.historicalVerdict) {
      agree++;
    } else {
      const direction = directionOf(kase.historicalVerdict, newVerdict);
      if (direction === 'upgrade') falsePositives++;
      if (direction === 'downgrade') {
        falseNegatives++;
        if (kase.groundTruthConfirmed) confirmedFalseNegatives++;
      }
      disagreements.push({
        caseId: kase.id,
        historicalVerdict: kase.historicalVerdict,
        newVerdict,
        direction,
      });
    }
  }

  const totalCases = cases.length;
  const agreementRate = totalCases === 0 ? 1 : agree / totalCases;

  // Treat historical "non-pass" as positive class for precision/recall.
  const truePositives = cases.filter(
    (c) => c.historicalVerdict !== 'pass' && newPolicy(c.features) !== 'pass'
  ).length;
  const predictedPositives = cases.filter((c) => newPolicy(c.features) !== 'pass').length;
  const actualPositives = cases.filter((c) => c.historicalVerdict !== 'pass').length;
  const precision = predictedPositives === 0 ? 1 : truePositives / predictedPositives;
  const recall = actualPositives === 0 ? 1 : truePositives / actualPositives;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  disagreements.sort((a, b) => {
    // Prioritise downgrades that affect confirmed cases.
    const score = (d: Disagreement) =>
      d.direction === 'downgrade' ? 2 : d.direction === 'upgrade' ? 1 : 0;
    return score(b) - score(a);
  });

  const summary = `Backtested ${totalCases} cases. Agreement ${(agreementRate * 100).toFixed(1)}%. ${falsePositives} new upgrades, ${falseNegatives} new downgrades (${confirmedFalseNegatives} of which were confirmed positives).`;

  return {
    totalCases,
    agreementRate: round4(agreementRate),
    falsePositives,
    falseNegatives,
    precision: round4(precision),
    recall: round4(recall),
    f1: round4(f1),
    confusionMatrix: confusion,
    disagreements: disagreements.slice(0, topN),
    confirmedFalseNegatives,
    summary,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Helper: compare two policies A → B head-to-head
// ---------------------------------------------------------------------------

export function compareBacktests(
  reportA: BacktestReport,
  reportB: BacktestReport
): {
  agreementDelta: number;
  f1Delta: number;
  recallDelta: number;
  precisionDelta: number;
  recommendation: 'A' | 'B' | 'tie';
} {
  const agreementDelta = round4(reportB.agreementRate - reportA.agreementRate);
  const f1Delta = round4(reportB.f1 - reportA.f1);
  const recallDelta = round4(reportB.recall - reportA.recall);
  const precisionDelta = round4(reportB.precision - reportA.precision);
  let recommendation: 'A' | 'B' | 'tie' = 'tie';
  if (f1Delta > 0.02) recommendation = 'B';
  else if (f1Delta < -0.02) recommendation = 'A';
  return { agreementDelta, f1Delta, recallDelta, precisionDelta, recommendation };
}
