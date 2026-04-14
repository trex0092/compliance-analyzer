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

describe('pickFourEyesPair — solo-MLRO mode (Tier-1 #7)', () => {
  it('still rejects 1-member pool when solo mode is OFF', () => {
    const result = pickFourEyesPair([mk('mlro', 0)], { soloMlroMode: false });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Cabinet Res 134/2025 Art.19');
    expect(result.error).toContain('HAWKEYE_SOLO_MLRO_MODE');
  });

  it('accepts a 1-member pool when solo mode is ON', () => {
    const result = pickFourEyesPair([mk('mlro', 0)], { soloMlroMode: true });
    expect(result.ok).toBe(true);
    expect(result.pair?.[0].gid).toBe('mlro');
    expect(result.pair?.[1].gid).toBe('mlro');
    expect(result.diagnostics.pickStrategy).toBe('solo-mlro');
  });

  it('emits soloMode metadata with cooldownUntilIso when solo path is taken', () => {
    const fixedNowMs = Date.parse('2026-04-14T10:00:00.000Z');
    const result = pickFourEyesPair([mk('mlro', 0)], {
      soloMlroMode: true,
      soloMlroCooldownHours: 24,
      nowMs: fixedNowMs,
    });
    expect(result.ok).toBe(true);
    expect(result.soloMode?.enabled).toBe(true);
    expect(result.soloMode?.cooldownHours).toBe(24);
    // 24h after 10:00 = next day at 10:00.
    expect(result.soloMode?.cooldownUntilIso).toBe('2026-04-15T10:00:00.000Z');
  });

  it('honours custom cooldown values', () => {
    const fixedNowMs = Date.parse('2026-04-14T10:00:00.000Z');
    const result = pickFourEyesPair([mk('mlro', 0)], {
      soloMlroMode: true,
      soloMlroCooldownHours: 6,
      nowMs: fixedNowMs,
    });
    expect(result.soloMode?.cooldownUntilIso).toBe('2026-04-14T16:00:00.000Z');
  });

  it('does NOT engage solo path when pool has 2+ members even with flag set', () => {
    // Solo mode is a 1-member fallback — when a real deputy is
    // available, the standard distinct-approver picker still wins.
    const result = pickFourEyesPair([mk('a', 0), mk('b', 0)], { soloMlroMode: true });
    expect(result.ok).toBe(true);
    expect(result.pair?.[0].gid).not.toBe(result.pair?.[1].gid);
    expect(result.diagnostics.pickStrategy).not.toBe('solo-mlro');
    expect(result.soloMode).toBeUndefined();
  });
});

describe('isSoloMlroModeEnabled / getSoloMlroCooldownHours env helpers', () => {
  // Dynamic import inside each test so we get a fresh module read of
  // process.env. The helpers themselves read env at call time so this
  // is just paranoia.
  it('isSoloMlroModeEnabled returns false when env unset', async () => {
    delete process.env.HAWKEYE_SOLO_MLRO_MODE;
    const { isSoloMlroModeEnabled } = await import('@/services/approverPool');
    expect(isSoloMlroModeEnabled()).toBe(false);
  });

  it('isSoloMlroModeEnabled accepts true/1/yes/on case-insensitively', async () => {
    const { isSoloMlroModeEnabled } = await import('@/services/approverPool');
    for (const v of ['true', 'TRUE', '1', 'yes', 'Yes', 'on', 'ON']) {
      process.env.HAWKEYE_SOLO_MLRO_MODE = v;
      expect(isSoloMlroModeEnabled()).toBe(true);
    }
    delete process.env.HAWKEYE_SOLO_MLRO_MODE;
  });

  it('isSoloMlroModeEnabled rejects garbage values', async () => {
    const { isSoloMlroModeEnabled } = await import('@/services/approverPool');
    for (const v of ['false', '0', 'no', 'off', 'maybe', '']) {
      process.env.HAWKEYE_SOLO_MLRO_MODE = v;
      expect(isSoloMlroModeEnabled()).toBe(false);
    }
    delete process.env.HAWKEYE_SOLO_MLRO_MODE;
  });

  it('getSoloMlroCooldownHours defaults to 24', async () => {
    delete process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS;
    const { getSoloMlroCooldownHours } = await import('@/services/approverPool');
    expect(getSoloMlroCooldownHours()).toBe(24);
  });

  it('getSoloMlroCooldownHours clamps to [1, 168]', async () => {
    const { getSoloMlroCooldownHours } = await import('@/services/approverPool');
    process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS = '0.5';
    expect(getSoloMlroCooldownHours()).toBe(1);
    process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS = '500';
    expect(getSoloMlroCooldownHours()).toBe(168);
    process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS = '12';
    expect(getSoloMlroCooldownHours()).toBe(12);
    delete process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS;
  });

  it('getSoloMlroCooldownHours falls back on garbage values', async () => {
    const { getSoloMlroCooldownHours } = await import('@/services/approverPool');
    process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS = 'banana';
    expect(getSoloMlroCooldownHours()).toBe(24);
    process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS = '-5';
    expect(getSoloMlroCooldownHours()).toBe(24);
    delete process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS;
  });
});
