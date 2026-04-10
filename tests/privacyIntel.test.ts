import { describe, it, expect } from 'vitest';
import {
  createBloomFilter,
  bloomAdd,
  bloomHas,
  serialiseBloom,
  deserialiseBloom,
  buildCustomerIntelFilter,
  probeCustomerIntel,
} from '@/services/privacyIntel';

describe('privacyIntel — Bloom filter primitives', () => {
  it('adds and queries members with zero false negatives', () => {
    const f = createBloomFilter({ expectedItems: 100, falsePositiveRate: 0.01, salt: 's' });
    const members = ['alice', 'bob', 'charlie', 'dan', 'eve'];
    for (const m of members) bloomAdd(f, m);
    for (const m of members) expect(bloomHas(f, m)).toBe(true);
  });

  it('non-members are mostly rejected', () => {
    const f = createBloomFilter({
      expectedItems: 1000,
      falsePositiveRate: 0.001,
      salt: 'secret',
    });
    const members = Array.from({ length: 1000 }, (_, i) => `member-${i}`);
    for (const m of members) bloomAdd(f, m);
    let falsePositives = 0;
    for (let i = 0; i < 1000; i++) {
      if (bloomHas(f, `ghost-${i}`)) falsePositives++;
    }
    // Expect ~1 false positive at 0.1% rate, allow generous upper bound.
    expect(falsePositives).toBeLessThan(20);
  });

  it('different salts produce different filters for the same input', () => {
    const a = createBloomFilter({ expectedItems: 10, falsePositiveRate: 0.01, salt: 's1' });
    const b = createBloomFilter({ expectedItems: 10, falsePositiveRate: 0.01, salt: 's2' });
    bloomAdd(a, 'alice');
    bloomAdd(b, 'alice');
    expect(a.bits).not.toEqual(b.bits);
  });

  it('rejects invalid config', () => {
    expect(() =>
      createBloomFilter({ expectedItems: 0, falsePositiveRate: 0.01, salt: 's' }),
    ).toThrow();
    expect(() =>
      createBloomFilter({ expectedItems: 10, falsePositiveRate: 1.5, salt: 's' }),
    ).toThrow();
  });
});

describe('privacyIntel — serialisation round-trip', () => {
  it('round-trips a filter', () => {
    const f = createBloomFilter({ expectedItems: 50, falsePositiveRate: 0.01, salt: 's' });
    ['one', 'two', 'three'].forEach((m) => bloomAdd(f, m));
    const wire = serialiseBloom(f);
    const back = deserialiseBloom(wire);
    expect(bloomHas(back, 'one')).toBe(true);
    expect(bloomHas(back, 'two')).toBe(true);
    expect(bloomHas(back, 'three')).toBe(true);
    expect(back.numBits).toBe(f.numBits);
    expect(back.numHashes).toBe(f.numHashes);
  });
});

describe('privacyIntel — customer intel sharing', () => {
  it('detects overlap without exposing list', () => {
    const firmA = ['Acme Metals LLC', 'Gulf Jewellers FZE', 'Al-Noor Trading'];
    const firmBCandidates = ['ACME METALS', 'Star Refinery', 'gulf jewellers'];

    const filter = buildCustomerIntelFilter(firmA, { salt: 'shared-secret-123' });
    const results = probeCustomerIntel(filter, firmBCandidates);

    const matched = results.filter((r) => r.possibleMatch).map((r) => r.query);
    expect(matched).toContain('ACME METALS');
    expect(matched).toContain('gulf jewellers');
    expect(matched).not.toContain('Star Refinery');
  });

  it('normalises Arabic diacritics before hashing', () => {
    const filter = buildCustomerIntelFilter(['محمد'], { salt: 's' });
    const results = probeCustomerIntel(filter, ['مُحَمَّد']);
    expect(results[0].possibleMatch).toBe(true);
  });
});
