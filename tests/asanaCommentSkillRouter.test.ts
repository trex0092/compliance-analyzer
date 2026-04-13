/**
 * Tests for the Asana comment slash-command skill router.
 */
import { describe, it, expect } from 'vitest';
import {
  routeAsanaComment,
  tokenize,
  buildStubExecution,
  SKILL_CATALOGUE,
} from '@/services/asanaCommentSkillRouter';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('keeps double-quoted strings together', () => {
    expect(tokenize('/screen "ACME LLC"')).toEqual(['/screen', 'ACME LLC']);
  });

  it('handles multiple quoted segments', () => {
    expect(tokenize('"a b" "c d"')).toEqual(['a b', 'c d']);
  });

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('routeAsanaComment', () => {
  it('returns notSlash for non-slash comments', () => {
    const r = routeAsanaComment('Just a regular comment');
    expect(r.notSlash).toBe(true);
  });

  it('returns notSlash for empty input', () => {
    expect(routeAsanaComment('').notSlash).toBe(true);
    expect(routeAsanaComment(null).notSlash).toBe(true);
  });

  it('parses a known skill with args', () => {
    const r = routeAsanaComment('/screen ACME');
    expect(r.ok).toBe(true);
    expect(r.invocation?.skill.name).toBe('screen');
    expect(r.invocation?.args).toEqual(['ACME']);
  });

  it('errors on unknown skill', () => {
    const r = routeAsanaComment('/unknown foo');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Unknown skill');
  });

  it('errors on missing required args', () => {
    const r = routeAsanaComment('/screen');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('at least 1');
  });

  it('accepts skills with minArgs=0 and no args', () => {
    const r = routeAsanaComment('/audit');
    expect(r.ok).toBe(true);
    expect(r.invocation?.args).toEqual([]);
  });

  it('preserves quoted arguments intact', () => {
    const r = routeAsanaComment('/screen "ACME Corp LLC"');
    expect(r.ok).toBe(true);
    expect(r.invocation?.args).toEqual(['ACME Corp LLC']);
  });

  it('is case-insensitive on the skill name', () => {
    const r = routeAsanaComment('/SCREEN ACME');
    expect(r.ok).toBe(true);
    expect(r.invocation?.skill.name).toBe('screen');
  });
});

describe('buildStubExecution', () => {
  it('returns a reply that echoes the skill name', () => {
    const routed = routeAsanaComment('/screen ACME');
    if (!routed.ok || !routed.invocation) throw new Error('unexpected');
    const result = buildStubExecution(routed.invocation);
    expect(result.reply).toContain('/screen');
    expect(result.reply).toContain('ACME');
  });

  it('reply always cites FDL Art.29 no tipping off', () => {
    const routed = routeAsanaComment('/audit');
    if (!routed.ok || !routed.invocation) throw new Error('unexpected');
    expect(buildStubExecution(routed.invocation).reply).toContain('Art.29');
  });
});

describe('SKILL_CATALOGUE', () => {
  it('every entry has a unique name', () => {
    const names = new Set<string>();
    for (const s of SKILL_CATALOGUE) {
      expect(names.has(s.name)).toBe(false);
      names.add(s.name);
    }
  });

  it('every entry has a non-empty citation', () => {
    for (const s of SKILL_CATALOGUE) {
      expect(s.citation.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-negative minArgs', () => {
    for (const s of SKILL_CATALOGUE) {
      expect(s.minArgs).toBeGreaterThanOrEqual(0);
    }
  });
});
