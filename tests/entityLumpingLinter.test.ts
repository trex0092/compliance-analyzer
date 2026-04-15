/**
 * Tests for src/services/asana/entityLumpingLinter.ts — the hard
 * compliance rule that prevents multiple legal entities from being
 * lumped into a single Asana task.
 */
import { describe, expect, it } from 'vitest';
import {
  ENTITY_ALIASES,
  EntityLumpingError,
  assertTaskTitleNotLumped,
  lintTaskTitle,
  scanForLumpedTasks,
} from '../src/services/asana/entityLumpingLinter';

describe('ENTITY_ALIASES registry', () => {
  it('covers all 6 entities in COMPANY_REGISTRY', () => {
    expect(ENTITY_ALIASES).toHaveLength(6);
  });

  it('every entity has a unique entityId', () => {
    const ids = ENTITY_ALIASES.map((e) => e.entityId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entity has a display name and at least one alias', () => {
    for (const e of ENTITY_ALIASES) {
      expect(e.displayName.length).toBeGreaterThan(0);
      expect(e.aliases.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('every alias is at least 4 characters (short aliases produce false positives)', () => {
    for (const e of ENTITY_ALIASES) {
      for (const alias of e.aliases) {
        expect(alias.length).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('no entity shares an alias with another entity (would break disambiguation)', () => {
    const seen = new Map<string, string>();
    for (const e of ENTITY_ALIASES) {
      for (const alias of e.aliases) {
        const existing = seen.get(alias.toUpperCase());
        expect(
          existing,
          `alias "${alias}" collides between ${existing} and ${e.entityId}`
        ).toBeUndefined();
        seen.set(alias.toUpperCase(), e.entityId);
      }
    }
  });
});

describe('lintTaskTitle — clean titles (single entity)', () => {
  it.each([
    'FG LLC — CDD Outstanding Files Review',
    'FG BRANCH — CDD Outstanding Files Review',
    'MADISON LLC — CDD Outstanding Files Review',
    'NAPLES LLC — CDD Outstanding Files Review',
    'GRAMALTIN AS — CDD Outstanding Files Review',
    'ZOE FZE — CDD Outstanding Files Review',
  ])('accepts %s', (title) => {
    const result = lintTaskTitle(title);
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  it('accepts a title with only subject content, no entity', () => {
    const result = lintTaskTitle('Periodic Review — April 2026');
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  it('accepts the alternate "JEWELLERY" alias for Madison', () => {
    const result = lintTaskTitle('MADISON JEWELLERY — Q2 Review');
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.displayName).toBe('MADISON LLC');
  });

  it('accepts the alternate "L.L.C" alias variant', () => {
    const result = lintTaskTitle('NAPLES L.L.C CDD Pending');
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(1);
  });
});

describe('lintTaskTitle — lumped titles (2+ entities)', () => {
  it('flags the exact real-world failure from the operator screenshot', () => {
    const result = lintTaskTitle(
      'GRAMALTIN AS / NAPLES LLC / ZOE FZE — CDD Outstanding Files Review'
    );
    expect(result.isLumped).toBe(true);
    expect(result.matches).toHaveLength(3);
    expect(result.matches.map((m) => m.displayName)).toEqual([
      'GRAMALTIN AS',
      'NAPLES LLC',
      'ZOE FZE',
    ]);
    expect(result.error).toMatch(/3 entities/);
    expect(result.error).toMatch(/GRAMALTIN AS, NAPLES LLC, ZOE FZE/);
  });

  it('flags a 2-entity lump', () => {
    const result = lintTaskTitle('FG LLC / FG BRANCH — Group Review');
    expect(result.isLumped).toBe(true);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]!.displayName).toBe('FG LLC');
    expect(result.matches[1]!.displayName).toBe('FG BRANCH');
  });

  it('flags a 6-entity mega-lump', () => {
    const result = lintTaskTitle(
      'MADISON LLC, NAPLES LLC, GRAMALTIN AS, ZOE FZE, FG LLC, FG BRANCH — Q2 group review'
    );
    expect(result.isLumped).toBe(true);
    expect(result.matches).toHaveLength(6);
  });

  it('orders matches by first-occurrence position', () => {
    const result = lintTaskTitle('ZOE FZE / NAPLES LLC — review');
    expect(result.matches[0]!.displayName).toBe('ZOE FZE');
    expect(result.matches[1]!.displayName).toBe('NAPLES LLC');
  });

  it('counts an entity only once even if multiple aliases match', () => {
    // MADISON matches both "MADISON LLC" and "MADISON" aliases —
    // should count as ONE entity, not two.
    const result = lintTaskTitle('MADISON LLC — MADISON JEWELLERY quarterly review');
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.displayName).toBe('MADISON LLC');
  });

  it('includes the regulatory anchor in the error message', () => {
    const result = lintTaskTitle('GRAMALTIN AS / NAPLES LLC — review');
    expect(result.error).toMatch(/FDL Art.12-14/);
    expect(result.error).toMatch(/Cabinet Res 134\/2025/);
  });
});

describe('lintTaskTitle — edge cases', () => {
  it('is case-insensitive', () => {
    const result = lintTaskTitle('gramaltin as / naples llc — review');
    expect(result.isLumped).toBe(true);
    expect(result.matches).toHaveLength(2);
  });

  it('returns clean result for undefined', () => {
    const result = lintTaskTitle(undefined);
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('returns clean result for null', () => {
    const result = lintTaskTitle(null);
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it('returns clean result for empty string', () => {
    const result = lintTaskTitle('');
    expect(result.isLumped).toBe(false);
  });

  it('returns clean result for whitespace-only', () => {
    const result = lintTaskTitle('   \t\n  ');
    expect(result.isLumped).toBe(false);
  });

  it('does NOT false-positive on the word "as" appearing naturally (GRAMALTIN alias requires at least "GRAMAL")', () => {
    const result = lintTaskTitle('Review MADISON LLC as soon as possible');
    // "as" does not match GRAMALTIN AS because GRAMALTIN AS is the alias.
    // The linter only matches complete alias substrings.
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.displayName).toBe('MADISON LLC');
  });

  it('does NOT false-positive on bare "FG" (ambiguous between LLC and BRANCH)', () => {
    // Bare "FG" is deliberately NOT in the alias list for either
    // FG LLC or FG BRANCH — ambiguous "FG" mentions must not count
    // as a match for either.
    const result = lintTaskTitle('FG group-wide review — all entities');
    expect(result.isLumped).toBe(false);
    expect(result.matches).toHaveLength(0);
  });
});

describe('scanForLumpedTasks — scanner over existing tasks', () => {
  it('reports zero findings on an all-clean task list', () => {
    const tasks = [
      { gid: 'g1', name: 'FG LLC — CDD Outstanding Files Review' },
      { gid: 'g2', name: 'NAPLES LLC — Periodic Review' },
      { gid: 'g3', name: 'MADISON LLC — UBO Refresh' },
    ];
    const report = scanForLumpedTasks(tasks);
    expect(report.scanned).toBe(3);
    expect(report.cleanCount).toBe(3);
    expect(report.lumpedTasks).toHaveLength(0);
    expect(report.summary).toMatch(/zero lumping findings/);
  });

  it('reports the exact real-world failure state', () => {
    const tasks = [
      { gid: 'g1', name: 'FG LLC — CDD Outstanding Files Review' },
      { gid: 'g2', name: 'FG BRANCH — CDD Outstanding Files Review' },
      { gid: 'g3', name: 'MADISON LLC — CDD Outstanding Files Review' },
      { gid: 'g4', name: 'GRAMALTIN AS / NAPLES LLC / ZOE FZE — CDD Outstanding Files Review' },
    ];
    const report = scanForLumpedTasks(tasks);
    expect(report.scanned).toBe(4);
    expect(report.cleanCount).toBe(3);
    expect(report.lumpedTasks).toHaveLength(1);
    expect(report.lumpedTasks[0]!.gid).toBe('g4');
    expect(report.lumpedTasks[0]!.entityCount).toBe(3);
    expect(report.lumpedTasks[0]!.entities).toEqual(['GRAMALTIN AS', 'NAPLES LLC', 'ZOE FZE']);
    expect(report.summary).toMatch(/1 of 4 tasks lump.*3 separate tasks/);
  });

  it('handles an empty task list', () => {
    const report = scanForLumpedTasks([]);
    expect(report.scanned).toBe(0);
    expect(report.cleanCount).toBe(0);
    expect(report.lumpedTasks).toHaveLength(0);
  });

  it('reports multiple lumped tasks across a mixed list', () => {
    const tasks = [
      { gid: 'g1', name: 'FG LLC / FG BRANCH — Review' },
      { gid: 'g2', name: 'MADISON LLC — clean task' },
      { gid: 'g3', name: 'NAPLES LLC, ZOE FZE — lump 2' },
    ];
    const report = scanForLumpedTasks(tasks);
    expect(report.lumpedTasks).toHaveLength(2);
    expect(report.cleanCount).toBe(1);
  });
});

describe('assertTaskTitleNotLumped + EntityLumpingError — dispatcher tripwire', () => {
  it('does not throw on a clean title', () => {
    expect(() => assertTaskTitleNotLumped('NAPLES LLC — CDD')).not.toThrow();
  });

  it('throws EntityLumpingError on a lumped title', () => {
    expect(() => assertTaskTitleNotLumped('GRAMALTIN AS / NAPLES LLC — review')).toThrow(
      EntityLumpingError
    );
  });

  it('throws with a code, matches array, and regulatory anchor', () => {
    try {
      assertTaskTitleNotLumped('FG LLC / FG BRANCH — review');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EntityLumpingError);
      const e = err as EntityLumpingError;
      expect(e.code).toBe('ENTITY_LUMPING');
      expect(e.matches).toHaveLength(2);
      expect(e.regulatory).toMatch(/FDL/);
    }
  });

  it('does not throw on undefined title (nothing to lint)', () => {
    expect(() => assertTaskTitleNotLumped(undefined)).not.toThrow();
  });
});
