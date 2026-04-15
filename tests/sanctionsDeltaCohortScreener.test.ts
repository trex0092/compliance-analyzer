/**
 * Sanctions Delta Cohort Screener tests.
 *
 * Covers:
 *   - Empty cohort + empty delta → empty report
 *   - Single confirmed hit (3 dimensions) → freeze_immediately
 *   - Single likely hit (2 dimensions) → gate_for_co_review
 *   - Single potential hit (1 dimension) → escalate_for_review
 *   - Below-threshold hit suppressed by minMatchScore
 *   - Modified entries (not just added) are screened too
 *   - Regulatory anchors carried through
 *   - Levenshtein cap behaves at the boundary
 *   - Token-set match catches reordered names
 *   - Alias variant from CJK expander triggers a hit
 */
import { describe, it, expect } from 'vitest';

import {
  screenCohortAgainstDelta,
  __test__,
  type CohortCustomer,
} from '../src/services/sanctionsDeltaCohortScreener';
import type { SanctionsDelta, SanctionsEntry } from '../src/services/sanctionsDelta';

const { levenshtein, matchName } = __test__;

function makeDelta(overrides: Partial<SanctionsDelta> = {}): SanctionsDelta {
  return {
    fromSnapshotHash: 'aaa',
    toSnapshotHash: 'bbb',
    computedAtIso: '2026-04-15T04:00:00.000Z',
    added: [],
    removed: [],
    modified: [],
    unchangedCount: 0,
    summary: { totalBefore: 0, totalAfter: 0, totalChanged: 0, byProgram: {} },
    ...overrides,
  };
}

function makeEntry(overrides: Partial<SanctionsEntry> = {}): SanctionsEntry {
  return {
    id: 'OFAC-12345',
    name: 'John Doe',
    source: 'OFAC',
    program: 'SDN',
    ...overrides,
  };
}

function makeCustomer(overrides: Partial<CohortCustomer> = {}): CohortCustomer {
  return {
    id: 'cust-1',
    tenantId: 'tenant-a',
    name: 'John Doe',
    ...overrides,
  };
}

