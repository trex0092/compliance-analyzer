/**
 * Multi-Jurisdictional Rule Engine tests.
 */
import { describe, it, expect } from 'vitest';

import {
  evaluateMultiJurisdiction,
  __test__,
} from '../src/services/multiJurisdictionRuleEngine';

const { jurisdictionFor, pickStrictest } = __test__;

describe('jurisdictionFor', () => {
  it('maps AE → UAE', () => expect(jurisdictionFor('AE')).toBe('UAE'));
  it('maps GB → UK', () => expect(jurisdictionFor('GB')).toBe('UK'));
  it('maps UK → UK', () => expect(jurisdictionFor('UK')).toBe('UK'));
  it('maps US → US', () => expect(jurisdictionFor('US')).toBe('US'));
  it('maps DE / FR / IT → EU', () => {
    expect(jurisdictionFor('DE')).toBe('EU');
    expect(jurisdictionFor('FR')).toBe('EU');
    expect(jurisdictionFor('IT')).toBe('EU');
  });
  it('unknown country → UAE (defensive)', () => {
    expect(jurisdictionFor('ZZ')).toBe('UAE');
  });
});

describe('pickStrictest', () => {
  it('picks the smallest threshold (lower-is-stricter)', () => {
    const rules = [
      {
        jurisdiction: 'UAE' as const,
        value: 55_000,
        citation: '',
        strictnessDirection: 'lower' as const,
      },
      {
        jurisdiction: 'EU' as const,
        value: 39_000,
        citation: '',
        strictnessDirection: 'lower' as const,
      },
    ];
    expect(pickStrictest(rules).value).toBe(39_000);
  });

  it('picks the largest retention (higher-is-stricter)', () => {
    const rules = [
      {
        jurisdiction: 'UAE' as const,
        value: 10,
        citation: '',
        strictnessDirection: 'higher' as const,
      },
      {
        jurisdiction: 'EU' as const,
        value: 5,
        citation: '',
        strictnessDirection: 'higher' as const,
      },
    ];
    expect(pickStrictest(rules).value).toBe(10);
  });
});

describe('evaluateMultiJurisdiction', () => {
  it('always includes UAE even if customer is purely foreign', () => {
    const r = evaluateMultiJurisdiction({ customerJurisdictions: ['DE'] });
    expect(r.applicableJurisdictions).toContain('UAE');
    expect(r.applicableJurisdictions).toContain('EU');
  });

  it('cash threshold → strictest is EU/UK (~AED 39K) for an EU customer', () => {
    const r = evaluateMultiJurisdiction({ customerJurisdictions: ['DE'] });
    const cash = r.results.find((x) => x.dimension === 'cash_transaction_threshold_aed');
    expect(cash).toBeDefined();
    expect(cash!.effective.value).toBeLessThan(55_000);
    expect(['EU', 'UK']).toContain(cash!.effective.jurisdiction);
  });

  it('record retention → strictest is UAE 10y for any EU/UK/US mix', () => {
    const r = evaluateMultiJurisdiction({ customerJurisdictions: ['DE', 'GB', 'US'] });
    const ret = r.results.find((x) => x.dimension === 'record_retention_years');
    expect(ret).toBeDefined();
    expect(ret!.effective.value).toBe(10);
    expect(ret!.effective.jurisdiction).toBe('UAE');
  });

  it('STR deadline → UAE/EU/UK "without delay" (0 days) beats US 30-day SAR', () => {
    const r = evaluateMultiJurisdiction({ customerJurisdictions: ['US'] });
    const str = r.results.find((x) => x.dimension === 'str_filing_deadline_days');
    expect(str).toBeDefined();
    expect(str!.effective.value).toBe(0);
    expect(str!.effective.jurisdiction).toBe('UAE');
  });

  it('UBO threshold is 25% across all four families (no surprise)', () => {
    const r = evaluateMultiJurisdiction({ customerJurisdictions: ['DE', 'GB', 'US'] });
    const ubo = r.results.find((x) => x.dimension === 'ubo_ownership_pct');
    expect(ubo).toBeDefined();
    expect(ubo!.effective.value).toBe(25);
  });

  it('carries the regulatory anchors', () => {
    const r = evaluateMultiJurisdiction({ customerJurisdictions: [] });
    expect(r.regulatory).toContain('FATF Rec 19');
    expect(r.regulatory).toContain('EU 6AMLD');
    expect(r.regulatory).toContain('UK MLR 2017');
    expect(r.regulatory).toContain('US BSA + FinCEN CTA');
  });
});
