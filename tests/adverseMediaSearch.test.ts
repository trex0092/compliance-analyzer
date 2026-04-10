import { describe, it, expect } from 'vitest';
import {
  buildAdverseMediaQuery,
  resultToBrainEvent,
  type AdverseMediaResult,
} from '@/services/adverseMediaSearch';

describe('buildAdverseMediaQuery', () => {
  it('anchors the query on the subject name (SOLVES the original problem)', () => {
    const q = buildAdverseMediaQuery('Mohammed Al Rashid');
    expect(q).toContain('"Mohammed Al Rashid"');
  });

  it('includes the typology OR groups', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('"money laundering"');
    expect(q).toContain('"terrorist financing"');
    expect(q).toContain('"dual-use"');
  });

  it('includes UAE regulator signals', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('goAML');
    expect(q).toContain('EOCN');
    expect(q).toContain('CNMR');
  });

  it('includes negative exclusions', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('-"box office"');
    expect(q).toContain('-wrestling');
  });

  it('includes an after: date clause', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toMatch(/after:\d{4}-\d{2}-\d{2}/);
  });

  it('honours custom sinceDate', () => {
    const q = buildAdverseMediaQuery('x', { sinceDate: '2020-01-01' });
    expect(q).toContain('after:2020-01-01');
  });

  it('honours custom negative exclusions', () => {
    const q = buildAdverseMediaQuery('x', {
      negativeExclusions: ['hospital', '"health insurance"'],
    });
    expect(q).toContain('-hospital');
    expect(q).toContain('-"health insurance"');
  });

  it('throws on empty subject', () => {
    expect(() => buildAdverseMediaQuery('')).toThrow();
    expect(() => buildAdverseMediaQuery('   ')).toThrow();
  });

  it('escapes internal quotes in the subject name', () => {
    const q = buildAdverseMediaQuery('Joe "the boss" Smith');
    expect(q).toContain('\\"');
  });
});

describe('resultToBrainEvent', () => {
  const base = (hits: number): AdverseMediaResult => ({
    subject: 'Test Subject',
    query: 'q',
    provider: 'dry_run',
    hits: Array.from({ length: hits }, (_, i) => ({
      title: `Hit ${i}`,
      url: `https://example.com/${i}`,
      snippet: `snippet ${i}`,
      source: 'example.com',
    })),
    totalResults: hits,
    searchedAt: '2026-04-10T10:00:00Z',
  });

  it('severity = info when zero hits', () => {
    const ev = resultToBrainEvent(base(0), 'ref-1');
    expect(ev.severity).toBe('info');
  });

  it('severity = medium when 1-2 hits', () => {
    expect(resultToBrainEvent(base(1), 'ref-1').severity).toBe('medium');
    expect(resultToBrainEvent(base(2), 'ref-1').severity).toBe('medium');
  });

  it('severity = high when 3+ hits', () => {
    expect(resultToBrainEvent(base(3), 'ref-1').severity).toBe('high');
    expect(resultToBrainEvent(base(50), 'ref-1').severity).toBe('high');
  });

  it('kind is always manual', () => {
    expect(resultToBrainEvent(base(5), 'ref-1').kind).toBe('manual');
  });

  it('includes refId in the payload', () => {
    expect(resultToBrainEvent(base(1), 'my-ref').refId).toBe('my-ref');
  });

  it('caps meta.hits at 10 for payload size', () => {
    const ev = resultToBrainEvent(base(50), 'r');
    const meta = ev.meta as { hits: unknown[] };
    expect(meta.hits).toHaveLength(10);
  });

  it('includes provider in meta', () => {
    const ev = resultToBrainEvent(base(1), 'r');
    const meta = ev.meta as { provider: string };
    expect(meta.provider).toBe('dry_run');
  });
});
