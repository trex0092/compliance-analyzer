/**
 * Tests for src/services/soeRegistry.ts — state-ownership 50% / 25% rule.
 */
import { describe, it, expect } from 'vitest';
import { matchSoe, type SoeEntry } from '@/services/soeRegistry';

const ENTRIES: SoeEntry[] = [
  {
    id: 'soe-1',
    name: 'Rosoboronexport',
    jurisdiction: 'RU',
    statePct: 100,
    stateRisk: 'sanctioned',
    sector: 'arms',
    source: 'OFAC',
  },
  {
    id: 'soe-2',
    name: 'Gulf Oil Holdings',
    jurisdiction: 'AE',
    statePct: 30,
    stateRisk: 'low',
    sector: 'energy',
    source: 'OECD',
  },
  {
    id: 'soe-3',
    name: 'Riverside Private Trading',
    jurisdiction: 'AE',
    statePct: 10,
    stateRisk: 'low',
    sector: 'commerce',
    source: 'OECD',
  },
];

describe('soeRegistry.matchSoe', () => {
  it('triggers the OFAC 50% Rule when ownership >= 50% and state is sanctioned', () => {
    const matches = matchSoe({ name: 'Rosoboronexport' }, ENTRIES);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].ruleTriggered).toBe('OFAC/UK OFSI 50% Rule');
    expect(matches[0].weight).toBeGreaterThanOrEqual(0.9);
  });

  it('triggers the Cabinet Decision 109/2023 25% threshold at 25-49% ownership', () => {
    const matches = matchSoe({ name: 'Gulf Oil Holdings' }, ENTRIES);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].ruleTriggered).toBe('Cabinet Decision 109/2023 >25%');
  });

  it('returns null ruleTriggered below 25%', () => {
    const matches = matchSoe({ name: 'Riverside Private Trading' }, ENTRIES);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].ruleTriggered).toBeNull();
  });

  it('returns an empty array when no entry matches the subject name', () => {
    const matches = matchSoe({ name: 'Unknown Entity' }, ENTRIES);
    expect(matches).toEqual([]);
  });

  it('sorts matches by weight descending', () => {
    const biggest: SoeEntry[] = [
      ...ENTRIES,
      {
        id: 'soe-4',
        name: 'Rosoboronexport Trading',
        jurisdiction: 'RU',
        statePct: 51,
        stateRisk: 'high',
        source: 'OFAC',
      },
    ];
    const matches = matchSoe({ name: 'Rosoboronexport' }, biggest);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < matches.length; i += 1) {
      expect(matches[i - 1].weight).toBeGreaterThanOrEqual(matches[i].weight);
    }
  });
});
