/**
 * Tests for deepResearchEngine — the iterative search/reason/cite loop.
 *
 * The engine is fully dependency-injected so every test stubs search,
 * extract, and reason. No network, deterministic clock.
 */
import { describe, it, expect } from 'vitest';

import {
  runDeepResearch,
  redactPiiForExternalQuery,
  type DeepResearchDeps,
  type DeepResearchInput,
  type SearchHit,
} from '@/services/deepResearchEngine';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function baseInput(overrides: Partial<DeepResearchInput> = {}): DeepResearchInput {
  return {
    question: 'Has this entity been involved in money laundering?',
    entity: { displayName: 'Acme Trading LLC', jurisdiction: 'AE' },
    purpose: 'adverse_media',
    maxIterations: 2,
    maxQueriesPerIteration: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PII redactor
// ---------------------------------------------------------------------------

describe('redactPiiForExternalQuery', () => {
  it('redacts Emirates ID in any of the common formats', () => {
    const r1 = redactPiiForExternalQuery('lookup 784-1990-1234567-1');
    expect(r1.cleaned).toContain('[REDACTED:emirates_id]');
    expect(r1.fieldsFound).toContain('emirates_id');
    const r2 = redactPiiForExternalQuery('id 784199012345671');
    expect(r2.cleaned).toContain('[REDACTED:emirates_id]');
  });

  it('redacts IBAN, passport, account numbers, email, and phone', () => {
    const r = redactPiiForExternalQuery(
      'subject A1234567 IBAN AE070331234567890123456 acct 12345678901 ' +
        'email test@example.com phone +971501234567'
    );
    expect(r.fieldsFound).toEqual(
      expect.arrayContaining(['passport', 'iban', 'account_number', 'email', 'phone'])
    );
    expect(r.cleaned).not.toContain('test@example.com');
    expect(r.cleaned).not.toContain('+971501234567');
  });

  it('leaves PII-free text unchanged', () => {
    const r = redactPiiForExternalQuery('Acme Trading LLC sanctions violation');
    expect(r.cleaned).toBe('Acme Trading LLC sanctions violation');
    expect(r.fieldsFound).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Engine: termination conditions
// ---------------------------------------------------------------------------

describe('runDeepResearch — termination', () => {
  it('returns no_signal when reasoner is immediately done with empty claims', async () => {
    const clock = makeClock();
    const deps: DeepResearchDeps = {
      search: async () => [],
      extract: async () => null,
      reason: async () => ({
        newClaims: [],
        nextQueries: [],
        done: true,
        rationale: 'Nothing found.',
      }),
      now: clock.now,
    };
    const r = await runDeepResearch(baseInput(), deps);
    expect(r.terminationReason).toBe('no_signal');
    expect(r.verdictHint).toBe('no_signal');
    expect(r.confidence).toBe('low');
    expect(r.claims).toHaveLength(0);
  });

  it('caps at maxIterations and reports truncation honestly', async () => {
    const clock = makeClock();
    let calls = 0;
    const deps: DeepResearchDeps = {
      search: async () => [{ url: 'https://a.com/x', title: 't', snippet: 's' }],
      extract: async () => 'body',
      reason: async () => {
        calls++;
        return {
          newClaims: [],
          nextQueries: ['next-iteration-query'],
          done: false,
          rationale: 'keep going',
        };
      },
      now: clock.now,
    };
    const r = await runDeepResearch(baseInput({ maxIterations: 3 }), deps);
    expect(calls).toBe(3);
    expect(r.terminationReason).toBe('max_iterations');
  });

  it('honours wall-clock deadline', async () => {
    const clock = makeClock();
    const deps: DeepResearchDeps = {
      search: async () => {
        clock.advance(50);
        return [];
      },
      extract: async () => null,
      reason: async () => ({
        newClaims: [],
        nextQueries: ['x'],
        done: false,
        rationale: '',
      }),
      now: clock.now,
    };
    const r = await runDeepResearch(
      baseInput({ maxIterations: 50, deadlineMs: 100 }),
      deps
    );
    expect(r.truncated).toBe(true);
    expect(r.terminationReason).toBe('deadline');
  });
});

// ---------------------------------------------------------------------------
// Engine: PII safety
// ---------------------------------------------------------------------------

describe('runDeepResearch — PII safety', () => {
  it('redacts PII before sending to search backend (FDL Art.29 tip-off)', async () => {
    const clock = makeClock();
    const sentQueries: string[] = [];
    const deps: DeepResearchDeps = {
      search: async (q) => {
        sentQueries.push(q);
        return [];
      },
      extract: async () => null,
      reason: async () => ({ newClaims: [], nextQueries: [], done: true, rationale: '' }),
      now: clock.now,
    };
    const r = await runDeepResearch(
      baseInput({
        question: 'check 784-1990-1234567-1 and email john@acme.com',
      }),
      deps
    );
    expect(r.piiRedactionApplied).toBe(true);
    for (const q of sentQueries) {
      expect(q).not.toMatch(/784-1990-1234567-1/);
      expect(q).not.toMatch(/john@acme\.com/);
    }
    // Audit log captures BOTH the original (private) query and the sent (redacted) one.
    const searchEntries = r.auditLog.filter((e) => e.backend === 'search');
    expect(searchEntries.length).toBeGreaterThan(0);
    expect(searchEntries[0].originalQuery).toMatch(/784-1990-1234567-1/);
    expect(searchEntries[0].sentQuery).not.toMatch(/784-1990-1234567-1/);
    expect(searchEntries[0].redactedFields).toEqual(
      expect.arrayContaining(['emirates_id', 'email'])
    );
  });
});

// ---------------------------------------------------------------------------
// Engine: corroboration + citation discipline
// ---------------------------------------------------------------------------

describe('runDeepResearch — corroboration + citations', () => {
  it('drops claims with zero sources (citation discipline)', async () => {
    const clock = makeClock();
    const deps: DeepResearchDeps = {
      search: async () => [{ url: 'https://reuters.com/a', title: 't', snippet: 's' }],
      extract: async () => 'body',
      reason: async () => ({
        newClaims: [
          { text: 'Has good sources', sources: ['https://reuters.com/a'], severity: 'material' },
          { text: 'Has no sources at all', sources: [], severity: 'critical' },
        ],
        nextQueries: [],
        done: true,
        rationale: 'mixed',
      }),
      now: clock.now,
    };
    const r = await runDeepResearch(baseInput(), deps);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].text).toBe('Has good sources');
  });

  it('upgrades confidence to high when >= 2 distinct hostnames corroborate a critical claim', async () => {
    const clock = makeClock();
    const hits: SearchHit[] = [
      { url: 'https://reuters.com/a', title: 't', snippet: 's' },
      { url: 'https://bbc.com/b', title: 't', snippet: 's' },
    ];
    const deps: DeepResearchDeps = {
      search: async () => hits,
      extract: async () => 'body',
      reason: async () => ({
        newClaims: [
          {
            text: 'Subject was indicted for sanctions violation',
            sources: ['https://reuters.com/a', 'https://bbc.com/b'],
            severity: 'critical',
          },
        ],
        nextQueries: [],
        done: true,
        rationale: 'corroborated',
      }),
      now: clock.now,
    };
    const r = await runDeepResearch(baseInput(), deps);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].confidence).toBe('high');
    expect(r.claims[0].distinctHostnames).toBe(2);
    expect(r.verdictHint).toBe('critical');
  });

  it('keeps a critical claim at low confidence when only one source supports it', async () => {
    const clock = makeClock();
    const deps: DeepResearchDeps = {
      search: async () => [],
      extract: async () => null,
      reason: async () => ({
        newClaims: [
          {
            text: 'Allegation in a single blog post',
            sources: ['https://blogspot.example/x'],
            severity: 'critical',
          },
        ],
        nextQueries: [],
        done: true,
        rationale: 'thin',
      }),
      now: clock.now,
    };
    const r = await runDeepResearch(baseInput(), deps);
    expect(r.claims[0].confidence).toBe('low');
    // verdict still material_signal because severity=critical, but NOT 'critical'
    // because corroboration floor wasn't met.
    expect(r.verdictHint).toBe('material_signal');
  });

  it('builds an answer with inline numeric citations and a sources list', async () => {
    const clock = makeClock();
    const deps: DeepResearchDeps = {
      search: async () => [],
      extract: async () => null,
      reason: async () => ({
        newClaims: [
          {
            text: 'Indicted by US DOJ in 2024',
            sources: ['https://justice.gov/p1', 'https://reuters.com/p2'],
            severity: 'critical',
          },
          {
            text: 'Adverse media in regional press',
            sources: ['https://thenational.ae/q'],
            severity: 'material',
          },
        ],
        nextQueries: [],
        done: true,
        rationale: 'compose',
      }),
      now: clock.now,
    };
    const r = await runDeepResearch(baseInput(), deps);
    expect(r.answer).toMatch(/\[1\]/);
    expect(r.answer).toMatch(/\[2\]/);
    expect(r.answer).toMatch(/Sources:/);
    expect(r.answer).toMatch(/justice\.gov/);
    expect(r.answer).toMatch(/reuters\.com/);
  });
});

// ---------------------------------------------------------------------------
// Engine: bounded query budget
// ---------------------------------------------------------------------------

describe('runDeepResearch — bounded budget', () => {
  it('never dispatches more than maxQueriesPerIteration per round', async () => {
    const clock = makeClock();
    let queriesPerCall = 0;
    let maxQueriesObservedInOneRound = 0;
    const deps: DeepResearchDeps = {
      search: async () => {
        queriesPerCall++;
        return [];
      },
      extract: async () => null,
      reason: async () => {
        if (queriesPerCall > maxQueriesObservedInOneRound) {
          maxQueriesObservedInOneRound = queriesPerCall;
        }
        queriesPerCall = 0;
        return {
          newClaims: [],
          nextQueries: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], // 8 follow-ups
          done: false,
          rationale: '',
        };
      },
      now: clock.now,
    };
    await runDeepResearch(
      baseInput({ maxIterations: 3, maxQueriesPerIteration: 3 }),
      deps
    );
    expect(maxQueriesObservedInOneRound).toBeLessThanOrEqual(3);
  });

  it('records every external call in the audit log', async () => {
    const clock = makeClock();
    const deps: DeepResearchDeps = {
      search: async () => [
        { url: 'https://a.com/x', title: 't', snippet: 's' },
        { url: 'https://b.com/y', title: 't', snippet: 's' },
      ],
      extract: async () => 'body',
      reason: async () => ({
        newClaims: [],
        nextQueries: [],
        done: true,
        rationale: '',
      }),
      now: clock.now,
    };
    const r = await runDeepResearch(baseInput({ maxQueriesPerIteration: 1 }), deps);
    // 1 search call + 2 extract calls + 1 reason call = 4 audit entries
    expect(r.auditLog).toHaveLength(4);
    const backends = r.auditLog.map((e) => e.backend);
    expect(backends).toEqual(['search', 'extract', 'extract', 'reason']);
  });

  it('dedupes search hits by hostname before extract (extract budget bounded)', async () => {
    const clock = makeClock();
    const sameHostHits: SearchHit[] = Array.from({ length: 10 }, (_, i) => ({
      url: `https://samehost.com/p${i}`,
      title: 't',
      snippet: 's',
    }));
    let extractCalls = 0;
    const deps: DeepResearchDeps = {
      search: async () => sameHostHits,
      extract: async () => {
        extractCalls++;
        return 'body';
      },
      reason: async () => ({ newClaims: [], nextQueries: [], done: true, rationale: '' }),
      now: clock.now,
    };
    await runDeepResearch(baseInput(), deps);
    // All 10 hits are samehost.com → dedup leaves exactly 1 → 1 extract call
    expect(extractCalls).toBe(1);
  });
});
