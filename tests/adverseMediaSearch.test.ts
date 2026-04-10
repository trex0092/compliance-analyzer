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

  it('includes the TF / extremism lexicon', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('extremist');
    expect(q).toContain('radicalisation');
    expect(q).toContain('militant');
    expect(q).toContain('"designated terrorist"');
  });

  it('includes the document fraud + cybercrime lexicon', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('forgery');
    expect(q).toContain('counterfeiting');
    expect(q).toContain('"identity theft"');
    expect(q).toContain('"cyber fraud"');
    expect(q).toContain('"wire fraud"');
    expect(q).toContain('cybercrime');
    expect(q).toContain('ransomware');
    expect(q).toContain('darknet');
  });

  it('includes the augmented financial-crime lexicon', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('"financial crime"');
    expect(q).toContain('"economic crime"');
    expect(q).toContain('"tax fraud"');
    expect(q).toContain('"pyramid scheme"');
    expect(q).toContain('"accounting fraud"');
    expect(q).toContain('"asset misappropriation"');
    expect(q).toContain('blackmail');
    expect(q).toContain('extort');
  });

  it('includes the augmented PF / WMD lexicon', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('"biological weapons"');
    expect(q).toContain('WMD'); // shorter form chosen over "weapons of mass destruction"
  });

  it('includes the augmented trafficking / governance lexicon', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('narcotics');
    expect(q).toContain('"people smuggling"');
    expect(q).toContain('"forced labour"');
    expect(q).toContain('"conflict of interest"');
    expect(q).toContain('"misuse of funds"');
  });

  it('includes the augmented sanctions-action lexicon', () => {
    const q = buildAdverseMediaQuery('x');
    expect(q).toContain('debarred');
    expect(q).toContain('blacklisted');
  });

  it('preserves the structural guarantees: subject anchor + negatives + date', () => {
    // Regression guard: the merge MUST keep these three structural features.
    // Without them, precision collapses regardless of how many terms are added.
    const q = buildAdverseMediaQuery('Test Subject');
    expect(q).toContain('"Test Subject"'); // subject anchored
    expect(q).toContain('-"box office"'); // negatives present
    expect(q).toMatch(/after:\d{4}-\d{2}-\d{2}/); // date filter present
  });

  it('does NOT include noisy terms that produce false positives', () => {
    // Token-cost regression guard: deliberately rejected terms must stay out.
    // 'breach', 'verdict', 'jail', 'illegal', 'fined', 'theft', 'murder',
    // bare 'arrest'/'convict'/'prosecute', and 'litigate' are too generic
    // and would dominate results with non-AML noise.
    const q = buildAdverseMediaQuery('x');
    expect(q).not.toMatch(/\bbreach\b/);
    expect(q).not.toMatch(/\bverdict\b/);
    expect(q).not.toMatch(/\bjail\b/);
    expect(q).not.toMatch(/\billegal\b/);
    expect(q).not.toMatch(/\bmurder\b/);
    expect(q).not.toMatch(/\blitigate\b/);
  });

  it('URL-encoded length stays under Google CSE 2048-char limit for typical names', () => {
    // Length-budget regression guard: if a future commit pushes the lexicon
    // over Google CSE's URL limit, this test fails BEFORE production breaks.
    const typicalNames = ['John Doe', 'Mohammed Al Rashid', 'Acme Trading LLC'];
    for (const name of typicalNames) {
      const q = buildAdverseMediaQuery(name);
      const encoded = encodeURIComponent(q);
      expect(
        encoded.length,
        `Query for "${name}" is ${encoded.length} URL-encoded chars (limit: 2048)`
      ).toBeLessThan(2048);
    }
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