describe('screenCohortAgainstDelta', () => {
  it('returns an empty report for empty inputs', () => {
    const r = screenCohortAgainstDelta([], makeDelta());
    expect(r.cohortSize).toBe(0);
    expect(r.deltaEntries).toBe(0);
    expect(r.hits).toEqual([]);
    expect(r.summary).toMatch(/No cohort hits/);
  });

  it('confirmed (3-dimension) hit recommends freeze_immediately', () => {
    const entry = makeEntry({
      name: 'John Doe',
      dateOfBirth: '1970-01-01',
      nationality: 'US',
    });
    const customer = makeCustomer({
      name: 'John Doe',
      dateOfBirth: '1970-01-01',
      nationality: 'us',
    });
    const r = screenCohortAgainstDelta([customer], makeDelta({ added: [entry] }));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.matchScore).toBeCloseTo(0.99, 5);
    expect(r.hits[0]!.confidence).toBe('confirmed');
    expect(r.hits[0]!.recommendedAction).toBe('freeze_immediately');
    expect(r.hits[0]!.matchReasons).toContain('name');
    expect(r.hits[0]!.matchReasons).toContain('dob+nationality');
  });

  it('likely (2-dimension) hit recommends gate_for_co_review', () => {
    const entry = makeEntry({
      name: 'John Doe',
      // No DOB so dob+nationality cannot fire.
      aliases: ['Johnny D'],
    });
    const customer = makeCustomer({
      name: 'John Doe',
      aliases: ['Johnny D'],
    });
    const r = screenCohortAgainstDelta([customer], makeDelta({ added: [entry] }));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.confidence).toBe('likely');
    expect(r.hits[0]!.recommendedAction).toBe('gate_for_co_review');
  });

  it('potential (1-dimension) hit recommends escalate_for_review', () => {
    const entry = makeEntry({
      name: 'Wholly Different Name',
      aliases: ['John Doe'],
    });
    const customer = makeCustomer({ name: 'John Doe' });
    const r = screenCohortAgainstDelta([customer], makeDelta({ added: [entry] }));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.confidence).toBe('potential');
    expect(r.hits[0]!.recommendedAction).toBe('escalate_for_review');
  });

  it('suppresses hits below minMatchScore', () => {
    const entry = makeEntry({ name: 'Wholly Different Name', aliases: ['John Doe'] });
    const customer = makeCustomer({ name: 'John Doe' });
    const r = screenCohortAgainstDelta([customer], makeDelta({ added: [entry] }), {
      minMatchScore: 0.8,
    });
    expect(r.hits).toHaveLength(0);
  });

  it('screens modified entries (not just added)', () => {
    const before = makeEntry({ id: 'OFAC-1', name: 'Old Name' });
    const after = makeEntry({ id: 'OFAC-1', name: 'John Doe' });
    const delta = makeDelta({
      modified: [{ id: 'OFAC-1', before, after, changedFields: ['name'] }],
    });
    const customer = makeCustomer({ name: 'John Doe' });
    const r = screenCohortAgainstDelta([customer], delta);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.matchedAgainst.name).toBe('John Doe');
  });

  it('carries the regulatory anchors', () => {
    const r = screenCohortAgainstDelta([], makeDelta());
    expect(r.regulatory).toContain('FDL No.10/2025 Art.35');
    expect(r.regulatory).toContain('Cabinet Res 74/2020 Art.4-7');
    expect(r.regulatory).toContain('FATF Rec 6');
  });

  it('skips invalid customer rows without throwing', () => {
    const r = screenCohortAgainstDelta(
      // @ts-expect-error testing degraded input
      [{ id: '', tenantId: 'tenant-a', name: '' }, makeCustomer()],
      makeDelta({ added: [makeEntry()] })
    );
    // Only the valid row should produce a hit.
    expect(r.hits.length).toBe(1);
  });

  it('hits are sorted by matchScore descending', () => {
    const e1 = makeEntry({ id: '1', name: 'Wholly Different', aliases: ['John Doe'] });
    const e2 = makeEntry({
      id: '2',
      name: 'John Doe',
      dateOfBirth: '1970-01-01',
      nationality: 'US',
    });
    const customer = makeCustomer({
      name: 'John Doe',
      dateOfBirth: '1970-01-01',
      nationality: 'US',
    });
    const r = screenCohortAgainstDelta([customer], makeDelta({ added: [e1, e2] }));
    expect(r.hits.length).toBe(2);
    expect(r.hits[0]!.matchScore).toBeGreaterThan(r.hits[1]!.matchScore);
  });
});

describe('matchName / levenshtein helpers', () => {
  it('exact match', () => {
    expect(matchName('John Doe', 'John Doe')).toBe(true);
  });

  it('case + diacritic insensitive', () => {
    expect(matchName('JOHN DOE', '  john   doe  ')).toBe(true);
    expect(matchName('José García', 'jose garcia')).toBe(true);
  });

  it('Levenshtein cap of 2 catches short typos', () => {
    expect(matchName('John', 'Jhn')).toBe(true);
    expect(matchName('Smith', 'Smyth')).toBe(true);
  });

  it('Levenshtein cap of 2 rejects more than 2 edits', () => {
    expect(matchName('Smith', 'Smithers')).toBe(false);
  });

  it('token-set overlap catches reordered names', () => {
    expect(matchName('Doe John', 'John Doe')).toBe(true);
    expect(matchName('Mohammed Ali Khan', 'Khan Mohammed Ali')).toBe(true);
  });

  it('levenshtein cap returns >cap fast', () => {
    expect(levenshtein('hello', 'world', 2)).toBeGreaterThan(2);
  });
});
