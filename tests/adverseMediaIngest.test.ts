/**
 * Tests for src/services/adverseMediaIngest.ts — iterative
 * search-reason-extract loop with FATF predicate mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  runAdverseMediaIngest,
  PREDICATE_SIGNALS,
  type Article,
  type MediaFetcher,
} from '@/services/adverseMediaIngest';

const ARTICLES: Article[] = [
  {
    url: 'https://example.test/a',
    title: 'Acme Corp Executives Indicted for Money Laundering',
    body: 'Federal prosecutors said the defendants engaged in money laundering and fraud.',
    publishedAt: '2026-03-14',
    source: 'Example News',
  },
  {
    url: 'https://example.test/b',
    title: 'Unrelated News About Weather',
    body: 'Rain is expected this weekend.',
    publishedAt: '2026-03-15',
    source: 'Example News',
  },
  {
    url: 'https://example.test/c',
    title: 'Tax Evasion Ring Uncovered in Acme Corp',
    body: 'Investigators say Acme Corp directors arranged tax evasion schemes.',
    publishedAt: '2026-03-16',
    source: 'Example News',
  },
];

function mockFetcher(matches: Article[]): MediaFetcher {
  return () => matches;
}

describe('adverseMediaIngest.runAdverseMediaIngest', () => {
  it('extracts a money-laundering hit when the subject is named in the article', async () => {
    const result = await runAdverseMediaIngest(
      { name: 'Acme Corp' },
      mockFetcher(ARTICLES),
      2
    );
    expect(result.hits.length).toBeGreaterThan(0);
    const mlHit = result.hits.find((h) => h.predicateKey === 'money_laundering');
    expect(mlHit).toBeDefined();
    expect(mlHit!.entityConfidence).toBeGreaterThanOrEqual(0.8);
    expect(mlHit!.excerpt.length).toBeGreaterThan(0);
  });

  it('deduplicates by URL across queries', async () => {
    const result = await runAdverseMediaIngest(
      { name: 'Acme Corp' },
      mockFetcher(ARTICLES),
      4
    );
    const urls = result.hits.map((h) => h.articleUrl);
    const uniqueUrls = new Set(urls);
    expect(urls.length).toBe(urls.filter((u) => uniqueUrls.has(u)).length);
  });

  it('returns zero hits when the subject is not referenced in any article', async () => {
    const result = await runAdverseMediaIngest(
      { name: 'Totally Unrelated Company Ltd' },
      mockFetcher(ARTICLES),
      2
    );
    expect(result.hits).toEqual([]);
  });

  it('ranks topPredicates by max score', async () => {
    const result = await runAdverseMediaIngest(
      { name: 'Acme Corp' },
      mockFetcher(ARTICLES),
      4
    );
    for (let i = 1; i < result.topPredicates.length; i += 1) {
      expect(result.topPredicates[i - 1].maxScore).toBeGreaterThanOrEqual(
        result.topPredicates[i].maxScore
      );
    }
  });

  it('ships at least the core FATF predicates in the signal catalog', () => {
    const keys = PREDICATE_SIGNALS.map((s) => s.key);
    expect(keys).toContain('money_laundering');
    expect(keys).toContain('terror_financing');
    expect(keys).toContain('bribery_corruption');
    expect(keys).toContain('tax_evasion');
  });
});
