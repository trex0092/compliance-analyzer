/**
 * Tests for Phase 7 Cluster K — external intelligence connectors.
 * All tests use in-memory fakes; no network calls.
 */
import { describe, it, expect } from 'vitest';
import {
  lookupRealTimeSanctions,
  createInMemorySanctionsFake,
  lookupPep,
  createInMemoryPepFake,
  isCountryListedAt,
  summariseCountryHistory,
  lookupCompany,
  createInMemoryCompaniesFake,
  lookupOffshoreLeaks,
  createInMemoryOffshoreFake,
  lookupAleph,
  createInMemoryAlephFake,
} from '@/services/externalIntelligence';

describe('#81 realTimeSanctionsApi', () => {
  const fake = createInMemorySanctionsFake([
    { name: 'Dirty Actor', listName: 'OFAC', matchScore: 0.95 },
  ]);

  it('returns hits for matching name', async () => {
    const result = await lookupRealTimeSanctions({ name: 'Dirty Actor' }, fake);
    expect(result.hits.length).toBe(1);
    expect(result.hits[0].listName).toBe('OFAC');
  });

  it('returns no hits for unknown name', async () => {
    const result = await lookupRealTimeSanctions({ name: 'Unknown Person' }, fake);
    expect(result.hits.length).toBe(0);
  });
});

describe('#82 pepDatabaseConnector', () => {
  const fake = createInMemoryPepFake([
    { name: 'Senator Smith', pepType: 'foreign', role: 'Senator', country: 'US' },
  ]);

  it('flags a known PEP', async () => {
    const result = await lookupPep({ name: 'Senator Smith' }, fake);
    expect(result.isPep).toBe(true);
    expect(result.pepType).toBe('foreign');
  });

  it('does not flag a non-PEP', async () => {
    const result = await lookupPep({ name: 'Average Citizen' }, fake);
    expect(result.isPep).toBe(false);
  });
});

describe('#83 fatfGreyListTimeSeries', () => {
  const entries = [
    { country: 'PK', list: 'grey' as const, from: '2018-06-01', to: '2022-10-31', reason: 'AML/CFT deficiencies' },
    { country: 'PK', list: 'grey' as const, from: '2024-06-01', reason: 'Re-listing' },
  ];

  it('detects currently listed country', () => {
    const r = isCountryListedAt(entries, 'PK', '2024-12-01T00:00:00Z');
    expect(r).not.toBeNull();
  });

  it('detects previously listed country', () => {
    const r = isCountryListedAt(entries, 'PK', '2020-01-01T00:00:00Z');
    expect(r).not.toBeNull();
    expect(r!.to).toBe('2022-10-31');
  });

  it('unknown country returns null', () => {
    expect(isCountryListedAt(entries, 'ZZ', '2024-01-01T00:00:00Z')).toBeNull();
  });

  it('summarises history', () => {
    const summary = summariseCountryHistory(entries, 'PK');
    expect(summary.totalListed).toBe(2);
    expect(summary.currentlyListed).toBe(true);
  });
});

describe('#84 companiesHouseConnector', () => {
  const fake = createInMemoryCompaniesFake([
    {
      companyNumber: '12345678',
      name: 'Acme Ltd',
      jurisdiction: 'GB',
      status: 'active',
      directors: ['Alice Smith'],
    },
  ]);

  it('returns existing company record', async () => {
    const r = await lookupCompany('12345678', fake);
    expect(r?.name).toBe('Acme Ltd');
  });

  it('returns null for unknown company number', async () => {
    const r = await lookupCompany('99999999', fake);
    expect(r).toBeNull();
  });
});

describe('#85 icijOffshoreLeaksLookup', () => {
  const fake = createInMemoryOffshoreFake([
    { leak: 'panama', entityName: 'Shell Co Holdings', role: 'shareholder', jurisdictions: ['PA'] },
  ]);

  it('finds entity in leaks', async () => {
    const hits = await lookupOffshoreLeaks({ name: 'Shell Co' }, fake);
    expect(hits.length).toBe(1);
    expect(hits[0].leak).toBe('panama');
  });

  it('returns empty for clean entity', async () => {
    const hits = await lookupOffshoreLeaks({ name: 'Clean Ltd' }, fake);
    expect(hits.length).toBe(0);
  });
});

describe('#86 occrpAlephLookup', () => {
  const fake = createInMemoryAlephFake([
    { entityName: 'Corrupt Corp', source: 'OCCRP', tags: ['corruption', 'money_laundering'] },
  ]);

  it('finds tagged entity', async () => {
    const hits = await lookupAleph({ name: 'Corrupt Corp' }, fake);
    expect(hits.length).toBe(1);
    expect(hits[0].tags).toContain('corruption');
  });

  it('returns empty for unknown', async () => {
    const hits = await lookupAleph({ name: 'Unknown Ltd' }, fake);
    expect(hits.length).toBe(0);
  });
});
