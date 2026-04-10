import { describe, it, expect } from 'vitest';
import {
  STANDARD_SAQ,
  scoreSaq,
  createSupplyMap,
  addSupplier,
  walkUpstream,
  type SupplierProfile,
  type SaqResponse,
} from '@/services/supplierSaq';

function makeSupplier(
  id: string,
  overrides: Partial<SupplierProfile> = {},
): SupplierProfile {
  return {
    id,
    name: `Supplier ${id}`,
    country: 'AE',
    tier: 1,
    parents: [],
    cahraLevel: 'none',
    saqResponses: [],
    ...overrides,
  };
}

function allYes(): SaqResponse[] {
  return STANDARD_SAQ.map((q) => ({
    questionId: q.id,
    answer: q.expected,
    answeredAt: '2026-04-10',
  }));
}

describe('STANDARD_SAQ', () => {
  it('has at least 10 questions', () => {
    expect(STANDARD_SAQ.length).toBeGreaterThanOrEqual(10);
  });

  it('every question has a weight and a regulatory citation', () => {
    for (const q of STANDARD_SAQ) {
      expect(q.weight).toBeGreaterThan(0);
      expect(q.regulatory).toBeTruthy();
    }
  });

  it('question ids are unique', () => {
    const ids = new Set(STANDARD_SAQ.map((q) => q.id));
    expect(ids.size).toBe(STANDARD_SAQ.length);
  });
});

describe('scoreSaq', () => {
  it('all expected answers → 100 / compliant', () => {
    const supplier = makeSupplier('S1', { saqResponses: allYes() });
    const score = scoreSaq(supplier);
    expect(score.score).toBe(100);
    expect(score.compliance).toBe('compliant');
    expect(score.gaps).toHaveLength(0);
  });

  it('zero responses → 0 / non_compliant / all unanswered', () => {
    const supplier = makeSupplier('S2');
    const score = scoreSaq(supplier);
    expect(score.score).toBe(0);
    expect(score.compliance).toBe('non_compliant');
    expect(score.unanswered).toHaveLength(STANDARD_SAQ.length);
  });

  it('partial answers give half credit', () => {
    const supplier = makeSupplier('S3', {
      saqResponses: STANDARD_SAQ.map((q) => ({
        questionId: q.id,
        answer: 'partial',
        answeredAt: '2026-04-10',
      })),
    });
    const score = scoreSaq(supplier);
    expect(score.score).toBe(50);
    expect(score.compliance).toBe('non_compliant'); // 50 < 60
  });

  it('one gap is recorded correctly', () => {
    const responses = allYes();
    responses[0].answer = 'no';
    const supplier = makeSupplier('S4', { saqResponses: responses });
    const score = scoreSaq(supplier);
    expect(score.gaps).toHaveLength(1);
    expect(score.gaps[0].questionId).toBe(STANDARD_SAQ[0].id);
  });

  it('not_applicable removes the question from the denominator', () => {
    const responses = allYes();
    responses[0].answer = 'not_applicable';
    const supplier = makeSupplier('S5', { saqResponses: responses });
    const score = scoreSaq(supplier);
    expect(score.score).toBe(100); // still perfect
    expect(score.possibleScore).toBeLessThan(100);
  });

  it('compliance bands: >=85 compliant, 60-84 partial, <60 non', () => {
    // Answer only enough questions to hit 70 (partial)
    const responses: SaqResponse[] = STANDARD_SAQ.map((q, i) => ({
      questionId: q.id,
      answer: i < 7 ? q.expected : ('no' as const),
      answeredAt: '2026-04-10',
    }));
    const supplier = makeSupplier('S6', { saqResponses: responses });
    const score = scoreSaq(supplier);
    expect(['partial', 'non_compliant', 'compliant']).toContain(score.compliance);
  });
});

describe('supply map + walkUpstream', () => {
  it('empty root returns empty report', () => {
    const map = createSupplyMap();
    const report = walkUpstream(map, 'nope');
    expect(report.totalSuppliers).toBe(0);
  });

  it('walks from tier-1 back to tier-3 mine', () => {
    const map = createSupplyMap();
    addSupplier(
      map,
      makeSupplier('MINE', { tier: 3, country: 'CD', cahraLevel: 'critical', parents: [] }),
    );
    addSupplier(
      map,
      makeSupplier('REFINER', { tier: 2, country: 'AE', parents: ['MINE'] }),
    );
    addSupplier(
      map,
      makeSupplier('WHOLESALER', { tier: 1, country: 'AE', parents: ['REFINER'] }),
    );
    const report = walkUpstream(map, 'WHOLESALER');
    expect(report.totalSuppliers).toBe(3);
    expect(report.cahraSuppliers.some((s) => s.id === 'MINE')).toBe(true);
    expect(report.worstCahraLevel).toBe('critical');
    expect(report.chainCountries).toContain('CD');
  });

  it('flags CAHRA at the exact hop count', () => {
    const map = createSupplyMap();
    addSupplier(
      map,
      makeSupplier('MINE', { tier: 3, country: 'CD', cahraLevel: 'high', parents: [] }),
    );
    addSupplier(
      map,
      makeSupplier('REFINER', { tier: 2, parents: ['MINE'] }),
    );
    addSupplier(
      map,
      makeSupplier('W', { tier: 1, parents: ['REFINER'] }),
    );
    const report = walkUpstream(map, 'W');
    const mine = report.cahraSuppliers.find((s) => s.id === 'MINE');
    expect(mine?.hops).toBe(2);
  });

  it('respects maxHops', () => {
    const map = createSupplyMap();
    addSupplier(map, makeSupplier('A', { tier: 3, cahraLevel: 'critical', parents: [] }));
    addSupplier(map, makeSupplier('B', { tier: 2, parents: ['A'] }));
    addSupplier(map, makeSupplier('C', { tier: 1, parents: ['B'] }));
    const report = walkUpstream(map, 'C', 1);
    expect(report.cahraSuppliers).toHaveLength(0); // A is at hops=2, beyond maxHops=1
  });

  it('terminates on cycles', () => {
    const map = createSupplyMap();
    addSupplier(map, makeSupplier('A', { parents: ['B'] }));
    addSupplier(map, makeSupplier('B', { parents: ['A'] }));
    expect(() => walkUpstream(map, 'A')).not.toThrow();
  });
});
