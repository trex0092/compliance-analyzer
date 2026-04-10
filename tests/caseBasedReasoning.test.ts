import { describe, it, expect } from 'vitest';
import { CaseMemory, cosineSimilarity, type PastCase } from '@/services/caseBasedReasoning';

const mk = (
  id: string,
  features: Record<string, number>,
  outcome: PastCase['outcome'],
  confidence = 1,
): PastCase => ({
  id,
  features,
  outcome,
  confidence,
  summary: `case ${id}`,
  regulatoryRefs: ['FDL Art.19'],
  decidedAtIso: '2026-01-01T00:00:00Z',
});

describe('caseBasedReasoning — similarity', () => {
  it('identical vectors have similarity 1', () => {
    expect(cosineSimilarity({ a: 1, b: 2 }, { a: 1, b: 2 })).toBeCloseTo(1);
  });

  it('orthogonal vectors have similarity 0', () => {
    expect(cosineSimilarity({ a: 1 }, { b: 1 })).toBe(0);
  });

  it('weights amplify matching features', () => {
    const s1 = cosineSimilarity({ a: 1, b: 1 }, { a: 1, b: 0 });
    const s2 = cosineSimilarity({ a: 1, b: 1 }, { a: 1, b: 0 }, { a: 10 });
    expect(s2).toBeGreaterThan(s1);
  });
});

describe('caseBasedReasoning — retrieval', () => {
  const mem = new CaseMemory({ sanctionsHit: 3, cash: 1.5 });
  mem.retain(mk('C1', { sanctionsHit: 1, cash: 1, pep: 0 }, 'freeze'));
  mem.retain(mk('C2', { sanctionsHit: 0, cash: 1, pep: 1 }, 'edd'));
  mem.retain(mk('C3', { sanctionsHit: 0, cash: 0, pep: 0 }, 'no-action'));
  mem.retain(mk('C4', { sanctionsHit: 1, cash: 0.8, pep: 1 }, 'freeze'));

  it('retrieves most similar cases for sanctioned query', () => {
    const results = mem.retrieve({ sanctionsHit: 1, cash: 1, pep: 0 }, 3);
    expect(results[0].case.id).toBe('C1');
    expect(results[0].similarity).toBeGreaterThan(0.9);
  });

  it('ignores cases with zero similarity', () => {
    const results = mem.retrieve({ sanctionsHit: 0, cash: 0, pep: 0 }, 5);
    // C3 is the only zero-vector case; cosine with zero query = 0
    expect(results.length).toBe(0);
  });

  it('top-K limit is respected', () => {
    const results = mem.retrieve({ sanctionsHit: 1, cash: 1, pep: 1 }, 2);
    expect(results).toHaveLength(2);
  });
});

describe('caseBasedReasoning — reuse', () => {
  const mem = new CaseMemory();
  mem.retain(mk('S1', { structuring: 1, cash: 1 }, 'str-filed', 1));
  mem.retain(mk('S2', { structuring: 1, cash: 1 }, 'str-filed', 0.9));
  mem.retain(mk('S3', { structuring: 1, cash: 1 }, 'edd', 0.5));

  it('recommends majority outcome weighted by similarity + confidence', () => {
    const r = mem.reuse({ structuring: 1, cash: 1 }, 5);
    expect(r.recommendedOutcome).toBe('str-filed');
    expect(r.supportingCases).toHaveLength(2);
    expect(r.dissentingCases).toHaveLength(1);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('defaults to monitor when no precedents exist', () => {
    const empty = new CaseMemory();
    const r = empty.reuse({ a: 1 });
    expect(r.recommendedOutcome).toBe('monitor');
    expect(r.confidence).toBe(0);
  });
});

describe('caseBasedReasoning — retain feedback loop', () => {
  it('retain adds new case, replace by id updates', () => {
    const mem = new CaseMemory();
    mem.retain(mk('X1', { a: 1 }, 'monitor'));
    expect(mem.size()).toBe(1);
    mem.retain(mk('X1', { a: 1 }, 'freeze'));
    expect(mem.size()).toBe(1);
    expect(mem.snapshot()[0].outcome).toBe('freeze');
  });
});
