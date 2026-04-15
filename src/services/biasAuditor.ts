/**
 * Bias Auditor — disparate-impact scorer for brain decisions across
 * protected attributes.
 *
 * Why this exists:
 *   EU AI Act Art.10(5) requires providers of high-risk AI systems
 *   to "examine, in view of their purpose, the training, validation
 *   and testing datasets with regard to possible biases that are
 *   likely to affect the health and safety of persons [...] or
 *   lead to discrimination prohibited under Union law." NIST AI
 *   RMF 1.0 MEASURE-2 + MEASURE-4 demand the same.
 *
 *   Today the brain has no bias audit. Cases are scored on risk
 *   features alone — but an MLRO reviewer cannot prove that verdict
 *   rates are uniform across protected attributes (age band,
 *   gender, nationality, residency). Without this audit, the brain
 *   cannot legally ship in the EU for high-risk decisions.
 *
 *   This module is the pure auditor. It takes a list of decision
 *   records + the protected attributes they were made on, and
 *   returns a BiasReport with:
 *     - overall verdict distribution per attribute value
 *     - disparate-impact ratio per (attribute, verdict) pair
 *     - flags when the ratio falls outside the 4/5 rule (0.8)
 *     - statistical parity test (two-sample z-test on freeze rate)
 *     - regulatory anchor for each finding
 *
 *   Pure function. No I/O. Same input → same report.
 *
 * Safety invariants:
 *   1. The auditor NEVER auto-tunes the brain based on bias findings.
 *      Any remediation is an MLRO decision with a clamp suggestion.
 *   2. The auditor NEVER stores raw protected attribute values —
 *      only the aggregate counts + the report.
 *   3. The 4/5 rule threshold is configurable but defaults to 0.8
 *      (the legal floor in EEOC Uniform Guidelines, adopted by
 *      many EU regulators as the benchmark).
 *
 * Regulatory basis:
 *   EU AI Act Art.10       (data governance + bias testing)
 *   EU AI Act Art.15       (accuracy + non-discrimination)
 *   EU GDPR Art.22         (automated decision-making)
 *   EEOC Uniform Guidelines 1978 (4/5 rule, internationally adopted)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative risk measurement)
 *   NIST AI RMF 1.0 MEASURE-4 (validation + bias testing)
 *   FATF Rec 1             (risk-based approach must not discriminate)
 *   FDL No.10/2025 Art.20-22 (CO fair + reasoned decisions)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export type ProtectedAttribute =
  | 'age_band'
  | 'gender'
  | 'nationality'
  | 'residency'
  | 'primary_language';

export interface BiasDecisionRecord {
  /** Opaque case id. */
  caseId: string;
  verdict: Verdict;
  /**
   * Aggregated attribute values the case was scored on. Raw PII
   * NEVER enters this record — the caller maps raw values to the
   * coarse bins the auditor expects.
   */
  protectedAttrs: Readonly<Partial<Record<ProtectedAttribute, string>>>;
}

export interface VerdictCounts {
  pass: number;
  flag: number;
  escalate: number;
  freeze: number;
  total: number;
}

export interface GroupStats {
  attribute: ProtectedAttribute;
  value: string;
  sampleSize: number;
  counts: VerdictCounts;
  /** Fraction of the group that got an adverse verdict (flag/escalate/freeze). */
  adverseRate: number;
  /** Fraction that got a freeze (the hardest outcome). */
  freezeRate: number;
}

export interface DisparateImpactFinding {
  attribute: ProtectedAttribute;
  /** Value with the HIGHEST adverse rate. */
  disadvantagedValue: string;
  disadvantagedRate: number;
  disadvantagedSampleSize: number;
  /** Value with the LOWEST adverse rate (baseline). */
  referenceValue: string;
  referenceRate: number;
  referenceSampleSize: number;
  /** disadvantaged / reference. Lower = worse. */
  ratio: number;
  /** Whether the ratio fails the 4/5 rule. */
  fails45Rule: boolean;
  /** Z-score from the two-sample proportions test. */
  zScore: number;
  /** Plain-English finding. */
  finding: string;
  regulatory: string;
}

