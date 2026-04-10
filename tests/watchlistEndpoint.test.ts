/**
 * Tests for netlify/functions/watchlist.mts — the pure validation +
 * dispatch layer exposed via __test__. No Netlify runtime, no HTTP,
 * no Blobs — tests exercise the business logic directly so they stay
 * hermetic and fast.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mts file has no type declarations at test time
import { __test__ } from '../netlify/functions/watchlist.mts';
import type { SerialisedWatchlist } from '@/services/screeningWatchlist';

const { validatePostBody, applyAction } = __test__ as {
  validatePostBody: (input: unknown) =>
    | { ok: true; body: unknown }
    | { ok: false; error: string };
  applyAction: (
    current: SerialisedWatchlist,
    action: unknown
  ) =>
    | { ok: true; status: number; updated: SerialisedWatchlist; response: unknown }
    | { ok: false; status: number; error: string };
};

// Helper: an empty starting watchlist
const empty = (): SerialisedWatchlist => ({ version: 1, entries: [] });

// ---------------------------------------------------------------------------
// validatePostBody — add action
// ---------------------------------------------------------------------------

describe('watchlist endpoint — validatePostBody / add', () => {
  it('rejects non-object body', () => {
    expect(validatePostBody(null).ok).toBe(false);
    expect(validatePostBody('string').ok).toBe(false);
    expect(validatePostBody(42).ok).toBe(false);
    expect(validatePostBody(undefined).ok).toBe(false);
  });

  it('rejects unknown action', () => {
    const r = validatePostBody({ action: 'nuke_everything', id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown action');
  });

  it('rejects add with missing id', () => {
    const r = validatePostBody({ action: 'add', subjectName: 'John Doe' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('id must be a non-empty string');
  });

  it('rejects add with empty-string id', () => {
    const r = validatePostBody({ action: 'add', id: '   ', subjectName: 'John Doe' });
    expect(r.ok).toBe(false);
  });

  it('rejects add with oversize id', () => {
    const r = validatePostBody({ action: 'add', id: 'x'.repeat(200), subjectName: 'John Doe' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('too long');
  });

  it('rejects add with missing subjectName', () => {
    const r = validatePostBody({ action: 'add', id: 'c1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('subjectName');
  });

  it('rejects add with oversize subjectName', () => {
    const r = validatePostBody({ action: 'add', id: 'c1', subjectName: 'x'.repeat(250) });
    expect(r.ok).toBe(false);
  });

  it('rejects add with invalid riskTier', () => {
    const r = validatePostBody({
      action: 'add',
      id: 'c1',
      subjectName: 'John Doe',
      riskTier: 'super-risky',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('riskTier');
  });

  it('accepts add with valid riskTier values', () => {
    for (const tier of ['high', 'medium', 'low']) {
      const r = validatePostBody({ action: 'add', id: 'c1', subjectName: 'X', riskTier: tier });
      expect(r.ok).toBe(true);
    }
  });

  it('rejects add with non-object metadata', () => {
    const r = validatePostBody({
      action: 'add',
      id: 'c1',
      subjectName: 'John',
      metadata: 'not-an-object',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects add with array metadata (arrays are technically objects)', () => {
    const r = validatePostBody({
      action: 'add',
      id: 'c1',
      subjectName: 'John',
      metadata: ['not', 'an', 'object'],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts minimal valid add body', () => {
    const r = validatePostBody({ action: 'add', id: 'c1', subjectName: 'John Doe' });
    expect(r.ok).toBe(true);
  });

  it('accepts full valid add body', () => {
    const r = validatePostBody({
      action: 'add',
      id: 'CUST-001',
      subjectName: 'Acme Trading LLC',
      riskTier: 'high',
      metadata: { jurisdiction: 'AE', onboardedBy: 'luisa' },
    });
    expect(r.ok).toBe(true);
  });

  it('trims whitespace from id and subjectName', () => {
    const r = validatePostBody({
      action: 'add',
      id: '  CUST-001  ',
      subjectName: '  Acme  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const body = r.body as { id: string; subjectName: string };
      expect(body.id).toBe('CUST-001');
      expect(body.subjectName).toBe('Acme');
    }
  });
});

// ---------------------------------------------------------------------------
// validatePostBody — remove action
// ---------------------------------------------------------------------------

describe('watchlist endpoint — validatePostBody / remove', () => {
  it('rejects remove with missing id', () => {
    const r = validatePostBody({ action: 'remove' });
    expect(r.ok).toBe(false);
  });

  it('rejects remove with empty id', () => {
    const r = validatePostBody({ action: 'remove', id: '' });
    expect(r.ok).toBe(false);
  });

  it('accepts valid remove', () => {
    const r = validatePostBody({ action: 'remove', id: 'c1' });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePostBody — replace action
// ---------------------------------------------------------------------------

describe('watchlist endpoint — validatePostBody / replace', () => {
  it('rejects replace with missing watchlist', () => {
    const r = validatePostBody({ action: 'replace' });
    expect(r.ok).toBe(false);
  });

  it('rejects replace with wrong version', () => {
    const r = validatePostBody({ action: 'replace', watchlist: { version: 99, entries: [] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('version');
  });

  it('rejects replace with non-array entries', () => {
    const r = validatePostBody({
      action: 'replace',
      watchlist: { version: 1, entries: 'nope' },
    });
    expect(r.ok).toBe(false);
  });

  it('accepts valid replace with empty entries', () => {
    const r = validatePostBody({
      action: 'replace',
      watchlist: { version: 1, entries: [] },
    });
    expect(r.ok).toBe(true);
  });

  it('accepts valid replace with populated entries', () => {
    const r = validatePostBody({
      action: 'replace',
      watchlist: {
        version: 1,
        entries: [
          {
            id: 'c1',
            subjectName: 'John',
            riskTier: 'high',
            addedAtIso: '2026-04-13T06:00:00Z',
            seenHitFingerprints: [],
            alertCount: 0,
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyAction — add
// ---------------------------------------------------------------------------

describe('watchlist endpoint — applyAction / add', () => {
  it('adds a new entry to an empty watchlist', () => {
    const result = applyAction(empty(), {
      action: 'add',
      id: 'c1',
      subjectName: 'John Doe',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.updated.entries).toHaveLength(1);
      expect(result.updated.entries[0].subjectName).toBe('John Doe');
      expect(result.updated.entries[0].riskTier).toBe('medium');
    }
  });

  it('rejects duplicate add with 409', () => {
    const withOne: SerialisedWatchlist = {
      version: 1,
      entries: [
        {
          id: 'c1',
          subjectName: 'John',
          riskTier: 'medium',
          addedAtIso: '2026-04-13T06:00:00Z',
          seenHitFingerprints: [],
          alertCount: 0,
        },
      ],
    };
    const result = applyAction(withOne, {
      action: 'add',
      id: 'c1',
      subjectName: 'John Again',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toContain('already exists');
    }
  });

  it('preserves existing entries when adding a new one', () => {
    const withOne: SerialisedWatchlist = {
      version: 1,
      entries: [
        {
          id: 'c1',
          subjectName: 'John',
          riskTier: 'high',
          addedAtIso: '2026-04-13T06:00:00Z',
          seenHitFingerprints: ['abc'],
          alertCount: 1,
        },
      ],
    };
    const result = applyAction(withOne, {
      action: 'add',
      id: 'c2',
      subjectName: 'Jane',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updated.entries).toHaveLength(2);
      const john = result.updated.entries.find((e) => e.id === 'c1');
      expect(john?.alertCount).toBe(1);
      expect(john?.seenHitFingerprints).toEqual(['abc']);
    }
  });
});

// ---------------------------------------------------------------------------
// applyAction — remove
// ---------------------------------------------------------------------------

describe('watchlist endpoint — applyAction / remove', () => {
  it('removes an existing entry', () => {
    const withOne: SerialisedWatchlist = {
      version: 1,
      entries: [
        {
          id: 'c1',
          subjectName: 'John',
          riskTier: 'medium',
          addedAtIso: '2026-04-13T06:00:00Z',
          seenHitFingerprints: [],
          alertCount: 0,
        },
      ],
    };
    const result = applyAction(withOne, { action: 'remove', id: 'c1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updated.entries).toHaveLength(0);
    }
  });

  it('returns 404 for unknown id', () => {
    const result = applyAction(empty(), { action: 'remove', id: 'nonexistent' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toContain('not found');
    }
  });
});

// ---------------------------------------------------------------------------
// applyAction — replace
// ---------------------------------------------------------------------------

describe('watchlist endpoint — applyAction / replace', () => {
  it('replaces the entire watchlist', () => {
    const oldState: SerialisedWatchlist = {
      version: 1,
      entries: [
        {
          id: 'c1',
          subjectName: 'John',
          riskTier: 'medium',
          addedAtIso: '2026-04-13T06:00:00Z',
          seenHitFingerprints: [],
          alertCount: 0,
        },
      ],
    };
    const newState: SerialisedWatchlist = {
      version: 1,
      entries: [
        {
          id: 'c2',
          subjectName: 'Jane',
          riskTier: 'high',
          addedAtIso: '2026-04-13T07:00:00Z',
          seenHitFingerprints: ['xyz'],
          alertCount: 2,
        },
      ],
    };
    const result = applyAction(oldState, { action: 'replace', watchlist: newState });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updated.entries).toHaveLength(1);
      expect(result.updated.entries[0].id).toBe('c2');
      expect(result.updated.entries[0].alertCount).toBe(2);
    }
  });

  it('replaces with an empty watchlist (effectively clears)', () => {
    const oldState: SerialisedWatchlist = {
      version: 1,
      entries: [
        {
          id: 'c1',
          subjectName: 'John',
          riskTier: 'medium',
          addedAtIso: '2026-04-13T06:00:00Z',
          seenHitFingerprints: [],
          alertCount: 0,
        },
      ],
    };
    const result = applyAction(oldState, { action: 'replace', watchlist: empty() });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updated.entries).toHaveLength(0);
    }
  });
});
