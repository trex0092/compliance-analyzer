/**
 * Tests for screeningWatchlist — the subject-persistence module for the
 * ongoing monitoring system.
 *
 * Exercises: CRUD, cadence (all-daily), hit fingerprinting with URL
 * normalisation, post-screening delta logic, serialisation round-trip,
 * and corrupt-input tolerance.
 */
import { describe, it, expect } from 'vitest';
import {
  createWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getEntry,
  listAllEntries,
  listDueSubjects,
  setResolvedIdentity,
  watchlistSize,
  fingerprintHit,
  updateAfterScreening,
  serialiseWatchlist,
  deserialiseWatchlist,
  type AddToWatchlistInput,
  type ResolvedIdentity,
} from '@/services/screeningWatchlist';
import type { AdverseMediaHit } from '@/services/adverseMediaSearch';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mkHit = (id: string, overrides: Partial<AdverseMediaHit> = {}): AdverseMediaHit => ({
  title: `Hit ${id}`,
  url: `https://news.example.com/article/${id}`,
  snippet: `Snippet ${id}`,
  publishedAt: '2026-04-10',
  source: 'news.example.com',
  ...overrides,
});

const input = (
  id: string,
  name: string,
  extra: Partial<AddToWatchlistInput> = {}
): AddToWatchlistInput => ({
  id,
  subjectName: name,
  ...extra,
});

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

