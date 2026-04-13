import { describe, it, expect } from 'vitest';
import {
  buildEsgPortfolioScorecard,
  type CustomerEsgRecord,
} from '@/services/esgPortfolioScorecard';
import type { EsgScore, EsgPillarScore } from '@/services/esgScorer';

// --- Helpers ----------------------------------------------------------------

function pillar(p: 'E' | 'S' | 'G', score: number): EsgPillarScore {
  return {
    pillar: p,
    score,
    maxScore: 100 / 3,
    grade: 'C',
    gaps: [],
    strengths: [],
  };
}

function score(
  totalScore: number,
  grade: EsgScore['grade'],
  riskLevel: EsgScore['riskLevel'],
  e = 25,
  s = 25,
  g = 25
): EsgScore {
  return {
    entityId: 'ENT-' + Math.random().toString(36).slice(2, 8),
    totalScore,
    grade,
    riskLevel,
    pillars: { E: pillar('E', e), S: pillar('S', s), G: pillar('G', g) },
    criticalGaps: [],
    keyStrengths: [],
    narrative: '',
    disclosureCompleteness: 80,
  };
}

function record(
  id: string,
  total: number,
  grade: EsgScore['grade'],
  risk: EsgScore['riskLevel'],
  sector?: string,
  pillars?: { e?: number; s?: number; g?: number }
): CustomerEsgRecord {
  return {
    customerId: id,
    displayName: 'hash:' + id,
    score: score(total, grade, risk, pillars?.e ?? total / 3, pillars?.s ?? total / 3, pillars?.g ?? total / 3),
    sector,
  };
}

// --- Empty case -------------------------------------------------------------

describe('buildEsgPortfolioScorecard — empty portfolio', () => {
  it('returns zeroed scorecard with explanatory note', () => {
    const result = buildEsgPortfolioScorecard([], { generatedAtIso: '2026-04-13T00:00:00Z' });
    expect(result.totalCustomers).toBe(0);
    expect(result.pillarAverages.overallAvg).toBe(0);
    expect(result.gradeDistribution.A).toBe(0);
    expect(result.gradeDistribution.F).toBe(0);
    expect(result.riskDistribution.critical).toBe(0);
    expect(result.topRisks).toHaveLength(0);
    expect(result.bySector).toHaveLength(0);
    expect(result.notes).toContain('No customers in scope.');
  });
});

// --- Aggregation ------------------------------------------------------------

describe('buildEsgPortfolioScorecard — basic aggregation', () => {
  const portfolio: CustomerEsgRecord[] = [
    record('C1', 90, 'A', 'low', 'Refining', { e: 30, s: 28, g: 32 }),
    record('C2', 75, 'B', 'low', 'Refining', { e: 25, s: 25, g: 25 }),
    record('C3', 60, 'C', 'medium', 'Bullion Trading', { e: 20, s: 20, g: 20 }),
    record('C4', 45, 'D', 'high', 'Bullion Trading', { e: 15, s: 15, g: 15 }),
    record('C5', 20, 'F', 'critical', 'Mining (ASM)', { e: 5, s: 8, g: 7 }),
  ];

  it('counts customers correctly', () => {
    const result = buildEsgPortfolioScorecard(portfolio);
    expect(result.totalCustomers).toBe(5);
  });

  it('computes pillar averages', () => {
    const result = buildEsgPortfolioScorecard(portfolio);
    // E: (30+25+20+15+5)/5 = 19
    expect(result.pillarAverages.environmentalAvg).toBe(19);
    // S: (28+25+20+15+8)/5 = 19.2
    expect(result.pillarAverages.socialAvg).toBe(19.2);
    // G: (32+25+20+15+7)/5 = 19.8
    expect(result.pillarAverages.governanceAvg).toBe(19.8);
    // overall: (90+75+60+45+20)/5 = 58
    expect(result.pillarAverages.overallAvg).toBe(58);
  });

  it('counts grades and risks', () => {
    const result = buildEsgPortfolioScorecard(portfolio);
    expect(result.gradeDistribution).toEqual({ A: 1, B: 1, C: 1, D: 1, F: 1 });
    expect(result.riskDistribution).toEqual({ low: 2, medium: 1, high: 1, critical: 1 });
  });

  it('orders top risks by ascending overall score', () => {
    const result = buildEsgPortfolioScorecard(portfolio, { topN: 3 });
    expect(result.topRisks).toHaveLength(3);
    expect(result.topRisks[0].customerId).toBe('C5'); // worst
    expect(result.topRisks[1].customerId).toBe('C4');
    expect(result.topRisks[2].customerId).toBe('C3');
  });

  it('aggregates by sector', () => {
    const result = buildEsgPortfolioScorecard(portfolio);
    expect(result.bySector).toHaveLength(3);
    const refining = result.bySector.find((s) => s.sector === 'Refining');
    expect(refining?.count).toBe(2);
    expect(refining?.overallAvg).toBe(82.5); // (90+75)/2
    expect(refining?.grade).toBe('B'); // 82.5 → B (≥70)
    expect(refining?.risk).toBe('low'); // 82.5 → low (≥75)

    const asm = result.bySector.find((s) => s.sector === 'Mining (ASM)');
    expect(asm?.count).toBe(1);
    expect(asm?.overallAvg).toBe(20);
    expect(asm?.grade).toBe('F');
    expect(asm?.risk).toBe('critical');
  });

  it('sorts sectors ascending so worst is first', () => {
    const result = buildEsgPortfolioScorecard(portfolio);
    expect(result.bySector[0].sector).toBe('Mining (ASM)');
  });
});

