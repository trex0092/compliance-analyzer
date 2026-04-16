/**
 * Tests for Phase 6 Weaponized Brain subsystems (#31-#59).
 *
 * One file, 10 subsystems, 3-5 focused tests each.
 */
import { describe, it, expect } from 'vitest';

import { expandNameVariants } from '@/services/nameVariantExpander';
import { dedupeCrossListHits } from '@/services/crossListSanctionsDedupe';
import { walkCorporateGraph, type CorporateGraph } from '@/services/corporateGraphWalker';
import { gradeStrNarrative } from '@/services/strNarrativeGrader';
import { lintForTippingOff, assertNoTippingOff } from '@/services/tippingOffLinter';
import { checkBenfordLaw } from '@/services/benfordLawChecker';
import { detectDormancyActivity } from '@/services/dormancyActivityDetector';
import { detectVerdictDrift } from '@/services/verdictDriftMonitor';
import { detectAdvisorHallucinations } from '@/services/advisorHallucinationDetector';
import { bootstrapConfidenceInterval } from '@/services/confidenceIntervalBootstrap';

// ---------------------------------------------------------------------------
// #31 nameVariantExpander
// ---------------------------------------------------------------------------

describe('nameVariantExpander', () => {
  it('strips honorifics and produces multiple variants', () => {
    const r = expandNameVariants('Dr. Sheikh Mohammed Al Nahyan');
    expect(r.variants.length).toBeGreaterThanOrEqual(2);
    // Stripped variant should not start with 'dr sheikh'
    expect(r.variants.some((v) => !v.includes('dr') && !v.includes('sheikh'))).toBe(true);
  });

  it('produces a 4-character soundex code', () => {
    const r = expandNameVariants('Smith');
    expect(r.soundex).toMatch(/^[A-Z]\d{3}$/);
  });

  it('canonicalises case + diacritics', () => {
    const r = expandNameVariants('  José   García  ');
    expect(r.canonical).toBe('jose garcia');
  });

  it('expands initial swap for multi-token names', () => {
    const r = expandNameVariants('Michael Smith');
    expect(r.initialSwap).toBe('m smith');
  });

  it('romanises Mandarin (Han) input via pinyin lookup', () => {
    const r = expandNameVariants('王伟');
    expect(r.cjkRoman.length).toBeGreaterThan(0);
    // First character "王" → "wang"; given character "伟" → "wei"
    expect(r.cjkRoman.some((v) => v.includes('wang'))).toBe(true);
    expect(r.cjkRoman.some((v) => v.includes('wei'))).toBe(true);
    // Romanisations must also flow into the variants set.
    expect(r.variants.some((v) => v.includes('wang'))).toBe(true);
  });

  it('romanises Korean Hangul input via Revised Romanisation', () => {
    const r = expandNameVariants('김민');
    expect(r.cjkRoman.length).toBeGreaterThan(0);
    expect(r.cjkRoman.some((v) => v.includes('kim'))).toBe(true);
  });

  it('romanises Japanese surname via Hepburn lookup', () => {
    const r = expandNameVariants('田中太郎');
    expect(r.cjkRoman.length).toBeGreaterThan(0);
    expect(r.cjkRoman.some((v) => v.startsWith('tanaka'))).toBe(true);
  });

  it('returns empty cjkRoman for pure Latin input', () => {
    const r = expandNameVariants('Michael Smith');
    expect(r.cjkRoman).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #32 crossListSanctionsDedupe
// ---------------------------------------------------------------------------

describe('crossListSanctionsDedupe', () => {
  it('merges two hits for the same subject from different lists', () => {
    const r = dedupeCrossListHits([
      { list: 'UN', matchedName: 'John Doe', matchScore: 0.95, birthYear: 1970 },
      { list: 'OFAC', matchedName: 'John Doe', matchScore: 0.92, birthYear: 1970 },
    ]);
    expect(r.output).toBe(1);
    expect(r.hits[0].primaryList).toBe('UN');
    expect(r.hits[0].sources.length).toBe(2);
  });

  it('keeps distinct subjects separate', () => {
    const r = dedupeCrossListHits([
      { list: 'UN', matchedName: 'Alpha', matchScore: 0.9 },
      { list: 'OFAC', matchedName: 'Beta', matchScore: 0.9 },
    ]);
    expect(r.output).toBe(2);
  });

  it('max score tracks the highest across sources', () => {
    const r = dedupeCrossListHits([
      { list: 'UN', matchedName: 'Same', matchScore: 0.7 },
      { list: 'EU', matchedName: 'Same', matchScore: 0.95 },
    ]);
    expect(r.hits[0].maxScore).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// #33 corporateGraphWalker
// ---------------------------------------------------------------------------

describe('corporateGraphWalker', () => {
  const graph: CorporateGraph = new Map([
    ['root', { id: 'root', name: 'Query Co', subsidiaries: ['sub1', 'sub2'] }],
    ['sub1', { id: 'sub1', name: 'Clean Sub', parents: ['root'] }],
    ['sub2', { id: 'sub2', name: 'Dirty Sub', parents: ['root'] }],
  ]);

  it('finds a flagged subsidiary via predicate', () => {
    const r = walkCorporateGraph(graph, 'root', (n) =>
      n.id === 'sub2' ? { flagged: true, reason: 'on blocklist' } : { flagged: false }
    );
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].nodeId).toBe('sub2');
    expect(r.hits[0].hops).toBe(1);
  });

  it('respects maxHops', () => {
    const deep: CorporateGraph = new Map([
      ['root', { id: 'root', name: 'R', subsidiaries: ['a'] }],
      ['a', { id: 'a', name: 'A', subsidiaries: ['b'] }],
      ['b', { id: 'b', name: 'B', subsidiaries: ['c'] }],
      ['c', { id: 'c', name: 'C', subsidiaries: [] }],
    ]);
    const r = walkCorporateGraph(deep, 'root', (n) => ({ flagged: n.id === 'c' }), 1);
    expect(r.hits.length).toBe(0); // 'c' is at hops=3, beyond limit
  });

  it('does not flag the query node itself', () => {
    const r = walkCorporateGraph(graph, 'root', () => ({ flagged: true, reason: 'everyone' }));
    // 'root' should not appear in hits even though predicate returns true
    expect(r.hits.some((h) => h.nodeId === 'root')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #38 strNarrativeGrader
// ---------------------------------------------------------------------------

describe('strNarrativeGrader', () => {
  it('high-quality narrative scores filing_ready', () => {
    const narrative =
      'On 15/03/2026, customer Acme Gold LLC (case ID CASE-001) executed 8 cash deposits ' +
      'of AED 52,500 each at the Dubai Gold Souk counter. The pattern matches DPMS threshold ' +
      'structuring typology T3 under MoE Circular 08/AML/2021. Compliance Officer analysed ' +
      'transaction IDs TX-4401 through TX-4408 and observed suspicious layering before onward ' +
      'wire to a high-risk jurisdiction. Reporting per FDL No.10/2025 Art.26-27.';
    const r = gradeStrNarrative({ narrative });
    expect(r.totalScore).toBeGreaterThanOrEqual(100);
    expect(r.verdict).toBe('filing_ready');
  });

  it('boilerplate narrative scores rewrite_required', () => {
    const r = gradeStrNarrative({
      narrative: 'The customer exhibited unusual behaviour and was flagged by the system.',
    });
    expect(r.verdict).toBe('rewrite_required');
    expect(r.gaps.length).toBeGreaterThan(0);
  });

  it('missing citation drops the citation dimension to zero', () => {
    const r = gradeStrNarrative({
      narrative: 'Customer transferred AED 500,000 on 15/03/2026 in Dubai with suspicious layering via wire transfer.',
    });
    expect(r.dimensions.citation).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #39 tippingOffLinter
// ---------------------------------------------------------------------------

describe('tippingOffLinter', () => {
  it('flags explicit STR filing mention as critical', () => {
    const r = lintForTippingOff('Dear customer, we filed an STR with the FIU about your account.');
    expect(r.clean).toBe(false);
    expect(r.topSeverity).toBe('critical');
  });

  it('clean message passes', () => {
    const r = lintForTippingOff('Thank you for your recent transaction. Your receipt is attached.');
    expect(r.clean).toBe(true);
  });

  it('assertNoTippingOff throws on critical', () => {
    expect(() =>
      assertNoTippingOff('Your account has been frozen by the sanctions team.')
    ).toThrow(/Art.29/);
  });

  it('assertNoTippingOff allows clean text', () => {
    expect(() => assertNoTippingOff('Your transaction receipt is attached.')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// #41 benfordLawChecker
// ---------------------------------------------------------------------------

describe('benfordLawChecker', () => {
  it('returns insufficient_data for small samples', () => {
    const r = checkBenfordLaw([1, 2, 3]);
    expect(r.status).toBe('insufficient_data');
  });

  // Deterministic PRNG (mulberry32) so the chi-squared check below is stable
  // across runs. Math.random() with N=300 occasionally crosses the suspicious
  // threshold by chance and produces flaky CI failures.
  const seededRandom = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it('natural Benford distribution passes the check', () => {
    const rng = seededRandom(0xbe2f0d);
    // Generate values that follow Benford (10^x, base 10)
    const amounts: number[] = [];
    for (let i = 0; i < 300; i++) {
      amounts.push(Math.pow(10, rng() * 5));
    }
    const r = checkBenfordLaw(amounts);
    expect(r.status).toBe('ok');
  });

  it('uniform distribution is flagged as suspicious', () => {
    const rng = seededRandom(0x517a1f);
    const amounts: number[] = [];
    for (let i = 0; i < 300; i++) {
      // Uniform distribution of amounts 100-999 → first digit uniform → not Benford
      amounts.push(100 + Math.floor(rng() * 900));
    }
    const r = checkBenfordLaw(amounts);
    expect(r.status).toBe('suspicious');
  });
});

// ---------------------------------------------------------------------------
// #46 dormancyActivityDetector
// ---------------------------------------------------------------------------

describe('dormancyActivityDetector', () => {
  it('detects dormant-then-burst pattern', () => {
    const base = Date.parse('2026-01-01T00:00:00Z');
    const r = detectDormancyActivity([
      { customerId: 'C1', at: new Date(base).toISOString(), amountAED: 1000 },
      { customerId: 'C1', at: new Date(base + 86400000).toISOString(), amountAED: 1000 },
      { customerId: 'C1', at: new Date(base + 2 * 86400000).toISOString(), amountAED: 1000 },
      // 100-day gap
      {
        customerId: 'C1',
        at: new Date(base + 100 * 86400000).toISOString(),
        amountAED: 50000,
      },
    ]);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].customerId).toBe('C1');
    expect(r.hits[0].gapDays).toBeGreaterThanOrEqual(90);
  });

  it('no hit when activity is consistent', () => {
    const base = Date.parse('2026-01-01T00:00:00Z');
    const txs = Array.from({ length: 5 }, (_, i) => ({
      customerId: 'C1',
      at: new Date(base + i * 86400000).toISOString(),
      amountAED: 1000,
    }));
    const r = detectDormancyActivity(txs);
    expect(r.hits.length).toBe(0);
  });

  it('skips customers with too few transactions', () => {
    const r = detectDormancyActivity([
      { customerId: 'C1', at: '2026-01-01T00:00:00Z', amountAED: 100 },
    ]);
    expect(r.hits.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #55 verdictDriftMonitor
// ---------------------------------------------------------------------------

describe('verdictDriftMonitor', () => {
  it('stable distribution does not flag drift', () => {
    const r = detectVerdictDrift({
      currentWeek: { pass: 100, flag: 10, escalate: 5, freeze: 2 },
      baseline: { pass: 100, flag: 10, escalate: 5, freeze: 2 },
    });
    expect(r.hasDrift).toBe(false);
  });

  it('extreme shift is flagged', () => {
    const r = detectVerdictDrift({
      currentWeek: { pass: 0, flag: 0, escalate: 0, freeze: 100 },
      baseline: { pass: 100, flag: 10, escalate: 5, freeze: 2 },
    });
    expect(r.hasDrift).toBe(true);
  });

  it('zero baseline for a verdict is handled without crash', () => {
    const r = detectVerdictDrift({
      currentWeek: { pass: 10, flag: 0, escalate: 0, freeze: 0 },
      baseline: { pass: 10, flag: 0, escalate: 0, freeze: 0 },
    });
    expect(r.hasDrift).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #58 advisorHallucinationDetector
// ---------------------------------------------------------------------------

describe('advisorHallucinationDetector', () => {
  it('real citations are clean', () => {
    const r = detectAdvisorHallucinations(
      'Per FDL No.10/2025 Art.26-27 and Cabinet Res 74/2020 Art.4-7, freeze protocol applies.'
    );
    expect(r.clean).toBe(true);
    expect(r.totalCitationsValidated).toBeGreaterThan(0);
  });

  it('fabricated citation with high article number is flagged high-confidence', () => {
    const r = detectAdvisorHallucinations('Per FDL Art.500, the CO must act.');
    expect(r.clean).toBe(false);
    expect(r.findings[0].confidence).toBe('high');
  });

  it('future-year citation is flagged high-confidence', () => {
    const r = detectAdvisorHallucinations('Under Cabinet Res 999/2099, this is required.');
    expect(r.clean).toBe(false);
    expect(r.findings.some((f) => f.confidence === 'high')).toBe(true);
  });

  it('text without citations is clean', () => {
    const r = detectAdvisorHallucinations('Review the case and decide.');
    expect(r.clean).toBe(true);
    expect(r.totalCitationsFound).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #59 confidenceIntervalBootstrap
// ---------------------------------------------------------------------------

describe('confidenceIntervalBootstrap', () => {
  it('empty contributions returns zero CI', () => {
    const r = bootstrapConfidenceInterval({ contributions: [] });
    expect(r.pointEstimate).toBe(0);
    expect(r.halfWidth).toBe(0);
  });

  it('consistent contributions have tight CI', () => {
    const r = bootstrapConfidenceInterval({
      contributions: [0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
    });
    expect(r.pointEstimate).toBeCloseTo(0.8, 2);
    expect(r.halfWidth).toBeLessThan(0.05);
  });

  it('diverse contributions have wider CI', () => {
    const r = bootstrapConfidenceInterval({
      contributions: [0.9, 0.9, 0.9, 0.9, 0.3],
    });
    expect(r.halfWidth).toBeGreaterThan(0);
  });

  it('deterministic for same seed', () => {
    const a = bootstrapConfidenceInterval({
      contributions: [0.5, 0.7, 0.9],
      seed: 42,
    });
    const b = bootstrapConfidenceInterval({
      contributions: [0.5, 0.7, 0.9],
      seed: 42,
    });
    expect(a.lower95).toBe(b.lower95);
    expect(a.upper95).toBe(b.upper95);
  });

  it('mean aggregator produces different result than min', () => {
    const min = bootstrapConfidenceInterval({
      contributions: [0.9, 0.9, 0.5],
      aggregator: 'min',
    });
    const mean = bootstrapConfidenceInterval({
      contributions: [0.9, 0.9, 0.5],
      aggregator: 'mean',
    });
    expect(mean.pointEstimate).toBeGreaterThan(min.pointEstimate);
  });
});
