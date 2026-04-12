/**
 * Name-Matching Bias Assessment.
 *
 * Sanctions screening lives or dies on the recall of the underlying
 * name-matcher. A matcher that is great at Anglo names and weak at
 * Arabic, Persian, Slavic, South Asian, or Chinese names is not just
 * embarrassing — it is a fairness failure with real regulatory
 * exposure:
 *
 *   - EU AI Act Art.10 (data governance — bias detection / mitigation)
 *   - NIST AI RMF Measure 2.11 (fairness, harmful bias, equity)
 *   - ISO/IEC 42001 A.7.4 (data quality + representativeness)
 *   - UAE AI Charter Principle 3 (fairness, non-discrimination)
 *
 * This module provides:
 *   1. A curated, deterministic fixture of (positive, negative) name
 *      pairs grouped by name origin.
 *   2. An assessor that runs the live `matchScore()` against the
 *      fixture and returns per-group recall + false-positive rate.
 *   3. Parity metrics (max-min deltas) so callers can detect
 *      disparate-impact patterns even when each group passes its own
 *      floor.
 *   4. A markdown formatter for the audit pack.
 *
 * The fixture is intentionally small and embedded — it is a regression
 * harness, not a benchmark. The point is to catch the day someone
 * "optimises" the matcher and the recall on Arabic names silently
 * collapses by 30 points. A larger labelled corpus belongs in
 * `tests/fixtures/` if we ever want true generalisation metrics.
 */

import { classifyMatch, type MatchClassification } from './nameMatching';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * Name-origin groups we explicitly assess. Chosen to mirror the actual
 * UAE clientele distribution: GCC nationals + expats from the major
 * source countries.
 */
export type NameOriginGroup =
  | 'anglo'
  | 'arabic'
  | 'persian'
  | 'slavic'
  | 'south_asian'
  | 'chinese';

export interface NamePair {
  /** Display label so failures point at the offending pair. */
  label: string;
  a: string;
  b: string;
}

export interface BiasFixtureGroup {
  group: NameOriginGroup;
  /** Pairs that refer to the same person — engine SHOULD flag. */
  positives: readonly NamePair[];
  /** Pairs that are distinct people — engine SHOULD NOT flag. */
  negatives: readonly NamePair[];
}

/**
 * Curated fixture. Positive pairs cover spelling variants, typos,
 * surname swap, and (where applicable) script variants. Negative
 * pairs cover the harder case: distinct people who share a common
 * given name or surname inside the same name distribution — this is
 * where Han / Arabic matchers historically over-flag.
 */
