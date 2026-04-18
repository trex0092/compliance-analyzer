/**
 * Tests for src/services/regulatoryTraceability.ts — citations per
 * match kind with article + summary + retention.
 */
import { describe, it, expect } from 'vitest';
import {
  citationFor,
  citationForUnknown,
  traceabilityBlock,
  CITATIONS,
  type MatchKind,
} from '@/services/regulatoryTraceability';

describe('regulatoryTraceability', () => {
  it('maps every MatchKind to a non-empty citation', () => {
    const kinds: MatchKind[] = [
      'sanctions_un',
      'sanctions_ofac',
      'sanctions_eu',
      'sanctions_uk',
      'sanctions_uae',
      'pep_direct',
      'pep_family',
      'pep_kca',
      'soe_50pct',
      'ubo_25pct',
      'adverse_media',
      'dual_use_goods',
      'crypto_sanctioned_address',
    ];
    for (const k of kinds) {
      const c = citationFor(k);
      expect(c.instrument.length).toBeGreaterThan(0);
      expect(c.article.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
    }
  });

  it('assigns a 10-year retention to every default citation (FDL Art.24)', () => {
    for (const kind of Object.keys(CITATIONS) as MatchKind[]) {
      expect(citationFor(kind).retentionYears).toBeGreaterThanOrEqual(10);
    }
  });

  it('cites Cabinet Res 74/2020 Art.4-7 for UAE sanctions (24h freeze)', () => {
    const c = citationFor('sanctions_uae');
    expect(c.article).toMatch(/Cabinet Res 74\/2020/);
    expect(c.article).toMatch(/4-7/);
  });

  it('cites Cabinet Decision 109/2023 for UBO 25% threshold', () => {
    const c = citationFor('ubo_25pct');
    expect(c.instrument).toMatch(/109\/2023/);
    expect(c.article).toMatch(/109\/2023/);
  });

  it('citationForUnknown returns a fallback pointing to the CO', () => {
    const c = citationForUnknown();
    expect(c.summary.toLowerCase()).toContain('compliance officer');
  });

  it('traceabilityBlock produces a multi-line block including match + retention', () => {
    const block = traceabilityBlock('sanctions_ofac', 'Name 92% Jaro-Winkler');
    expect(block).toContain('OFAC');
    expect(block).toContain('Name 92% Jaro-Winkler');
    expect(block).toContain('Retention:');
    expect(block.split('\n').length).toBeGreaterThanOrEqual(4);
  });
});
