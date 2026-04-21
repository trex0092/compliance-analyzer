/**
 * Tests for netlify/functions/ongoing-screening-optin.mts — exercises the
 * pure validateBody + applyOptIn + canonicaliseKey helpers via __test__.
 * No Netlify runtime, no HTTP, no Blobs. The CAS + auth wiring is smoke-
 * tested in deployment.
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO situational awareness
 * across devices), Art.24 (CAS-envelope audit trail), Art.29 (no tipping
 * off — store holds only name + entity type + timestamp), FATF Rec 10
 * (ongoing CDD — opt-in is the MLRO's active commitment to re-screen).
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mts file has no type declarations at test time
import { __test__ } from '../netlify/functions/ongoing-screening-optin.mts';

const { canonicaliseKey, validateBody, applyOptIn } = __test__ as {
  canonicaliseKey: (subjectId: string | undefined, subjectName: string) => string;
  validateBody: (raw: unknown) =>
    | { ok: true; value: { key: string; subjectName: string; entityType: string; ongoingScreening: boolean } }
    | { ok: false; error: string };
  applyOptIn: (
    prior:
      | { version: 1; updatedAt: string; subjects: Record<string, { subjectName: string; entityType: string; lastSeenAt: string }> }
      | null,
    body: { key: string; subjectName: string; entityType: string; ongoingScreening: boolean },
    now?: Date,
  ) => {
    version: 1;
    updatedAt: string;
    subjects: Record<string, { subjectName: string; entityType: string; lastSeenAt: string }>;
  };
};

describe('ongoing-screening-optin — canonicaliseKey', () => {
  it('prefers subjectId when present', () => {
    expect(canonicaliseKey('SUBJ-001', 'Jane Doe')).toBe('id:subj-001');
  });

  it('falls back to normalised name when subjectId is empty', () => {
    expect(canonicaliseKey(undefined, '  Jane   A.  Doe  ')).toBe('name:jane a. doe');
  });

  it('de-dupes case and whitespace variants to the same key', () => {
    expect(canonicaliseKey(undefined, 'JANE DOE')).toBe(canonicaliseKey(undefined, 'jane doe'));
  });
});

describe('ongoing-screening-optin — validateBody', () => {
  const base = () => ({
    subjectName: 'Jane Doe',
    entityType: 'individual',
    ongoingScreening: true,
  });

  it('accepts a canonical body', () => {
    const r = validateBody(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.subjectName).toBe('Jane Doe');
      expect(r.value.entityType).toBe('individual');
      expect(r.value.ongoingScreening).toBe(true);
    }
  });

  it('normalises legacy entity types via the shared alias map', () => {
    const r1 = validateBody({ ...base(), entityType: 'Company' });
    const r2 = validateBody({ ...base(), entityType: 'legal_entity' });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok) expect(r1.value.entityType).toBe('organisation');
    if (r2.ok) expect(r2.value.entityType).toBe('organisation');
  });

  it('rejects missing / empty subjectName', () => {
    const r = validateBody({ ...base(), subjectName: '  ' });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized subjectName', () => {
    const r = validateBody({ ...base(), subjectName: 'x'.repeat(201) });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown entityType (no silent coercion)', () => {
    const r = validateBody({ ...base(), entityType: 'robot' });
    expect(r.ok).toBe(false);
  });

  it('rejects non-boolean ongoingScreening', () => {
    const r = validateBody({ ...base(), ongoingScreening: 'yes' });
    expect(r.ok).toBe(false);
  });

  it('rejects oversized subjectId', () => {
    const r = validateBody({ ...base(), subjectId: 'x'.repeat(129) });
    expect(r.ok).toBe(false);
  });

  it('rejects non-object bodies', () => {
    expect(validateBody(null).ok).toBe(false);
    expect(validateBody('string').ok).toBe(false);
    expect(validateBody(undefined).ok).toBe(false);
  });
});

describe('ongoing-screening-optin — applyOptIn', () => {
  const now = new Date('2026-04-21T08:30:00.000Z');
  const body = (overrides: Record<string, unknown> = {}) => ({
    key: 'name:jane doe',
    subjectName: 'Jane Doe',
    entityType: 'individual' as const,
    ongoingScreening: true,
    ...overrides,
  });

  it('inserts a new opt-in into an empty store', () => {
    const next = applyOptIn(null, body(), now);
    expect(Object.keys(next.subjects).length).toBe(1);
    expect(next.subjects['name:jane doe'].subjectName).toBe('Jane Doe');
    expect(next.subjects['name:jane doe'].lastSeenAt).toBe('2026-04-21T08:30:00.000Z');
  });

  it('updates lastSeenAt on an existing opt-in (idempotent upsert)', () => {
    const prior = applyOptIn(null, body(), new Date('2026-04-20T00:00:00.000Z'));
    const next = applyOptIn(prior, body(), now);
    expect(Object.keys(next.subjects).length).toBe(1);
    expect(next.subjects['name:jane doe'].lastSeenAt).toBe('2026-04-21T08:30:00.000Z');
  });

  it('removes the entry when ongoingScreening is false', () => {
    const prior = applyOptIn(null, body(), now);
    const next = applyOptIn(prior, body({ ongoingScreening: false }), now);
    expect(Object.keys(next.subjects).length).toBe(0);
    expect(next.subjects['name:jane doe']).toBeUndefined();
  });

  it('tolerates opt-out on an empty store (idempotent)', () => {
    const next = applyOptIn(null, body({ ongoingScreening: false }), now);
    expect(Object.keys(next.subjects).length).toBe(0);
  });

  it('keeps independent entries for different keys', () => {
    const prior = applyOptIn(null, body({ key: 'name:alice', subjectName: 'Alice' }), now);
    const next = applyOptIn(prior, body({ key: 'name:bob', subjectName: 'Bob' }), now);
    expect(Object.keys(next.subjects).length).toBe(2);
  });

  it('returns a new object (no mutation of the prior envelope)', () => {
    const prior = applyOptIn(null, body(), now);
    const before = Object.keys(prior.subjects).length;
    applyOptIn(prior, body({ key: 'name:alice', subjectName: 'Alice' }), now);
    expect(Object.keys(prior.subjects).length).toBe(before);
  });
});
