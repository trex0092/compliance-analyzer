/**
 * Tests for the name-matching bias assessment harness.
 *
 * These tests are the regression bounds the AI Governance self-audit
 * cites when reporting `hasBiasAssessment: true`. They are intentionally
 * coarse — the point is to catch the day someone "optimises" the
 * matcher and recall on Arabic / Persian / Slavic names silently
 * collapses, not to benchmark a state-of-the-art transliteration
 * model.
 *
 * Regulatory basis:
 *   - EU AI Act Art.10
 *   - NIST AI RMF Measure 2.11
 *   - ISO/IEC 42001 A.7.4
 *   - UAE AI Charter Principle 3
 */

import { describe, it, expect } from 'vitest';
import {
  assessNameMatchingBias,
  formatBiasReport,
  BIAS_FIXTURE,
  BIAS_PARITY_BOUNDS,
} from '@/services/nameMatchingBiasAssessment';

describe('name-matching bias assessment — fixture', () => {
  it('covers every declared origin group', () => {
    const groups = BIAS_FIXTURE.map((g) => g.group);
    expect(groups).toContain('anglo');
    expect(groups).toContain('arabic');
    expect(groups).toContain('persian');
    expect(groups).toContain('slavic');
    expect(groups).toContain('south_asian');
    expect(groups).toContain('chinese');
  });

  it('every group has at least 3 positive and 3 negative pairs', () => {
    for (const g of BIAS_FIXTURE) {
      expect(g.positives.length).toBeGreaterThanOrEqual(3);
      expect(g.negatives.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('name-matching bias assessment — assessor', () => {
  const report = assessNameMatchingBias();

  it('produces a metrics row for every group', () => {
    expect(report.groups.length).toBe(BIAS_FIXTURE.length);
    for (const g of report.groups) {
      expect(g.positivesTotal).toBeGreaterThan(0);
      expect(g.negativesTotal).toBeGreaterThan(0);
      expect(g.recall).toBeGreaterThanOrEqual(0);
      expect(g.recall).toBeLessThanOrEqual(1);
      expect(g.falsePositiveRate).toBeGreaterThanOrEqual(0);
      expect(g.falsePositiveRate).toBeLessThanOrEqual(1);
    }
  });

  it('worst-group recall meets the documented floor', () => {
    expect(report.worstRecall).toBeGreaterThanOrEqual(BIAS_PARITY_BOUNDS.minRecall);
  });

  it('worst-group FPR stays under the documented ceiling', () => {
    expect(report.worstFalsePositiveRate).toBeLessThanOrEqual(
      BIAS_PARITY_BOUNDS.maxFalsePositiveRate
    );
  });

  it('recall parity gap stays inside bounds', () => {
    expect(report.recallParityGap).toBeLessThanOrEqual(BIAS_PARITY_BOUNDS.maxRecallParityGap);
  });

  it('FPR parity gap stays inside bounds', () => {
    expect(report.fprParityGap).toBeLessThanOrEqual(BIAS_PARITY_BOUNDS.maxFprParityGap);
  });

  it('reports a single overall pass flag consistent with the bounds', () => {
    const expected =
      report.worstRecall >= BIAS_PARITY_BOUNDS.minRecall &&
      report.worstFalsePositiveRate <= BIAS_PARITY_BOUNDS.maxFalsePositiveRate &&
      report.recallParityGap <= BIAS_PARITY_BOUNDS.maxRecallParityGap &&
      report.fprParityGap <= BIAS_PARITY_BOUNDS.maxFprParityGap;
    expect(report.passesParityBounds).toBe(expected);
  });
});

describe('name-matching bias assessment — markdown report', () => {
  it('renders the headings, parity block, and a row per group', () => {
    const report = assessNameMatchingBias();
    const md = formatBiasReport(report);
    expect(md).toContain('# Name-Matching Bias Assessment');
    expect(md).toContain('## Per-group metrics');
    expect(md).toContain('## Parity');
    expect(md).toContain('Recall parity gap');
    expect(md).toContain('FPR parity gap');
    for (const g of BIAS_FIXTURE) {
      expect(md).toContain(g.group);
    }
  });
});
