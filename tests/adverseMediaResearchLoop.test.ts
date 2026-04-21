/**
 * Tests for src/services/adverseMediaResearchLoop — the iterative
 * search → rank → extract → cite pipeline that replaces single-shot
 * headline scraping.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runAdverseMediaResearch,
  __INTERNAL__,
  type SearchHit,
  type ResearchSubject,
} from '../src/services/adverseMediaResearchLoop';

const FIXED_NOW = Date.parse('2026-04-20T12:00:00Z');
const isoDaysAgo = (n: number): string =>
  new Date(FIXED_NOW - n * 24 * 60 * 60 * 1000).toISOString();

function fakeSearch(map: Record<string, SearchHit[]>) {
  const calls: string[] = [];
  const fn = vi.fn(async (query: string) => {
    calls.push(query);
    // Match by first topic present in the query.
    for (const key of Object.keys(map)) {
      if (query.includes(key)) return map[key];
    }
    return [];
  });
  return { fn, calls };
}

describe('adverseMediaResearchLoop — input validation', () => {
  it('throws when the subject name is missing', async () => {
    await expect(
      runAdverseMediaResearch({ name: '' } as unknown as ResearchSubject, {
        search: vi.fn(),
        nowMs: () => FIXED_NOW,
      })
    ).rejects.toThrow(/subject\.name/);
  });
});

describe('adverseMediaResearchLoop — loop mechanics', () => {
  it('iterates across topics with bounded query count and rate-limits results', async () => {
    const { fn } = fakeSearch({});
    const result = await runAdverseMediaResearch(
      {
        name: 'Acme Metals FZE',
        topics: ['fraud', 'sanctions'],
      },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.iterationsRun).toBe(1);
    expect(result.queriesIssued).toHaveLength(2);
    expect(result.queriesIssued.every((q) => q.includes('Acme Metals FZE'))).toBe(true);
    expect(result.claims).toHaveLength(0);
    expect(result.coverage.topicsHit).toEqual([]);
    expect(result.coverage.topicsMissed).toEqual(['fraud', 'sanctions']);
  });

  it('caps search results per iteration', async () => {
    const bulk: SearchHit[] = Array.from({ length: 50 }, (_, i) => ({
      url: `https://example.com/${i}`,
      title: `fraud allegation ${i}`,
      snippet: 'alleged fraud',
      publishedAtIso: isoDaysAgo(10),
      relevance: 0.9,
    }));
    const { fn } = fakeSearch({ fraud: bulk });
    const res = await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(res.hitsConsidered).toBe(__INTERNAL__.MAX_RESULTS_PER_ITERATION);
  });

  it('caps total iterations at MAX_ITERATIONS even with many topics', async () => {
    const { fn } = fakeSearch({});
    const topics = Array.from({ length: 20 }, (_, i) => `topic-${i}`);
    await runAdverseMediaResearch({ name: 'Acme', topics }, { search: fn, nowMs: () => FIXED_NOW });
    // 2 topics per iteration * MAX_ITERATIONS = 8 queries cap.
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2 * __INTERNAL__.MAX_ITERATIONS);
  });
});

describe('adverseMediaResearchLoop — query building (FDL Art.29)', () => {
  it('quotes the subject name and pairs it with a neutral topic (no tipping off)', async () => {
    const { fn } = fakeSearch({});
    await runAdverseMediaResearch(
      { name: 'Acme Metals FZE', topics: ['bribery'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(fn.mock.calls[0][0]).toBe('"Acme Metals FZE" bribery');
  });

  it('appends jurisdiction bias when provided', async () => {
    const { fn } = fakeSearch({});
    await runAdverseMediaResearch(
      { name: 'Acme', topics: ['sanctions'], jurisdictions: ['AE'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(fn.mock.calls[0][0]).toBe('"Acme" sanctions AE');
  });

  it('never leaks verdict language into the query', async () => {
    const { fn } = fakeSearch({});
    await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    const q = fn.mock.calls[0][0];
    expect(q).not.toMatch(/confirmed|verified|guilty|STR|freeze|reported/i);
  });
});

describe('adverseMediaResearchLoop — dedup + rank', () => {
  it('collapses identical URLs and near-duplicate titles', () => {
    const hits: SearchHit[] = [
      { url: 'https://a.example/1', title: 'Acme Metals fraud probe', snippet: '' },
      { url: 'https://a.example/1', title: 'DUPLICATE URL', snippet: '' },
      { url: 'https://b.example/2', title: 'acme metals fraud PROBE!', snippet: '' },
      { url: 'https://c.example/3', title: 'Different headline entirely', snippet: '' },
    ];
    const out = __INTERNAL__.dedupeHits(hits);
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.url).sort()).toEqual(['https://a.example/1', 'https://c.example/3']);
  });

  it('ranks fresh hits above stale hits at equal relevance', () => {
    // Recency tie-breaker: equal relevance, different age → fresher wins.
    // Formula: 0.6 * relevance + 0.4 * recency_score.
    const hits: SearchHit[] = [
      {
        url: 'https://x/1',
        title: 'old',
        snippet: '',
        publishedAtIso: isoDaysAgo(400),
        relevance: 0.7,
      },
      {
        url: 'https://x/2',
        title: 'fresh',
        snippet: '',
        publishedAtIso: isoDaysAgo(10),
        relevance: 0.7,
      },
    ];
    const ranked = __INTERNAL__.rankHits(hits, FIXED_NOW);
    expect(ranked[0].title).toBe('fresh');
    expect(ranked[0].rankScore).toBeGreaterThan(ranked[1].rankScore);
  });
});

describe('adverseMediaResearchLoop — extraction + citations', () => {
  it('extracts only claims with a negative-tone marker', async () => {
    const { fn } = fakeSearch({
      fraud: [
        {
          url: 'https://reuters.com/story-1',
          title: 'Acme charged with fraud',
          snippet: 'Acme was charged with fraud last week.',
          publishedAtIso: isoDaysAgo(10),
          relevance: 0.9,
        },
        {
          url: 'https://reuters.com/story-2',
          title: 'Acme opens new office',
          snippet: 'A routine expansion.',
          publishedAtIso: isoDaysAgo(20),
          relevance: 0.4,
        },
      ],
    });
    const res = await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0].factKey).toBe('fraud');
    expect(res.claims[0].sourceUrl).toBe('https://reuters.com/story-1');
    expect(res.claims[0].toneConfidence).toBeGreaterThan(0);
  });

  it('every emitted citation carries a URL, domain, and supports list', async () => {
    const { fn } = fakeSearch({
      fraud: [
        {
          url: 'https://reuters.com/story-1',
          title: 'Acme charged with fraud',
          snippet: 'alleged',
          publishedAtIso: isoDaysAgo(5),
          relevance: 0.8,
        },
      ],
    });
    const res = await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(res.citations).toHaveLength(1);
    const c = res.citations[0];
    expect(c.url).toBe('https://reuters.com/story-1');
    expect(c.domain).toBe('reuters.com');
    expect(c.publishedAtIso).toBeDefined();
    expect(c.supports).toEqual(['fraud']);
  });

  it('orders citations by descending recency', async () => {
    const { fn } = fakeSearch({
      fraud: [
        {
          url: 'https://a/old',
          title: 'Acme fraud (old)',
          snippet: 'alleged',
          publishedAtIso: isoDaysAgo(200),
          relevance: 0.9,
        },
        {
          url: 'https://a/new',
          title: 'Acme fraud (new)',
          snippet: 'alleged',
          publishedAtIso: isoDaysAgo(10),
          relevance: 0.9,
        },
      ],
    });
    const res = await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(res.citations[0].url).toBe('https://a/new');
    expect(res.citations[1].url).toBe('https://a/old');
  });

  it('drops results older than MAX_AGE_DAYS', async () => {
    const { fn } = fakeSearch({
      fraud: [
        {
          url: 'https://old/1',
          title: 'Acme fraud ancient',
          snippet: 'alleged',
          publishedAtIso: isoDaysAgo(__INTERNAL__.MAX_AGE_DAYS + 10),
          relevance: 0.9,
        },
      ],
    });
    const res = await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(res.claims).toHaveLength(0);
  });
});

describe('adverseMediaResearchLoop — contradictions', () => {
  it('surfaces a contradiction when high-tone + low-tone claims share a fact key', () => {
    const claims = [
      {
        factKey: 'fraud',
        value: 'high',
        sourceUrl: 'u1',
        sourceDomain: 'a',
        toneConfidence: 0.9,
        matchedTopic: 'fraud',
      },
      {
        factKey: 'fraud',
        value: 'low',
        sourceUrl: 'u2',
        sourceDomain: 'b',
        toneConfidence: 0.2,
        matchedTopic: 'fraud',
      },
    ];
    const out = __INTERNAL__.findContradictions(claims);
    expect(out).toHaveLength(1);
    expect(out[0].factKey).toBe('fraud');
    expect(out[0].note).toContain('MLRO review required');
  });
});

describe('adverseMediaResearchLoop — coverage', () => {
  it('reports topicsHit vs topicsMissed and unique domains', async () => {
    const { fn } = fakeSearch({
      fraud: [
        {
          url: 'https://reuters.com/1',
          title: 'Acme fraud alleged',
          snippet: 'alleged fraud',
          publishedAtIso: isoDaysAgo(5),
          relevance: 0.9,
        },
      ],
      sanctions: [
        {
          url: 'https://bloomberg.com/1',
          title: 'Acme sanctions probe',
          snippet: 'alleged sanctions',
          publishedAtIso: isoDaysAgo(5),
          relevance: 0.9,
        },
      ],
    });
    const res = await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud', 'sanctions', 'bribery'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(res.coverage.topicsHit.sort()).toEqual(['fraud', 'sanctions']);
    expect(res.coverage.topicsMissed).toEqual(['bribery']);
    expect(res.coverage.domainsUnique).toBeGreaterThanOrEqual(2);
    expect(res.coverage.freshResultsPct).toBeGreaterThan(0);
  });
});

describe('adverseMediaResearchLoop — regulatory invariants', () => {
  it('always returns the six regulatory citations on any successful run', async () => {
    const { fn } = fakeSearch({});
    const res = await runAdverseMediaResearch(
      { name: 'Acme', topics: ['fraud'] },
      { search: fn, nowMs: () => FIXED_NOW }
    );
    expect(res.regulatoryCitations).toEqual(
      expect.arrayContaining([
        'FDL No.(10)/2025 Art.14',
        'FDL No.(10)/2025 Art.20-21',
        'FDL No.(10)/2025 Art.24',
        'FDL No.(10)/2025 Art.29',
        'FATF Rec 10 §10.12',
        'MoE Circular 08/AML/2021',
      ])
    );
  });
});
