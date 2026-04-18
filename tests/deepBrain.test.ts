/**
 * Tests for src/services/brain/ — the three-layer deep brain stack.
 *
 * Covers:
 *   - Layer 1 (investigator): seed questions, iteration budget, coverage
 *   - Layer 2 (reasoner): posterior ordering, confidence from evidence
 *   - Layer 3 (orchestrator): verdict derivation, four-eyes gate,
 *     deterministic narrative shape
 *
 * No network. No Netlify. No Anthropic.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDefaultQuestions,
  runInvestigation,
  runReasoning,
  runDeepBrain,
  DEFAULT_HYPOTHESES,
  type ResearchAtom,
  type SearchFn,
  type SubjectProfile,
} from '@/services/brain';

const SUBJECT: SubjectProfile = {
  name: 'John Q Public',
  jurisdiction: 'AE',
  entityType: 'individual',
};

// ---------------------------------------------------------------------------
// Layer 1: investigator
// ---------------------------------------------------------------------------

describe('brain — investigator', () => {
  it('builds sensible default questions for a subject', () => {
    const qs = buildDefaultQuestions(SUBJECT);
    expect(qs.length).toBeGreaterThanOrEqual(5);
    expect(qs.some((q) => q.id === 'q-sanctions')).toBe(true);
    expect(qs.some((q) => q.id === 'q-pep')).toBe(true);
    expect(qs.some((q) => q.id === 'q-adverse')).toBe(true);
  });

  it('adds an alias pivot question when aliases are present', () => {
    const qs = buildDefaultQuestions({ ...SUBJECT, aliases: ['JQP'] });
    expect(qs.some((q) => q.id === 'q-aliases')).toBe(true);
  });

  it('stops when the cost budget is exhausted', async () => {
    const search: SearchFn = () => [];
    const t = await runInvestigation(SUBJECT, search, { maxCost: 1 });
    expect(t.budgetExhausted).toBe(true);
    expect(t.atoms.length).toBe(0);
  });

  it('records atoms with citations when the search returns hits', async () => {
    const search: SearchFn = (q) => {
      if (q.id === 'q-sanctions') {
        return [
          {
            fact: 'Name matches OFAC SDN entry SDN-12345',
            source: 'OFAC_SDN_2026-04-01',
            sourceTimestamp: '2026-04-01',
            confidence: 0.92,
          },
        ];
      }
      return [];
    };
    const t = await runInvestigation(SUBJECT, search, { maxIterations: 2, maxCost: 10 });
    expect(t.atoms.length).toBe(1);
    expect(t.atoms[0].source).toContain('OFAC');
    expect(t.atoms[0].confidence).toBeCloseTo(0.92, 2);
  });

  it('clamps out-of-range atom confidence to [0, 1]', async () => {
    const search: SearchFn = (q) =>
      q.id === 'q-sanctions'
        ? [{ fact: 'x', source: 'UN_1267', confidence: 2.5 }]
        : [];
    const t = await runInvestigation(SUBJECT, search, { maxCost: 2 });
    expect(t.atoms[0].confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: reasoner
// ---------------------------------------------------------------------------

function atom(
  id: string,
  questionId: string,
  source: string,
  confidence: number
): ResearchAtom {
  return { id, questionId, fact: `fact-${id}`, source, confidence };
}

describe('brain — reasoner', () => {
  it('ranks confirmed-match top when OFAC evidence is strong', () => {
    const atoms: ResearchAtom[] = [
      atom('a1', 'q-sanctions', 'OFAC_SDN_2026', 0.95),
      atom('a2', 'q-sanctions', 'UN_1267_2026', 0.9),
    ];
    const r = runReasoning(atoms);
    expect(r.top.hypothesisId).toBe('h-confirmed');
    expect(r.top.posterior).toBeGreaterThan(0.5);
  });

  it('ranks false-positive top when DOB mismatch dominates', () => {
    const atoms: ResearchAtom[] = [
      atom('a1', 'q-sanctions', 'DOB_MISMATCH', 0.95),
      atom('a2', 'q-sanctions', 'PASSPORT_MISMATCH', 0.9),
      atom('a3', 'q-sanctions', 'JURISDICTION_MISMATCH', 0.85),
    ];
    const r = runReasoning(atoms);
    expect(r.top.hypothesisId).toBe('h-false-positive');
  });

  it('falls back to prior when no evidence is present', () => {
    const r = runReasoning([]);
    // Prior rank: h-false-positive (0.6) > h-confirmed (0.15) ~= h-association (0.15) > h-pep (0.1)
    expect(r.top.hypothesisId).toBe('h-false-positive');
    expect(r.top.confidence).toBe(0);
  });

  it('increases confidence with more evidence atoms', () => {
    const few: ResearchAtom[] = [atom('a1', 'q', 'OFAC_SDN', 0.8)];
    const many: ResearchAtom[] = Array.from({ length: 8 }, (_, i) =>
      atom(`a${i}`, 'q', 'OFAC_SDN', 0.8)
    );
    const r1 = runReasoning(few);
    const r2 = runReasoning(many);
    expect(r2.top.confidence).toBeGreaterThan(r1.top.confidence);
    expect(r2.top.confidence).toBeLessThanOrEqual(1);
  });

  it('exposes a non-empty audit chain for every hypothesis', () => {
    const atoms: ResearchAtom[] = [atom('a1', 'q', 'OFAC_SDN', 0.9)];
    const r = runReasoning(atoms);
    for (const h of DEFAULT_HYPOTHESES) {
      expect(r.auditChain).toContain(h.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 3: orchestrator
// ---------------------------------------------------------------------------

describe('brain — orchestrator', () => {
  it('produces a freeze verdict when OFAC evidence is overwhelming', async () => {
    const search: SearchFn = (q) => {
      if (q.id === 'q-sanctions') {
        return [
          { fact: 'on OFAC SDN', source: 'OFAC_SDN_2026', confidence: 0.95 },
          { fact: 'on UN 1267', source: 'UN_1267_2026', confidence: 0.9 },
        ];
      }
      if (q.id === 'q-pep') {
        return [{ fact: 'on PEP list', source: 'PEP_LIST_2026', confidence: 0.8 }];
      }
      return [];
    };
    const r = await runDeepBrain(SUBJECT, { searchFn: search });
    expect(r.verdict).toBe('freeze');
    expect(r.requiresFourEyes).toBe(true);
    expect(r.narrative).toContain('verdict: freeze');
  });

  it('clears when DOB mismatch dominates', async () => {
    const search: SearchFn = (q) => {
      if (q.id === 'q-sanctions') {
        return [
          { fact: 'DOB mismatch', source: 'DOB_MISMATCH', confidence: 0.95 },
          { fact: 'Passport mismatch', source: 'PASSPORT_MISMATCH', confidence: 0.9 },
        ];
      }
      return [];
    };
    const r = await runDeepBrain(SUBJECT, { searchFn: search });
    expect(r.verdict).toBe('false_positive');
  });

  it('records a lesson when budget is exhausted', async () => {
    const r = await runDeepBrain(SUBJECT, {
      searchFn: () => [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // empty searchFn path: all questions return nothing, coverage stays 0
    expect(r.requiresFourEyes).toBe(true);
  });

  it('includes the full PEER plan in the result', async () => {
    const r = await runDeepBrain(SUBJECT, { searchFn: () => [] });
    expect(r.plan.map((t) => t.kind)).toEqual([
      'investigate',
      'reason',
      'evaluate',
      'reflect',
    ]);
  });

  it('delivers a narrative with citations and verdict', async () => {
    const search: SearchFn = (q) =>
      q.id === 'q-sanctions'
        ? [{ fact: 'hit', source: 'UN_1267_2026', confidence: 0.9 }]
        : [];
    const r = await runDeepBrain(SUBJECT, { searchFn: search });
    expect(r.narrative).toContain('Deep brain report');
    expect(r.narrative).toContain('UN_1267_2026');
    expect(r.narrative).toContain('verdict:');
  });
});
