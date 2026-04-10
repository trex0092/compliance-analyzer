import { describe, it, expect } from 'vitest';
import { rankAdverseMedia, type AdverseMediaHit } from '@/services/adverseMediaRanker';

const NOW = new Date('2026-04-10T00:00:00Z');

const hits: AdverseMediaHit[] = [
  {
    id: 'h1',
    entityNameQueried: 'Acme Metals LLC',
    headline: 'Acme Metals LLC indicted for money laundering in Dubai',
    snippet: 'The US Treasury announced charges against Acme Metals LLC for sanctions evasion...',
    sourceDomain: 'reuters.com',
    publishedAtIso: '2026-03-15T00:00:00Z',
    language: 'en',
  },
  {
    id: 'h2',
    entityNameQueried: 'Acme Metals LLC',
    headline: 'Acme Metals sues supplier over late delivery',
    snippet: 'Civil lawsuit filed in Dubai court...',
    sourceDomain: 'khaleejtimes.com',
    publishedAtIso: '2025-08-10T00:00:00Z',
    language: 'en',
  },
  {
    id: 'h3',
    entityNameQueried: 'Acme Metals LLC',
    headline: 'Coffee recommendations for Ramadan',
    snippet: 'A food blog article that mentions acme brand coffee',
    sourceDomain: 'someblog.net',
    publishedAtIso: '2024-01-01T00:00:00Z',
    language: 'en',
  },
];

describe('adverseMediaRanker — ranking', () => {
  it('criminal hit ranks above civil hit', () => {
    const report = rankAdverseMedia(hits, { now: NOW });
    expect(report.ranked[0].hit.id).toBe('h1');
    expect(report.ranked[0].impactCategory).toBe('critical');
  });

  it('low-signal hit ranks last', () => {
    const report = rankAdverseMedia(hits, { now: NOW });
    expect(report.ranked[report.ranked.length - 1].hit.id).toBe('h3');
  });

  it('tier-1 source boosts score', () => {
    const report = rankAdverseMedia(hits, { now: NOW });
    const h1 = report.ranked.find((r) => r.hit.id === 'h1');
    expect(h1!.factors.sourceCredibilityScore).toBe(1);
  });

  it('recency score decays over time', () => {
    const report = rankAdverseMedia(hits, { now: NOW });
    const h1 = report.ranked.find((r) => r.hit.id === 'h1');
    const h3 = report.ranked.find((r) => r.hit.id === 'h3');
    expect(h1!.factors.recencyScore).toBeGreaterThan(h3!.factors.recencyScore);
  });

  it('reports counts by impact category', () => {
    const report = rankAdverseMedia(hits, { now: NOW });
    const sum =
      report.counts.critical +
      report.counts.material +
      report.counts.ambient +
      report.counts['low-signal'];
    expect(sum).toBe(3);
    expect(report.counts.critical).toBeGreaterThanOrEqual(1);
  });

  it('top category follows the highest-impact present hit', () => {
    const report = rankAdverseMedia(hits, { now: NOW });
    expect(report.topCategory).toBe('critical');
  });
});

describe('adverseMediaRanker — edge cases', () => {
  it('empty input returns empty report', () => {
    const report = rankAdverseMedia([], { now: NOW });
    expect(report.ranked).toHaveLength(0);
    expect(report.topCategory).toBe('low-signal');
  });

  it('missing publication date yields neutral recency score', () => {
    const report = rankAdverseMedia(
      [
        {
          id: 'x',
          entityNameQueried: 'Test LLC',
          headline: 'Test LLC receives regulatory fine',
          sourceDomain: 'reuters.com',
          language: 'en',
        },
      ],
      { now: NOW },
    );
    expect(report.ranked[0].factors.recencyScore).toBe(0.5);
  });
});
