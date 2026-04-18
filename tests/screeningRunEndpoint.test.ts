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

const baseInput = () => ({
  subjectName: 'John Doe',
  entityType: 'individual' as const,
  eventType: 'new_customer_onboarding' as const,
});

describe('screening-run — validateInput', () => {
  it('rejects non-object body', () => {
    expect(validateInput(null).ok).toBe(false);
    expect(validateInput('string').ok).toBe(false);
    expect(validateInput(undefined).ok).toBe(false);
  });

  it('rejects missing subjectName', () => {
    const { subjectName: _s, ...rest } = baseInput();
    void _s;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('subjectName');
  });

  it('rejects empty subjectName', () => {
    const r = validateInput({ ...baseInput(), subjectName: '   ' });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized subjectName', () => {
    const r = validateInput({ ...baseInput(), subjectName: 'x'.repeat(250) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('too long');
  });

  it('rejects invalid riskTier', () => {
    const r = validateInput({ ...baseInput(), riskTier: 'legendary' });
    expect(r.ok).toBe(false);
  });

  it('rejects missing entityType', () => {
    const { entityType: _e, ...rest } = baseInput();
    void _e;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('entityType');
  });

  it('rejects invalid entityType', () => {
    const r = validateInput({ ...baseInput(), entityType: 'robot' });
    expect(r.ok).toBe(false);
  });

  it('rejects missing eventType', () => {
    const { eventType: _ev, ...rest } = baseInput();
    void _ev;
    const r = validateInput(rest);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('eventType');
  });

  it('rejects invalid eventType', () => {
    const r = validateInput({ ...baseInput(), eventType: 'because-i-felt-like-it' });
    expect(r.ok).toBe(false);
  });

  it('rejects bad dob format', () => {
    const r = validateInput({ ...baseInput(), dob: '1990/13/45' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('dob');
  });

  it('accepts yyyy-mm-dd dob and converts to dd/mm/yyyy', () => {
    const r = validateInput({ ...baseInput(), dob: '1990-05-12' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.dob).toBe('12/05/1990');
  });

  it('rejects invalid selectedLists entry', () => {
    const r = validateInput({ ...baseInput(), selectedLists: ['OFAC', 'NOT_A_LIST'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('selectedLists');
  });

  it('dedupes selectedLists', () => {
    const r = validateInput({ ...baseInput(), selectedLists: ['OFAC', 'OFAC', 'EU'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.selectedLists).toEqual(['OFAC', 'EU']);
  });

  it('rejects oversized subjectId', () => {
    const r = validateInput({ ...baseInput(), subjectId: 'x'.repeat(200) });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized notes', () => {
    const r = validateInput({ ...baseInput(), notes: 'x'.repeat(3000) });
    expect(r.ok).toBe(false);
  });

  it('accepts minimal valid input with defaults', () => {
    const r = validateInput(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.subjectName).toBe('John Doe');
      expect(r.input.entityType).toBe('individual');
      expect(r.input.eventType).toBe('new_customer_onboarding');
      expect(r.input.enrollInWatchlist).toBe(true);
      expect(r.input.runAdverseMedia).toBe(true);
      expect(r.input.createAsanaTask).toBe(true);
    }
  });

  it('allows explicit opt-outs', () => {
    const r = validateInput({
      ...baseInput(),
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

  // ---- Aliases ----

  it('rejects non-array aliases', () => {
    const r = validateInput({ ...baseInput(), aliases: 'UBL' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('aliases');
  });

  it('rejects aliases > 20 entries', () => {
    const many = Array.from({ length: 21 }, (_, i) => `alias-${i}`);
    const r = validateInput({ ...baseInput(), aliases: many });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('20');
  });

  it('rejects non-string alias entries', () => {
    const r = validateInput({ ...baseInput(), aliases: ['ok', 123] });
    expect(r.ok).toBe(false);
  });

  it('dedupes + trims + lowercases alias matches', () => {
    const r = validateInput({
      ...baseInput(),
      aliases: ['  UBL  ', 'ubl', 'Abu Abdullah', ''],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const a = r.input.aliases as string[];
      expect(a.length).toBe(2);
      expect(a).toContain('UBL');
      expect(a).toContain('Abu Abdullah');
    }
  });

  it('accepts no aliases', () => {
    const r = validateInput(baseInput());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.aliases).toBeUndefined();
  });

  it('trims string fields', () => {
    const r = validateInput({
      ...baseInput(),
      subjectName: '  John Doe  ',
      subjectId: '  CUS-1  ',
      jurisdiction: '  AE  ',
      notes: '  ctx  ',
      country: '  UAE  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.subjectName).toBe('John Doe');
      expect(r.input.subjectId).toBe('CUS-1');
      expect(r.input.jurisdiction).toBe('AE');
      expect(r.input.notes).toBe('ctx');
      expect(r.input.country).toBe('UAE');
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
    // 5 supplied + INTERPOL placeholder auto-appended (selectedLists undefined)
    expect(r.perList).toHaveLength(6);
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
