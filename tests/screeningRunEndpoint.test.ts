/**
 * Tests for netlify/functions/screening-run.mts — exercises the pure
 * validation + per-list screening logic via __test__. No Netlify
 * runtime, no HTTP, no Blobs.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mts file has no type declarations at test time
import { __test__ } from '../netlify/functions/screening-run.mts';
import type { SanctionsEntry } from '@/services/sanctionsApi';

const { validateInput, screenAgainstAllLists } = __test__ as {
  validateInput: (
    input: unknown
  ) => { ok: true; input: Record<string, unknown> } | { ok: false; error: string };
  screenAgainstAllLists: (
    subjectName: string,
    snapshot: {
      fetchedAt: number;
      lists: Array<{ name: string; entries: SanctionsEntry[]; error?: string }>;
    }
  ) => {
    perList: Array<{ list: string; hitCount: number; topScore: number }>;
    overallTopScore: number;
    overallTopClassification: string;
  };
};

// ---------------------------------------------------------------------------
// validateInput
// ---------------------------------------------------------------------------

describe('screening-run — validateInput', () => {
  it('rejects non-object body', () => {
    expect(validateInput(null).ok).toBe(false);
    expect(validateInput('string').ok).toBe(false);
    expect(validateInput(undefined).ok).toBe(false);
  });

  it('rejects missing subjectName', () => {
    const r = validateInput({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('subjectName');
  });

  it('rejects empty subjectName', () => {
    const r = validateInput({ subjectName: '   ' });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized subjectName', () => {
    const r = validateInput({ subjectName: 'x'.repeat(250) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('too long');
  });

  it('rejects invalid riskTier', () => {
    const r = validateInput({ subjectName: 'John Doe', riskTier: 'legendary' });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized subjectId', () => {
    const r = validateInput({ subjectName: 'John', subjectId: 'x'.repeat(200) });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized notes', () => {
    const r = validateInput({ subjectName: 'John', notes: 'x'.repeat(3000) });
    expect(r.ok).toBe(false);
  });

  it('accepts minimal valid input with defaults', () => {
    const r = validateInput({ subjectName: 'John Doe' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.subjectName).toBe('John Doe');
      expect(r.input.enrollInWatchlist).toBe(true);
      expect(r.input.runAdverseMedia).toBe(true);
      expect(r.input.createAsanaTask).toBe(true);
    }
  });

  it('allows explicit opt-outs', () => {
    const r = validateInput({
      subjectName: 'John Doe',
      enrollInWatchlist: false,
      runAdverseMedia: false,
      createAsanaTask: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.enrollInWatchlist).toBe(false);
      expect(r.input.runAdverseMedia).toBe(false);
      expect(r.input.createAsanaTask).toBe(false);
    }
  });

  it('trims string fields', () => {
    const r = validateInput({
      subjectName: '  John Doe  ',
      subjectId: '  CUS-1  ',
      jurisdiction: '  AE  ',
      notes: '  ctx  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.subjectName).toBe('John Doe');
      expect(r.input.subjectId).toBe('CUS-1');
      expect(r.input.jurisdiction).toBe('AE');
      expect(r.input.notes).toBe('ctx');
    }
  });
});

// ---------------------------------------------------------------------------
// screenAgainstAllLists — shape of the aggregate output
// ---------------------------------------------------------------------------

function entry(id: string, name: string, aliases: string[] = []): SanctionsEntry {
  return { id, name, aliases, listSource: 'test', type: 'individual' };
}

describe('screening-run — screenAgainstAllLists', () => {
  it('returns overallTopScore 0 and classification none on empty lists', () => {
    const r = screenAgainstAllLists('Nobody', {
      fetchedAt: 0,
      lists: [
        { name: 'UN', entries: [] },
        { name: 'OFAC', entries: [] },
        { name: 'EU', entries: [] },
        { name: 'UK_OFSI', entries: [] },
        { name: 'UAE_EOCN', entries: [] },
      ],
    });
    expect(r.overallTopScore).toBe(0);
    expect(r.overallTopClassification).toBe('none');
    expect(r.perList).toHaveLength(5);
    for (const l of r.perList) expect(l.hitCount).toBe(0);
  });

  it('flags exact matches as confirmed on the correct list', () => {
    const r = screenAgainstAllLists('Osama Bin Laden', {
      fetchedAt: 0,
      lists: [
        { name: 'UN', entries: [entry('UN-1', 'Osama Bin Laden')] },
        { name: 'OFAC', entries: [] },
        { name: 'EU', entries: [] },
        { name: 'UK_OFSI', entries: [] },
        { name: 'UAE_EOCN', entries: [] },
      ],
    });
    expect(r.overallTopClassification).toBe('confirmed');
    expect(r.overallTopScore).toBeGreaterThanOrEqual(0.9);
    const un = r.perList.find((l) => l.list === 'UN');
    expect(un?.hitCount).toBeGreaterThan(0);
  });

  it('propagates list errors into the per-list result', () => {
    const r = screenAgainstAllLists('John Doe', {
      fetchedAt: 0,
      lists: [
        { name: 'UN', entries: [], error: 'network timeout' },
        { name: 'OFAC', entries: [] },
        { name: 'EU', entries: [] },
        { name: 'UK_OFSI', entries: [] },
        { name: 'UAE_EOCN', entries: [] },
      ],
    });
    const un = r.perList.find((l) => l.list === 'UN') as
      | ((typeof r.perList)[number] & { error?: string })
      | undefined;
    expect(un?.error).toBe('network timeout');
  });

  it('searches aliases in addition to primary names', () => {
    const r = screenAgainstAllLists('Usama bin Ladin', {
      fetchedAt: 0,
      lists: [
        {
          name: 'UN',
          entries: [entry('UN-1', 'Osama Bin Laden', ['Usama bin Ladin', 'UBL'])],
        },
        { name: 'OFAC', entries: [] },
        { name: 'EU', entries: [] },
        { name: 'UK_OFSI', entries: [] },
        { name: 'UAE_EOCN', entries: [] },
      ],
    });
    // Exact alias hit → score >= 0.9 → confirmed
    expect(r.overallTopScore).toBeGreaterThanOrEqual(0.9);
    expect(r.overallTopClassification).toBe('confirmed');
  });

  it('returns no hits for unrelated names', () => {
    const r = screenAgainstAllLists('Unrelated Jane', {
      fetchedAt: 0,
      lists: [
        { name: 'UN', entries: [entry('UN-1', 'Osama Bin Laden')] },
        { name: 'OFAC', entries: [entry('OFAC-1', 'Abu Bakr')] },
        { name: 'EU', entries: [] },
        { name: 'UK_OFSI', entries: [] },
        { name: 'UAE_EOCN', entries: [] },
      ],
    });
    expect(r.overallTopClassification).toBe('none');
  });
});