// --- Notes / regulatory cues -----------------------------------------------

describe('buildEsgPortfolioScorecard — notes', () => {
  it('flags critical risk customers', () => {
    const result = buildEsgPortfolioScorecard([
      record('C1', 15, 'F', 'critical'),
      record('C2', 80, 'A', 'low'),
    ]);
    expect(result.notes.some((n) => n.includes('critical ESG risk'))).toBe(true);
    expect(result.notes.some((n) => n.includes('grade F'))).toBe(true);
  });

  it('flags low overall portfolio average', () => {
    const result = buildEsgPortfolioScorecard([
      record('C1', 30, 'D', 'high'),
      record('C2', 40, 'D', 'high'),
    ]);
    expect(result.notes.some((n) => n.includes('below 55'))).toBe(true);
  });

  it('reports clean portfolio with no flags', () => {
    const result = buildEsgPortfolioScorecard([
      record('C1', 88, 'A', 'low'),
      record('C2', 82, 'A', 'low'),
    ]);
    expect(result.notes).toContain('Portfolio ESG profile is within tolerance.');
  });
});

// --- Edge cases -------------------------------------------------------------

describe('buildEsgPortfolioScorecard — edge cases', () => {
  it('respects topN when fewer customers exist', () => {
    const result = buildEsgPortfolioScorecard(
      [record('C1', 50, 'C', 'medium')],
      { topN: 10 }
    );
    expect(result.topRisks).toHaveLength(1);
  });

  it('uses provided generatedAtIso', () => {
    const ts = '2026-04-13T12:00:00Z';
    const result = buildEsgPortfolioScorecard([record('C1', 50, 'C', 'medium')], {
      generatedAtIso: ts,
    });
    expect(result.generatedAtIso).toBe(ts);
  });

  it('handles portfolio with no sector tags (no bySector rollup)', () => {
    const result = buildEsgPortfolioScorecard([
      record('C1', 80, 'A', 'low'),
      record('C2', 60, 'C', 'medium'),
    ]);
    expect(result.bySector).toHaveLength(0);
  });

  it('counts bottom-quartile customers per pillar', () => {
    const result = buildEsgPortfolioScorecard([
      record('C1', 90, 'A', 'low', undefined, { e: 30, s: 30, g: 30 }),
      record('C2', 80, 'A', 'low', undefined, { e: 25, s: 25, g: 25 }),
      record('C3', 60, 'C', 'medium', undefined, { e: 20, s: 20, g: 20 }),
      record('C4', 30, 'D', 'high', undefined, { e: 5, s: 8, g: 7 }),
    ]);
    expect(result.bottomQuartileCounts.environmental).toBeGreaterThanOrEqual(1);
    expect(result.bottomQuartileCounts.social).toBeGreaterThanOrEqual(1);
    expect(result.bottomQuartileCounts.governance).toBeGreaterThanOrEqual(1);
  });
});