export interface BiasReport {
  schemaVersion: 1;
  totalRecords: number;
  overallVerdictDistribution: VerdictCounts;
  groups: readonly GroupStats[];
  findings: readonly DisparateImpactFinding[];
  /** Overall severity — any finding triggers at least 'warning'. */
  severity: 'clean' | 'warning' | 'critical';
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 4/5 rule: a disadvantaged group must achieve ≥80% of the reference rate. */
export const FOUR_FIFTHS_THRESHOLD = 0.8;

/** Minimum sample size before a group is evaluated (statistical sanity). */
export const MIN_SAMPLE_PER_GROUP = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyCounts(): VerdictCounts {
  return { pass: 0, flag: 0, escalate: 0, freeze: 0, total: 0 };
}

function addVerdict(counts: VerdictCounts, verdict: Verdict): void {
  counts[verdict] += 1;
  counts.total += 1;
}

function adverseRate(counts: VerdictCounts): number {
  if (counts.total === 0) return 0;
  return (counts.flag + counts.escalate + counts.freeze) / counts.total;
}

function freezeRate(counts: VerdictCounts): number {
  if (counts.total === 0) return 0;
  return counts.freeze / counts.total;
}

/**
 * Two-proportion z-test.
 *   p1 = disadvantaged rate
 *   p2 = reference rate
 *   n1, n2 = sample sizes
 * Returns the z-statistic.
 */
function twoProportionZ(p1: number, n1: number, p2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AuditOptions {
  threshold?: number;
  minSamplePerGroup?: number;
}

export function auditBias(
  records: readonly BiasDecisionRecord[],
  attributes: readonly ProtectedAttribute[],
  opts: AuditOptions = {}
): BiasReport {
  const threshold = opts.threshold ?? FOUR_FIFTHS_THRESHOLD;
  const minSample = opts.minSamplePerGroup ?? MIN_SAMPLE_PER_GROUP;

  // Overall distribution.
  const overall: VerdictCounts = emptyCounts();
  for (const r of records) addVerdict(overall, r.verdict);

  // Per-(attribute, value) aggregation.
  const perAttrGroups = new Map<ProtectedAttribute, Map<string, VerdictCounts>>();
  for (const attr of attributes) perAttrGroups.set(attr, new Map());

  for (const r of records) {
    for (const attr of attributes) {
      const value = r.protectedAttrs[attr];
      if (!value) continue;
      const byValue = perAttrGroups.get(attr)!;
      if (!byValue.has(value)) byValue.set(value, emptyCounts());
      addVerdict(byValue.get(value)!, r.verdict);
    }
  }

  // Build GroupStats list + disparate impact findings.
  const groups: GroupStats[] = [];
  const findings: DisparateImpactFinding[] = [];

  for (const attr of attributes) {
    const byValue = perAttrGroups.get(attr)!;
    // Build stats per value.
    const valueStats: GroupStats[] = [];
    for (const [value, counts] of byValue) {
      valueStats.push({
        attribute: attr,
        value,
        sampleSize: counts.total,
        counts,
        adverseRate: adverseRate(counts),
        freezeRate: freezeRate(counts),
      });
    }
    groups.push(...valueStats);

    // Filter to groups with enough samples to be meaningful.
    const eligible = valueStats.filter((g) => g.sampleSize >= minSample);
    if (eligible.length < 2) continue;

    // Find the best (lowest adverse rate) and worst (highest) groups.
    const sortedByAdverse = [...eligible].sort((a, b) => a.adverseRate - b.adverseRate);
    const reference = sortedByAdverse[0]!;
    const disadvantaged = sortedByAdverse[sortedByAdverse.length - 1]!;
    if (reference === disadvantaged) continue;

    // 4/5 rule: disadvantaged.adverseRate vs reference.adverseRate,
    // expressed as a ratio from the NON-adverse (selection) side to
    // match the classical EEOC framing.
    const selectionDisadvantaged = 1 - disadvantaged.adverseRate;
    const selectionReference = 1 - reference.adverseRate;
    const ratio = selectionReference === 0 ? 1 : selectionDisadvantaged / selectionReference;
    const fails = ratio < threshold;

    const zScore = twoProportionZ(
      disadvantaged.adverseRate,
      disadvantaged.sampleSize,
      reference.adverseRate,
      reference.sampleSize
    );

    findings.push({
      attribute: attr,
      disadvantagedValue: disadvantaged.value,
      disadvantagedRate: disadvantaged.adverseRate,
      disadvantagedSampleSize: disadvantaged.sampleSize,
      referenceValue: reference.value,
      referenceRate: reference.adverseRate,
      referenceSampleSize: reference.sampleSize,
      ratio,
      fails45Rule: fails,
      zScore,
      finding: fails
        ? `${attr}="${disadvantaged.value}" has adverse rate ${(disadvantaged.adverseRate * 100).toFixed(1)}% ` +
          `vs reference ${attr}="${reference.value}" at ${(reference.adverseRate * 100).toFixed(1)}%. ` +
          `Selection ratio ${(ratio * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}% (4/5 rule). ` +
          `z=${zScore.toFixed(2)}. MLRO review required under EU AI Act Art.10.`
        : `${attr} distribution is within the ${(threshold * 100).toFixed(0)}% selection-ratio bound.`,
      regulatory: 'EU AI Act Art.10; EEOC Uniform Guidelines 1978',
    });
  }

  const failCount = findings.filter((f) => f.fails45Rule).length;
  const severity: BiasReport['severity'] =
    failCount === 0 ? 'clean' : failCount >= 2 ? 'critical' : 'warning';

  return {
    schemaVersion: 1,
    totalRecords: records.length,
    overallVerdictDistribution: overall,
    groups,
    findings,
    severity,
    summary:
      severity === 'clean'
        ? `Bias audit CLEAN — ${findings.length} comparison(s), 0 fail the 4/5 rule.`
        : severity === 'warning'
          ? `Bias audit WARNING — 1 finding fails the 4/5 rule. MLRO review required.`
          : `Bias audit CRITICAL — ${failCount} findings fail the 4/5 rule. HALT AUTO-DISPATCH until resolved.`,
    regulatory: [
      'EU AI Act Art.10',
      'EU AI Act Art.15',
      'EU GDPR Art.22',
      'EEOC Uniform Guidelines 1978',
      'NIST AI RMF 1.0 MEASURE-2',
      'NIST AI RMF 1.0 MEASURE-4',
      'FATF Rec 1',
      'FDL No.10/2025 Art.20-22',
    ],
  };
}

// Exports for tests.
export const __test__ = {
  emptyCounts,
  addVerdict,
  adverseRate,
  freezeRate,
  twoProportionZ,
};