describe('screeningWatchlist — basic CRUD', () => {
  it('creates an empty watchlist', () => {
    const wl = createWatchlist();
    expect(listAllEntries(wl)).toHaveLength(0);
    expect(watchlistSize(wl)).toBe(0);
  });

  it('adds a subject with default risk tier (medium)', () => {
    const wl = createWatchlist();
    const entry = addToWatchlist(wl, input('c1', 'John Doe'));
    expect(entry.id).toBe('c1');
    expect(entry.subjectName).toBe('John Doe');
    expect(entry.riskTier).toBe('medium');
    expect(entry.seenHitFingerprints).toHaveLength(0);
    expect(entry.alertCount).toBe(0);
    expect(entry.addedAtIso).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(entry.lastScreenedAtIso).toBeUndefined();
    expect(watchlistSize(wl)).toBe(1);
  });

  it('accepts an explicit risk tier and metadata', () => {
    const wl = createWatchlist();
    const entry = addToWatchlist(wl, {
      id: 'c1',
      subjectName: 'Acme Trading LLC',
      riskTier: 'high',
      metadata: { customerId: 'CUST-001', jurisdiction: 'AE', onboardingRegion: 'Dubai' },
    });
    expect(entry.riskTier).toBe('high');
    expect(entry.metadata?.customerId).toBe('CUST-001');
    expect(entry.metadata?.jurisdiction).toBe('AE');
  });

  it('trims whitespace from subject name', () => {
    const wl = createWatchlist();
    const entry = addToWatchlist(wl, input('c1', '  John Doe  '));
    expect(entry.subjectName).toBe('John Doe');
  });

  it('throws on duplicate id', () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    expect(() => addToWatchlist(wl, input('c1', 'Jane Doe'))).toThrow(/already exists/);
  });

  it('throws on empty subject name (including whitespace-only)', () => {
    const wl = createWatchlist();
    expect(() => addToWatchlist(wl, input('c1', ''))).toThrow(/cannot be empty/);
    expect(() => addToWatchlist(wl, input('c2', '   '))).toThrow(/cannot be empty/);
  });

  it('throws on empty id', () => {
    const wl = createWatchlist();
    expect(() => addToWatchlist(wl, input('', 'John Doe'))).toThrow(/id cannot be empty/);
  });

  it('removes a subject', () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    expect(removeFromWatchlist(wl, 'c1')).toBe(true);
    expect(getEntry(wl, 'c1')).toBeUndefined();
    expect(watchlistSize(wl)).toBe(0);
  });

  it('remove returns false for unknown id', () => {
    const wl = createWatchlist();
    expect(removeFromWatchlist(wl, 'nonexistent')).toBe(false);
  });

  it('getEntry returns the full entry', () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe', { riskTier: 'high' }));
    const entry = getEntry(wl, 'c1');
    expect(entry).toBeDefined();
    expect(entry?.riskTier).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Cadence (all daily)
// ---------------------------------------------------------------------------

describe('screeningWatchlist — cadence (all daily)', () => {
  it('listDueSubjects returns all entries regardless of tier', () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'A', { riskTier: 'high' }));
    addToWatchlist(wl, input('c2', 'B', { riskTier: 'medium' }));
    addToWatchlist(wl, input('c3', 'C', { riskTier: 'low' }));

    const due = listDueSubjects(wl);
    expect(due).toHaveLength(3);
    expect(due.map((e) => e.id).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('listDueSubjects returns all entries regardless of lastScreenedAt', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'A'));
    addToWatchlist(wl, input('c2', 'B'));
    // Screen c1 so lastScreenedAtIso is set
    await updateAfterScreening(wl, 'c1', []);
    // Both should STILL be due — no tier-based suppression
    const due = listDueSubjects(wl);
    expect(due).toHaveLength(2);
  });

  it('listDueSubjects on empty watchlist returns empty array', () => {
    expect(listDueSubjects(createWatchlist())).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Hit fingerprinting
// ---------------------------------------------------------------------------

describe('screeningWatchlist — fingerprintHit', () => {
  const hit1 = mkHit('a');

  it('fingerprints are 64-char hex SHA-256', async () => {
    const fp = await fingerprintHit(hit1);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same hit produces same fingerprint (deterministic)', async () => {
    expect(await fingerprintHit(hit1)).toBe(await fingerprintHit(hit1));
  });

  it('different title → different fingerprint', async () => {
    const fp1 = await fingerprintHit(hit1);
    const fp2 = await fingerprintHit({ ...hit1, title: 'Something else entirely' });
    expect(fp1).not.toBe(fp2);
  });

  it('different url → different fingerprint', async () => {
    const fp1 = await fingerprintHit(hit1);
    const fp2 = await fingerprintHit({ ...hit1, url: 'https://different.example.com/x' });
    expect(fp1).not.toBe(fp2);
  });

  it('different publishedAt → different fingerprint', async () => {
    const fp1 = await fingerprintHit(hit1);
    const fp2 = await fingerprintHit({ ...hit1, publishedAt: '2020-01-01' });
    expect(fp1).not.toBe(fp2);
  });

  it('URL tracking params are stripped before fingerprinting', async () => {
    const fp1 = await fingerprintHit(hit1);
    const fp2 = await fingerprintHit({
      ...hit1,
      url: 'https://news.example.com/article/a?utm_source=twitter&utm_campaign=news&fbclid=abc123',
    });
    expect(fp1).toBe(fp2);
  });

  it('URL fragment is stripped before fingerprinting', async () => {
    const fp1 = await fingerprintHit(hit1);
    const fp2 = await fingerprintHit({
      ...hit1,
      url: 'https://news.example.com/article/a#section-2',
    });
    expect(fp1).toBe(fp2);
  });

  it('host case is normalised', async () => {
    const fp1 = await fingerprintHit(hit1);
    const fp2 = await fingerprintHit({ ...hit1, url: 'https://NEWS.EXAMPLE.COM/article/a' });
    expect(fp1).toBe(fp2);
  });

  it('gclid and other ad-tracking params are stripped', async () => {
    const fp1 = await fingerprintHit(hit1);
    const fp2 = await fingerprintHit({
      ...hit1,
      url: 'https://news.example.com/article/a?gclid=xyz&ref=twitter',
    });
    expect(fp1).toBe(fp2);
  });

  it('malformed URL does not throw; uses raw string fallback', async () => {
    const fp = await fingerprintHit({ ...hit1, url: 'not a url at all' });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('missing publishedAt still produces a stable fingerprint', async () => {
    const hitNoDate = mkHit('a');
    delete hitNoDate.publishedAt;
    const fp = await fingerprintHit(hitNoDate);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// updateAfterScreening — delta detection
// ---------------------------------------------------------------------------

describe('screeningWatchlist — updateAfterScreening', () => {
  it('returns all hits as new on first screening', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    const hits = [mkHit('a'), mkHit('b'), mkHit('c')];
    const result = await updateAfterScreening(wl, 'c1', hits);
    expect(result.newHits).toHaveLength(3);
    expect(result.entry.alertCount).toBe(3);
    expect(result.entry.seenHitFingerprints).toHaveLength(3);
    expect(result.entry.lastScreenedAtIso).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('returns only delta hits on second screening', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    await updateAfterScreening(wl, 'c1', [mkHit('a'), mkHit('b')]);
    const result = await updateAfterScreening(wl, 'c1', [mkHit('a'), mkHit('b'), mkHit('c')]);
    expect(result.newHits).toHaveLength(1);
    expect(result.newHits[0].url).toContain('article/c');
    expect(result.entry.alertCount).toBe(3); // 2 from first run + 1 from second
    expect(result.entry.seenHitFingerprints).toHaveLength(3);
  });

  it('returns empty newHits when nothing is new', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    const hits = [mkHit('a')];
    await updateAfterScreening(wl, 'c1', hits);
    const result = await updateAfterScreening(wl, 'c1', hits);
    expect(result.newHits).toHaveLength(0);
    expect(result.entry.alertCount).toBe(1);
    expect(result.entry.seenHitFingerprints).toHaveLength(1);
  });

  it('updates lastScreenedAtIso even when no hits found', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    const result = await updateAfterScreening(wl, 'c1', []);
    expect(result.newHits).toHaveLength(0);
    expect(result.entry.lastScreenedAtIso).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(result.entry.alertCount).toBe(0);
  });

  it('alertCount is monotonically increasing across runs', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    await updateAfterScreening(wl, 'c1', [mkHit('a')]);
    await updateAfterScreening(wl, 'c1', [mkHit('b')]);
    await updateAfterScreening(wl, 'c1', [mkHit('c'), mkHit('d')]);
    const entry = getEntry(wl, 'c1');
    expect(entry?.alertCount).toBe(4);
  });

  it('duplicate hits within the same run count once', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    const result = await updateAfterScreening(wl, 'c1', [mkHit('a'), mkHit('a'), mkHit('a')]);
    expect(result.newHits).toHaveLength(1);
    expect(result.entry.alertCount).toBe(1);
  });

  it('throws on unknown id', async () => {
    const wl = createWatchlist();
    await expect(updateAfterScreening(wl, 'unknown', [])).rejects.toThrow(/unknown watchlist id/);
  });

  it('uses explicit now parameter for deterministic timestamps', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    const now = new Date('2026-04-13T06:00:00Z');
    const result = await updateAfterScreening(wl, 'c1', [], now);
    expect(result.entry.lastScreenedAtIso).toBe('2026-04-13T06:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

describe('screeningWatchlist — serialisation', () => {
  it('round-trips through serialise / deserialise', () => {
    const wl = createWatchlist();
    addToWatchlist(wl, {
      id: 'c1',
      subjectName: 'John Doe',
      riskTier: 'high',
      metadata: { customerId: 'CUST-001' },
    });
    addToWatchlist(wl, input('c2', 'Jane Smith'));
    const serialised = serialiseWatchlist(wl);
    expect(serialised.version).toBe(1);
    expect(serialised.entries).toHaveLength(2);

    const restored = deserialiseWatchlist(serialised);
    expect(listAllEntries(restored)).toHaveLength(2);
    expect(getEntry(restored, 'c1')?.riskTier).toBe('high');
    expect(getEntry(restored, 'c1')?.metadata?.customerId).toBe('CUST-001');
    expect(getEntry(restored, 'c2')?.riskTier).toBe('medium');
  });

  it('round-trips seenHitFingerprints + alertCount', async () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'John Doe'));
    await updateAfterScreening(wl, 'c1', [mkHit('a'), mkHit('b')]);
    const serialised = serialiseWatchlist(wl);
    const restored = deserialiseWatchlist(serialised);
    const entry = getEntry(restored, 'c1');
    expect(entry?.alertCount).toBe(2);
    expect(entry?.seenHitFingerprints).toHaveLength(2);
    expect(entry?.lastScreenedAtIso).toBeDefined();
  });

  it('deserialise tolerates null / non-object input', () => {
    expect(listAllEntries(deserialiseWatchlist(null))).toHaveLength(0);
    expect(listAllEntries(deserialiseWatchlist(undefined))).toHaveLength(0);
    expect(listAllEntries(deserialiseWatchlist(42))).toHaveLength(0);
    expect(listAllEntries(deserialiseWatchlist('string'))).toHaveLength(0);
  });

  it('deserialise returns empty on version mismatch', () => {
    expect(listAllEntries(deserialiseWatchlist({ version: 99, entries: [] }))).toHaveLength(0);
    expect(listAllEntries(deserialiseWatchlist({ version: 'v1', entries: [] }))).toHaveLength(0);
  });

  it('deserialise returns empty when entries is not an array', () => {
    expect(listAllEntries(deserialiseWatchlist({ version: 1, entries: 'not-array' }))).toHaveLength(
      0
    );
    expect(listAllEntries(deserialiseWatchlist({ version: 1, entries: {} }))).toHaveLength(0);
  });

  it('deserialise skips malformed entries but keeps valid ones', () => {
    const raw = {
      version: 1,
      entries: [
        { id: 'c1', subjectName: 'John' },
        { subjectName: 'missing id' }, // malformed — no id
        null, // malformed — null
        { id: 'c2' }, // malformed — no subjectName
        { id: 'c3', subjectName: 'Jane' }, // valid
      ],
    };
    const restored = deserialiseWatchlist(raw);
    expect(listAllEntries(restored)).toHaveLength(2);
    expect(getEntry(restored, 'c1')?.subjectName).toBe('John');
    expect(getEntry(restored, 'c3')?.subjectName).toBe('Jane');
  });

  it('deserialise defaults riskTier to medium when missing', () => {
    const raw = {
      version: 1,
      entries: [{ id: 'c1', subjectName: 'John' }],
    };
    const restored = deserialiseWatchlist(raw);
    expect(getEntry(restored, 'c1')?.riskTier).toBe('medium');
  });

  it('deserialise defaults seenHitFingerprints and alertCount sensibly', () => {
    const raw = {
      version: 1,
      entries: [{ id: 'c1', subjectName: 'John' }],
    };
    const restored = deserialiseWatchlist(raw);
    const entry = getEntry(restored, 'c1');
    expect(entry?.seenHitFingerprints).toEqual([]);
    expect(entry?.alertCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Resolved identity — entity disambiguation
// ---------------------------------------------------------------------------

describe('screeningWatchlist — resolved identity', () => {
  const sampleIdentity: ResolvedIdentity = {
    dob: '12/03/1982',
    nationality: 'AE',
    idType: 'emirates_id',
    idNumber: '784-1982-1234567-8',
    aliases: ['Mohamed A.', 'محمد أحمد'],
    resolvedBy: 'Luisa Fernanda',
    resolutionNote: 'Selected from UN SDN list match',
    listEntryRef: { list: 'UN SDN', reference: 'SDGT-12345' },
  };

  it('addToWatchlist accepts an initial resolvedIdentity', () => {
    const wl = createWatchlist();
    const entry = addToWatchlist(wl, {
      id: 'c1',
      subjectName: 'Mohamed Ahmed',
      resolvedIdentity: sampleIdentity,
    });
    expect(entry.resolvedIdentity?.idNumber).toBe('784-1982-1234567-8');
  });

  it('setResolvedIdentity stamps resolvedAtIso when omitted', () => {
    const wl = createWatchlist();
    addToWatchlist(wl, input('c1', 'Mohamed Ahmed'));
    const updated = setResolvedIdentity(wl, 'c1', { ...sampleIdentity, resolvedAtIso: undefined });
    expect(updated?.resolvedIdentity?.resolvedAtIso).toBeDefined();
  });

  it('setResolvedIdentity returns undefined for unknown id', () => {
    const wl = createWatchlist();
    expect(setResolvedIdentity(wl, 'nope', sampleIdentity)).toBeUndefined();
  });

  it('resolvedIdentity survives serialise → deserialise round-trip', () => {
    const wl = createWatchlist();
    addToWatchlist(wl, {
      id: 'c1',
      subjectName: 'Mohamed Ahmed',
      resolvedIdentity: sampleIdentity,
    });
    const restored = deserialiseWatchlist(serialiseWatchlist(wl));
    const got = getEntry(restored, 'c1')?.resolvedIdentity;
    expect(got?.idType).toBe('emirates_id');
    expect(got?.aliases).toEqual(['Mohamed A.', 'محمد أحمد']);
    expect(got?.listEntryRef?.list).toBe('UN SDN');
  });

  it('deserialise drops malformed fields inside resolvedIdentity', () => {
    const raw = {
      version: 1,
      entries: [
        {
          id: 'c1',
          subjectName: 'Mohamed Ahmed',
          resolvedIdentity: {
            dob: '12/03/1982',
            idType: 'invented_type', // invalid enum → dropped
            aliases: ['ok', 42, 'also ok'], // 42 filtered out
            gender: 'Z', // invalid → dropped
            listEntryRef: { list: 'UN SDN' }, // missing reference → dropped
          },
        },
      ],
    };
    const restored = deserialiseWatchlist(raw);
    const got = getEntry(restored, 'c1')?.resolvedIdentity;
    expect(got?.dob).toBe('12/03/1982');
    expect(got?.idType).toBeUndefined();
    expect(got?.aliases).toEqual(['ok', 'also ok']);
    expect(got?.gender).toBeUndefined();
    expect(got?.listEntryRef).toBeUndefined();
  });

  it('deserialise leaves resolvedIdentity undefined when payload is missing', () => {
    const raw = {
      version: 1,
      entries: [{ id: 'c1', subjectName: 'Mohamed Ahmed' }],
    };
    const restored = deserialiseWatchlist(raw);
    expect(getEntry(restored, 'c1')?.resolvedIdentity).toBeUndefined();
  });
});
