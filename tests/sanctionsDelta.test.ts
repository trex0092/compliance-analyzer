import { describe, it, expect } from 'vitest';
import {
  computeDelta,
  applyDelta,
  hashSnapshot,
  type SanctionsEntry,
} from '@/services/sanctionsDelta';

const baseline: SanctionsEntry[] = [
  { id: 'E1', name: 'Alice', program: 'OFAC-SDN', source: 'OFAC' },
  { id: 'E2', name: 'Bob', aliases: ['Bobby'], program: 'UN-1267', source: 'UN' },
  { id: 'E3', name: 'Carol', program: 'EU', source: 'EU' },
];

const updated: SanctionsEntry[] = [
  { id: 'E1', name: 'Alice', program: 'OFAC-SDN', source: 'OFAC' }, // unchanged
  { id: 'E2', name: 'Robert', aliases: ['Bob', 'Bobby'], program: 'UN-1267', source: 'UN' }, // modified
  // E3 removed
  { id: 'E4', name: 'Dan', program: 'OFAC-SDN', source: 'OFAC' }, // added
];

describe('sanctionsDelta — snapshot hash', () => {
  it('same entries (any order) produce same hash', async () => {
    const a = await hashSnapshot(baseline);
    const b = await hashSnapshot([...baseline].reverse());
    expect(a).toBe(b);
  });

  it('modified entry changes hash', async () => {
    const a = await hashSnapshot(baseline);
    const b = await hashSnapshot(updated);
    expect(a).not.toBe(b);
  });
});

describe('sanctionsDelta — diff', () => {
  it('classifies added/removed/modified correctly', async () => {
    const delta = await computeDelta(baseline, updated);
    expect(delta.added.map((e) => e.id)).toEqual(['E4']);
    expect(delta.removed.map((e) => e.id)).toEqual(['E3']);
    expect(delta.modified.map((m) => m.id)).toEqual(['E2']);
    expect(delta.modified[0].changedFields).toContain('name');
    expect(delta.modified[0].changedFields).toContain('aliases');
    expect(delta.unchangedCount).toBe(1);
  });

  it('summary totals match source counts', async () => {
    const delta = await computeDelta(baseline, updated);
    expect(delta.summary.totalBefore).toBe(3);
    expect(delta.summary.totalAfter).toBe(3);
    expect(delta.summary.totalChanged).toBe(3); // 1 added + 1 removed + 1 modified
  });

  it('byProgram counts additions and removals', async () => {
    const delta = await computeDelta(baseline, updated);
    expect(delta.summary.byProgram['OFAC-SDN'].added).toBe(1);
    expect(delta.summary.byProgram['EU'].removed).toBe(1);
    expect(delta.summary.byProgram['UN-1267'].modified).toBe(1);
  });
});

describe('sanctionsDelta — round trip', () => {
  it('applying delta to baseline yields the updated list', async () => {
    const delta = await computeDelta(baseline, updated);
    const reconstructed = applyDelta(baseline, delta);
    const a = await hashSnapshot(reconstructed);
    const b = await hashSnapshot(updated);
    expect(a).toBe(b);
  });
});
