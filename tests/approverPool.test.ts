/**
 * Tests for the four-eyes approver pool picker. Pure function
 * exercised via injected options.
 */
import { describe, it, expect } from 'vitest';
import {
  pickFourEyesPair,
  type ApproverPoolMember,
} from '@/services/approverPool';

function mk(gid: string, load: number, teamId?: string): ApproverPoolMember {
  return { gid, name: `Analyst ${gid}`, openApprovals: load, teamId, available: true };
}

describe('pickFourEyesPair', () => {
  it('returns error when fewer than 2 eligible members', () => {
    const result = pickFourEyesPair([mk('a', 0)]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Cabinet Res 134/2025 Art.19');
  });

  it('picks the two lowest-load approvers by default', () => {
    const result = pickFourEyesPair([mk('a', 3), mk('b', 1), mk('c', 0), mk('d', 5)]);
    expect(result.ok).toBe(true);
    expect(result.pair?.[0].gid).toBe('c');
    expect(result.pair?.[1].gid).toBe('b');
  });

  it('never returns the same gid twice', () => {
    const result = pickFourEyesPair([mk('a', 0), mk('b', 0)]);
    expect(result.ok).toBe(true);
    expect(result.pair?.[0].gid).not.toBe(result.pair?.[1].gid);
  });

  it('respects the exclusion list', () => {
    const result = pickFourEyesPair([mk('a', 0), mk('b', 0), mk('c', 0)], {
      excludeGids: ['a'],
    });
    expect(result.pair?.map((p) => p.gid)).not.toContain('a');
  });

  it('honours the distinct-team rule', () => {
    const result = pickFourEyesPair(
      [mk('a', 0, 'mlro'), mk('b', 0, 'mlro'), mk('c', 2, 'co')],
      { requireDistinctTeams: true }
    );
    expect(result.ok).toBe(true);
    expect(result.pair?.[0].gid).toBe('a');
    expect(result.pair?.[1].gid).toBe('c');
  });

  it('reports fallback pick strategy when the primary has no distinct-team partner at rotation index', () => {
    const result = pickFourEyesPair(
      [mk('a', 0, 'mlro'), mk('b', 0, 'co'), mk('c', 1, 'mlro')],
      { requireDistinctTeams: true, rotationSeed: 1 }
    );
    expect(result.ok).toBe(true);
    expect(result.pair?.[0].gid).toBe('a');
    expect(result.pair?.[1].gid).toBe('b');
  });

  it('rotation seed advances the second pick', () => {
    const base = [mk('a', 0), mk('b', 0), mk('c', 0), mk('d', 0)];
    const a = pickFourEyesPair(base, { rotationSeed: 0 });
    const b = pickFourEyesPair(base, { rotationSeed: 1 });
    expect(a.pair?.[1].gid).not.toBe(b.pair?.[1].gid);
  });

  it('ignores unavailable members', () => {
    const result = pickFourEyesPair([
      { gid: 'a', name: 'a', openApprovals: 0, available: false },
      mk('b', 0),
      mk('c', 0),
    ]);
    expect(result.pair?.map((p) => p.gid)).not.toContain('a');
  });
});
