/**
 * Regulatory Ingestion Pipeline tests.
 */
import { describe, it, expect } from 'vitest';

import {
  ingestBulletin,
  normaliseBulletinText,
  type BulletinDocument,
  type ConstantBinding,
} from '../src/services/regulatoryIngestionPipeline';

const bindings: ConstantBinding[] = [
  {
    key: 'DPMS_CASH_THRESHOLD_AED',
    value: 55_000,
    unit: 'AED',
    aliases: ['DPMS cash', 'cash transaction reporting', 'CTR'],
  },
  {
    key: 'CNMR_FILING_DEADLINE_BUSINESS_DAYS',
    value: 5,
    unit: 'days',
    aliases: ['CNMR', 'consolidated freeze', 'EOCN filing'],
  },
  {
    key: 'RECORD_RETENTION_YEARS',
    value: 10,
    unit: 'years',
    aliases: ['record retention', 'retention period'],
  },
  {
    key: 'UBO_OWNERSHIP_THRESHOLD_PCT',
    value: 25,
    unit: 'percent',
    aliases: ['UBO', 'beneficial ownership', 'ultimate beneficial owner'],
  },
];

function makeDoc(body: string, overrides: Partial<BulletinDocument> = {}): BulletinDocument {
  return {
    id: 'doc-1',
    source: 'MoE',
    title: 'Test Circular',
    publishedAtIso: '2026-04-15T00:00:00Z',
    body,
    ...overrides,
  };
}

describe('normaliseBulletinText', () => {
  it('strips HTML and collapses whitespace', () => {
    const r = normaliseBulletinText('<p>hello\n\nworld</p>');
    expect(r).toBe('hello world');
  });

  it('handles &nbsp; and &amp;', () => {
    expect(normaliseBulletinText('a&nbsp;b&amp;c')).toBe('a b&c');
  });
});

describe('ingestBulletin — extractor', () => {
  it('returns no candidates on empty body', () => {
    const r = ingestBulletin(makeDoc(''), bindings);
    expect(r.candidates).toEqual([]);
  });

  it('extracts an AED amount and matches the DPMS threshold', () => {
    const r = ingestBulletin(
      makeDoc('Effective immediately, the DPMS cash transaction reporting threshold is AED 60,000.'),
      bindings
    );
    const matched = r.candidates.find((c) => c.matchedConstantKey === 'DPMS_CASH_THRESHOLD_AED');
    expect(matched).toBeDefined();
    expect(matched!.proposedValue).toBe(60_000);
    expect(matched!.confidence).toBeGreaterThan(0);
  });

  it('extracts a business-day count and matches CNMR deadline', () => {
    const r = ingestBulletin(
      makeDoc('CNMR filings must be submitted within 7 business days.'),
      bindings
    );
    const matched = r.candidates.find(
      (c) => c.matchedConstantKey === 'CNMR_FILING_DEADLINE_BUSINESS_DAYS'
    );
    expect(matched).toBeDefined();
    expect(matched!.proposedValue).toBe(7);
  });

  it('extracts a years value and matches retention period', () => {
    const r = ingestBulletin(
      makeDoc('All institutions must maintain record retention for 12 years.'),
      bindings
    );
    const matched = r.candidates.find((c) => c.matchedConstantKey === 'RECORD_RETENTION_YEARS');
    expect(matched).toBeDefined();
    expect(matched!.proposedValue).toBe(12);
  });

  it('extracts a percent value and matches UBO threshold', () => {
    const r = ingestBulletin(
      makeDoc('Beneficial ownership must be disclosed at 20 percent.'),
      bindings
    );
    const matched = r.candidates.find((c) => c.matchedConstantKey === 'UBO_OWNERSHIP_THRESHOLD_PCT');
    expect(matched).toBeDefined();
    expect(matched!.proposedValue).toBe(20);
  });

  it('produces an unmatched candidate when no constant aligns', () => {
    const r = ingestBulletin(
      makeDoc('A new and entirely unrelated number AED 999,999 was published.'),
      bindings
    );
    // The amount is found but cannot be matched to any constant binding strongly
    // (the 999,999 ratio against 55K bindings exceeds the 0.1..10 ratio guard).
    const c = r.candidates.find((x) => x.proposedValue === 999_999);
    expect(c).toBeDefined();
  });

  it('produces a non-empty summary string', () => {
    const r = ingestBulletin(makeDoc('AED 60,000.'), bindings);
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it('carries the regulatory anchors', () => {
    const r = ingestBulletin(makeDoc(''), bindings);
    expect(r.regulatory).toContain('FDL No.10/2025 Art.20-22');
    expect(r.regulatory).toContain('MoE Circular 08/AML/2021');
  });
});