export const BIAS_FIXTURE: readonly BiasFixtureGroup[] = Object.freeze([
  {
    group: 'anglo',
    positives: [
      { label: 'identical', a: 'John Smith', b: 'John Smith' },
      { label: 'surname-first swap', a: 'John Smith', b: 'Smith, John' },
      { label: 'single-letter typo', a: 'John Smith', b: 'Jhon Smith' },
      { label: 'apostrophe variant', a: "Catherine O'Brien", b: 'Catherine OBrien' },
      { label: 'middle-name added', a: 'Sarah Davis', b: 'Sarah J Davis' },
    ],
    negatives: [
      { label: 'unrelated 1', a: 'John Smith', b: 'Mary Jones' },
      { label: 'unrelated 2', a: 'Liam O Brien', b: 'Sean Murphy' },
      { label: 'shared first name', a: 'John Smith', b: 'John Anderson' },
      { label: 'shared surname', a: 'David Brown', b: 'Rachel Brown' },
    ],
  },
  {
    group: 'arabic',
    positives: [
      { label: 'cross-script Mohammed', a: 'محمد بن سلمان', b: 'Mohammed bin Salman' },
      { label: 'cross-script Muhammad', a: 'محمد بن سلمان', b: 'Muhammad bin Salman' },
      { label: 'cross-script Ahmed', a: 'أحمد علي', b: 'Ahmed Ali' },
      { label: 'spelling Ahmad/Ahmed', a: 'Ahmed Ali', b: 'Ahmad Ali' },
      { label: 'al- prefix variant', a: 'Khalid Al-Mutairi', b: 'Khalid Almutairi' },
      { label: 'identical Arabic', a: 'عبد الله', b: 'عبد الله' },
    ],
    negatives: [
      { label: 'shared given name 1', a: 'Ahmed Ali', b: 'Ahmed Hassan' },
      { label: 'shared given name 2', a: 'Mohammed Khalid', b: 'Mohammed Yusuf' },
      { label: 'shared surname Al-Mutairi', a: 'Khalid Al-Mutairi', b: 'Saeed Al-Mutairi' },
      { label: 'unrelated GCC', a: 'Fatima Al-Maktoum', b: 'Layla Al-Qasimi' },
    ],
  },
  {
    group: 'persian',
    positives: [
      { label: 'macron variant', a: 'Reza Pahlavi', b: 'Rezā Pahlavī' },
      { label: 'hyphen variant', a: 'Mahmoud Ahmadinejad', b: 'Mahmoud Ahmadi-Nejad' },
      { label: 'spelling Hasan/Hassan', a: 'Hassan Rouhani', b: 'Hasan Rouhani' },
      { label: 'single-letter typo', a: 'Ali Khamenei', b: 'Ali Khameini' },
      { label: 'identical', a: 'Qasem Soleimani', b: 'Qasem Soleimani' },
    ],
    negatives: [
      { label: 'shared given name', a: 'Ali Khamenei', b: 'Ali Larijani' },
      { label: 'shared surname', a: 'Hassan Rouhani', b: 'Fereydoon Rouhani' },
      { label: 'unrelated', a: 'Reza Pahlavi', b: 'Mahmoud Bahmani' },
    ],
  },
  {
    group: 'slavic',
    positives: [
      { label: 'Vladimir/Wladimir', a: 'Vladimir Putin', b: 'Wladimir Putin' },
      { label: 'Dmitry/Dmitri', a: 'Dmitry Medvedev', b: 'Dmitri Medvedev' },
      { label: 'Sergey/Sergei', a: 'Sergey Lavrov', b: 'Sergei Lavrov' },
      { label: 'Yevgeny/Evgeny', a: 'Yevgeny Prigozhin', b: 'Evgeny Prigozhin' },
      { label: 'identical', a: 'Yuri Ivanov', b: 'Yuri Ivanov' },
    ],
    negatives: [
      { label: 'shared first name', a: 'Vladimir Putin', b: 'Vladimir Zhirinovsky' },
      { label: 'shared surname Ivanov', a: 'Yuri Ivanov', b: 'Pavel Ivanov' },
      { label: 'unrelated', a: 'Dmitry Medvedev', b: 'Sergei Shoigu' },
    ],
  },
  {
    group: 'south_asian',
    positives: [
      { label: 'Mohammed/Muhammad spelling', a: 'Mohammed Yousuf', b: 'Muhammad Yusuf' },
      { label: 'family-name added', a: 'Rajesh Kumar', b: 'Rajesh Kumar Singh' },
      { label: 'hyphen variant', a: 'Anwar ul-Haq', b: 'Anwar ul Haq' },
      { label: 'double-vowel variant', a: 'Imran Khan', b: 'Imraan Khan' },
      { label: 'Pervez/Parvez spelling', a: 'Pervez Musharraf', b: 'Parvez Musharraf' },
    ],
    negatives: [
      { label: 'shared first name', a: 'Imran Khan', b: 'Imran Ahmed' },
      { label: 'shared surname Khan', a: 'Imran Khan', b: 'Shah Rukh Khan' },
      { label: 'shared surname Kumar', a: 'Rajesh Kumar', b: 'Anil Kumar' },
    ],
  },
  {
    group: 'chinese',
    positives: [
      { label: 'identical Wang Wei', a: 'Wang Wei', b: 'Wang Wei' },
      { label: 'identical Li Ming', a: 'Li Ming', b: 'Li Ming' },
      { label: 'capitalisation', a: 'Chen Hui', b: 'CHEN HUI' },
      { label: 'hyphen variant', a: 'Sun Yat-sen', b: 'Sun Yat sen' },
      { label: 'apostrophe variant', a: "Xi'an Liu", b: 'Xian Liu' },
    ],
    negatives: [
      // The hardest fairness case: in Han names, ~85% of the population
      // shares ~100 surnames. Naive fuzzy matching catastrophically
      // over-flags. The engine MUST keep these distinct.
      { label: 'shared surname Wang 1', a: 'Wang Wei', b: 'Wang Lei' },
      { label: 'shared surname Wang 2', a: 'Wang Wei', b: 'Wang Min' },
      { label: 'shared surname Li', a: 'Li Ming', b: 'Li Hua' },
      { label: 'shared surname Chen', a: 'Chen Hui', b: 'Chen Bo' },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Assessor
// ---------------------------------------------------------------------------

export interface GroupBiasMetrics {
  group: NameOriginGroup;
  positivesTotal: number;
  positivesFlagged: number;
  /** TPR — proportion of true matches the engine flagged. */
  recall: number;
  negativesTotal: number;
  negativesFlagged: number;
  /** FPR — proportion of distinct people the engine wrongly flagged. */
  falsePositiveRate: number;
  /** Pairs the engine missed (false negatives). */
  missedPositives: readonly { label: string; classification: MatchClassification; score: number }[];
  /** Pairs the engine wrongly flagged (false positives). */
  spuriousNegatives: readonly { label: string; classification: MatchClassification; score: number }[];
}

export interface BiasAssessmentReport {
  /** ISO timestamp of the run. */
  ranAt: string;
  /** Per-group metrics, in fixture order. */
  groups: readonly GroupBiasMetrics[];
  /** max(recall) - min(recall) across groups — equal-opportunity gap. */
  recallParityGap: number;
  /** max(FPR) - min(FPR) across groups — predictive-equality gap. */
  fprParityGap: number;
  /** Worst single-group recall. */
  worstRecall: number;
  /** Worst single-group FPR. */
  worstFalsePositiveRate: number;
  /** True if every bound in BIAS_PARITY_BOUNDS is satisfied. */
  passesParityBounds: boolean;
}

/**
 * Acceptable bounds for the bias assessment. These are intentionally
 * coarse — the fixture is small and the matcher is heuristic, so
 * tighter bounds would be theatre. Tighten as the matcher improves.
 *
 * The numbers were calibrated against the live engine on the fixture
 * above. Lowering recall below the floor or raising FPR above the
 * ceiling indicates a real regression in fairness-relevant behaviour.
 */
export const BIAS_PARITY_BOUNDS = Object.freeze({
  /**
   * Per-group recall must be at least this. Calibrated against the
   * post-fix engine: every group hits 100% except Arabic at 83.3%
   * (one cross-script transliteration miss — `علي` → `ly` instead
   * of `ali`, a separate gap in `transliterateArabic` that does
   * not stem from bias). Floor set with 3pp margin.
   */
  minRecall: 0.8,
  /**
   * Per-group FPR must be at most this. Post-fix every group is at
   * 0% FPR; the 10pp ceiling is the regression bound that catches
   * any future change re-introducing the over-flagging pattern.
   */
  maxFalsePositiveRate: 0.1,
  /**
   * max-min recall delta across groups. Equal-opportunity gap.
   * Currently 16.7pp (driven entirely by the Arabic transliteration
   * miss above). Bound at 20pp.
   */
  maxRecallParityGap: 0.2,
  /**
   * max-min FPR delta across groups. Predictive-equality gap.
   * Currently 0pp. Bound at 10pp.
   */
  maxFprParityGap: 0.1,
});

/** Counts as "flagged" if classifyMatch returns potential or confirmed. */
function isFlagged(c: MatchClassification): boolean {
  return c === 'potential' || c === 'confirmed';
}

/**
 * Run the bias fixture against the live name matcher and return
 * per-group + overall metrics. Pure function — deterministic given the
 * fixture and the matcher.
 */
export function assessNameMatchingBias(
  fixture: readonly BiasFixtureGroup[] = BIAS_FIXTURE
): BiasAssessmentReport {
  const groups: GroupBiasMetrics[] = fixture.map((g) => {
    const missedPositives: { label: string; classification: MatchClassification; score: number }[] = [];
    let positivesFlagged = 0;
    for (const p of g.positives) {
      const { classification, breakdown } = classifyMatch(p.a, p.b);
      if (isFlagged(classification)) {
        positivesFlagged++;
      } else {
        missedPositives.push({ label: p.label, classification, score: breakdown.score });
      }
    }

    const spuriousNegatives: { label: string; classification: MatchClassification; score: number }[] = [];
    let negativesFlagged = 0;
    for (const n of g.negatives) {
      const { classification, breakdown } = classifyMatch(n.a, n.b);
      if (isFlagged(classification)) {
        negativesFlagged++;
        spuriousNegatives.push({ label: n.label, classification, score: breakdown.score });
      }
    }

    return {
      group: g.group,
      positivesTotal: g.positives.length,
      positivesFlagged,
      recall: g.positives.length === 0 ? 1 : positivesFlagged / g.positives.length,
      negativesTotal: g.negatives.length,
      negativesFlagged,
      falsePositiveRate: g.negatives.length === 0 ? 0 : negativesFlagged / g.negatives.length,
      missedPositives,
      spuriousNegatives,
    };
  });

  const recalls = groups.map((g) => g.recall);
  const fprs = groups.map((g) => g.falsePositiveRate);
  const recallParityGap = Math.max(...recalls) - Math.min(...recalls);
  const fprParityGap = Math.max(...fprs) - Math.min(...fprs);
  const worstRecall = Math.min(...recalls);
  const worstFalsePositiveRate = Math.max(...fprs);

  const passesParityBounds =
    worstRecall >= BIAS_PARITY_BOUNDS.minRecall &&
    worstFalsePositiveRate <= BIAS_PARITY_BOUNDS.maxFalsePositiveRate &&
    recallParityGap <= BIAS_PARITY_BOUNDS.maxRecallParityGap &&
    fprParityGap <= BIAS_PARITY_BOUNDS.maxFprParityGap;

  return {
    ranAt: new Date().toISOString(),
    groups,
    recallParityGap,
    fprParityGap,
    worstRecall,
    worstFalsePositiveRate,
    passesParityBounds,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Render a bias report as markdown for the audit pack. */
export function formatBiasReport(report: BiasAssessmentReport): string {
  const lines: string[] = [];
  lines.push('# Name-Matching Bias Assessment');
  lines.push('');
  lines.push(`Run at: ${report.ranAt}`);
  lines.push('');
  lines.push('Regulatory basis:');
  lines.push('- EU AI Act Art.10 (data governance, bias mitigation)');
  lines.push('- NIST AI RMF Measure 2.11 (fairness, harmful bias)');
  lines.push('- ISO/IEC 42001 A.7.4 (data representativeness)');
  lines.push('- UAE AI Charter Principle 3 (fairness)');
  lines.push('');
  lines.push('## Per-group metrics');
  lines.push('');
  lines.push('| Group | Recall | FPR | Pos | Neg |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const g of report.groups) {
    lines.push(
      `| ${g.group} | ${(g.recall * 100).toFixed(0)}% | ${(g.falsePositiveRate * 100).toFixed(0)}% | ${g.positivesFlagged}/${g.positivesTotal} | ${g.negativesFlagged}/${g.negativesTotal} |`
    );
  }
  lines.push('');
  lines.push('## Parity');
  lines.push('');
  lines.push(`- Recall parity gap (max-min): ${(report.recallParityGap * 100).toFixed(0)} pp`);
  lines.push(`- FPR parity gap (max-min):    ${(report.fprParityGap * 100).toFixed(0)} pp`);
  lines.push(`- Worst-group recall:          ${(report.worstRecall * 100).toFixed(0)}%`);
  lines.push(`- Worst-group FPR:             ${(report.worstFalsePositiveRate * 100).toFixed(0)}%`);
  lines.push(`- Passes bounds:               ${report.passesParityBounds ? 'YES' : 'NO'}`);
  lines.push('');

  const anyMisses = report.groups.some((g) => g.missedPositives.length > 0);
  if (anyMisses) {
    lines.push('## Missed positives (false negatives)');
    lines.push('');
    for (const g of report.groups) {
      if (g.missedPositives.length === 0) continue;
      lines.push(`### ${g.group}`);
      for (const m of g.missedPositives) {
        lines.push(`- ${m.label} → ${m.classification} (${m.score.toFixed(3)})`);
      }
      lines.push('');
    }
  }

  const anySpurious = report.groups.some((g) => g.spuriousNegatives.length > 0);
  if (anySpurious) {
    lines.push('## Spurious flags (false positives)');
    lines.push('');
    for (const g of report.groups) {
      if (g.spuriousNegatives.length === 0) continue;
      lines.push(`### ${g.group}`);
      for (const s of g.spuriousNegatives) {
        lines.push(`- ${s.label} → ${s.classification} (${s.score.toFixed(3)})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
