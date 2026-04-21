/**
 * Tests for the advisor hesitation log — the MLRO-facing record of
 * every "uncertain" brain decision (confidence 0.5-0.89 band + the
 * six advisor escalation triggers).
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21, Art.24, Art.29;
 * Cabinet Res 134/2025 Art.19.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeHesitationLog,
  makeInMemoryHesitationStore,
  isHesitationConfidence,
  validateHesitationEntry,
  type HesitationEntry,
  type HesitationStore,
} from '../src/services/advisorHesitationLog';

const SHA256_A = 'a'.repeat(64);
const SHA256_B = 'b'.repeat(64);

function entry(overrides: Partial<HesitationEntry> = {}): HesitationEntry {
  return {
    eventId: 'evt-00000001',
    at: '2026-04-21T10:00:00Z',
    source: 'sanctions_potential_match',
    confidence: 0.72,
    subjectRefHash: SHA256_A,
    evidenceFor: 'Name match on OFAC SDN; DOB within 1 year of subject.',
    evidenceAgainst: 'Nationality mismatch; no middle-name match.',
    actionTaken: 'escalated_to_co',
    reviewState: 'pending',
    regulatoryCitation: 'FDL No.(10)/2025 Art.20-21; Cabinet Res 74/2020 Art.4-7',
    ...overrides,
  };
}

describe('isHesitationConfidence — CLAUDE.md decision tree band [0.5, 0.9)', () => {
  it('rejects confidence below 0.5 (auto-dismiss band)', () => {
    expect(isHesitationConfidence(0.49)).toBe(false);
  });
  it('accepts 0.5 (lower bound inclusive)', () => {
    expect(isHesitationConfidence(0.5)).toBe(true);
  });
  it('accepts 0.72 (mid band)', () => {
    expect(isHesitationConfidence(0.72)).toBe(true);
  });
  it('accepts 0.89 (just below upper)', () => {
    expect(isHesitationConfidence(0.89)).toBe(true);
  });
  it('rejects 0.9 (upper bound exclusive — this is the auto-freeze band)', () => {
    expect(isHesitationConfidence(0.9)).toBe(false);
  });
  it('rejects NaN, Infinity, negative, > 1', () => {
    expect(isHesitationConfidence(NaN)).toBe(false);
    expect(isHesitationConfidence(Infinity)).toBe(false);
    expect(isHesitationConfidence(-0.1)).toBe(false);
    expect(isHesitationConfidence(1.1)).toBe(false);
  });
});

describe('validateHesitationEntry — schema guards', () => {
  it('accepts a valid entry', () => {
    expect(validateHesitationEntry(entry())).toEqual({ ok: true });
  });
  it('rejects a raw-PII subject reference (FDL Art.29 tipping-off guard)', () => {
    const r = validateHesitationEntry(entry({ subjectRefHash: 'Luisa Fernanda' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/sha-?256/i);
  });
  it('rejects a non-hashed (too-short) subjectRefHash', () => {
    const r = validateHesitationEntry(entry({ subjectRefHash: 'abc123' }));
    expect(r.ok).toBe(false);
  });
  it('rejects confidence outside [0, 1]', () => {
    expect(validateHesitationEntry(entry({ confidence: -0.1 })).ok).toBe(false);
    expect(validateHesitationEntry(entry({ confidence: 1.5 })).ok).toBe(false);
    expect(validateHesitationEntry(entry({ confidence: NaN })).ok).toBe(false);
  });
  it('rejects oversized evidence strings', () => {
    expect(
      validateHesitationEntry(entry({ evidenceFor: 'x'.repeat(501) })).ok,
    ).toBe(false);
    expect(
      validateHesitationEntry(entry({ evidenceAgainst: 'x'.repeat(501) })).ok,
    ).toBe(false);
  });
  it('rejects missing regulatory citation', () => {
    expect(
      validateHesitationEntry(entry({ regulatoryCitation: '' })).ok,
    ).toBe(false);
  });
  it('rejects a non-ISO timestamp', () => {
    expect(validateHesitationEntry(entry({ at: 'yesterday' })).ok).toBe(false);
  });
});

describe('makeHesitationLog.record — idempotent writes', () => {
  let store: HesitationStore;
  beforeEach(() => {
    store = makeInMemoryHesitationStore();
  });

  it('writes one entry', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry());
    expect((await store.list()).length).toBe(1);
  });

  it('is idempotent on re-record of the same eventId', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry({ eventId: 'evt-dedup-01' }));
    await log.record(entry({ eventId: 'evt-dedup-01', confidence: 0.88 }));
    const all = await store.list();
    expect(all.length).toBe(1);
    // First-write-wins — the retry with different confidence must
    // not silently overwrite the reviewed record.
    expect(all[0].confidence).toBe(0.72);
  });

  it('rejects invalid entries at the boundary', async () => {
    const log = makeHesitationLog(store);
    await expect(log.record(entry({ subjectRefHash: 'raw-name' }))).rejects.toThrow();
  });
});

describe('makeHesitationLog.listPending + markReviewed', () => {
  let store: HesitationStore;
  beforeEach(() => {
    store = makeInMemoryHesitationStore();
  });

  it('returns only pending entries', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry({ eventId: 'evt-p-01' }));
    await log.record(entry({ eventId: 'evt-p-02', subjectRefHash: SHA256_B }));
    const pending = await log.listPending();
    expect(pending.map((e) => e.eventId).sort()).toEqual(['evt-p-01', 'evt-p-02']);
  });

  it('transitions pending → reviewed on confirmed_hesitation', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry({ eventId: 'evt-r-01' }));
    await log.markReviewed('evt-r-01', {
      reviewedBy: 'luisa.fernanda',
      reviewedAt: '2026-04-21T11:00:00Z',
      verdict: 'confirmed_hesitation',
    });
    const all = await store.list();
    expect(all[0].reviewState).toBe('reviewed');
  });

  it('transitions pending → overridden on false_positive', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry({ eventId: 'evt-fp-01' }));
    await log.markReviewed('evt-fp-01', {
      reviewedBy: 'luisa.fernanda',
      reviewedAt: '2026-04-21T11:00:00Z',
      verdict: 'false_positive',
    });
    const all = await store.list();
    expect(all[0].reviewState).toBe('overridden');
  });

  it('throws on unknown eventId', async () => {
    const log = makeHesitationLog(store);
    await expect(
      log.markReviewed('evt-nonexistent', {
        reviewedBy: 'luisa.fernanda',
        reviewedAt: '2026-04-21T11:00:00Z',
        verdict: 'confirmed_match',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('is idempotent on double-review — never reopens a closed decision', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry({ eventId: 'evt-dbl-01' }));
    await log.markReviewed('evt-dbl-01', {
      reviewedBy: 'luisa.fernanda',
      reviewedAt: '2026-04-21T11:00:00Z',
      verdict: 'confirmed_match',
    });
    // Second call (e.g. webhook retry) must be a no-op, not overwrite.
    await log.markReviewed('evt-dbl-01', {
      reviewedBy: 'attacker',
      reviewedAt: '2026-04-21T12:00:00Z',
      verdict: 'false_positive',
    });
    const all = await store.list();
    expect(all[0].reviewState).toBe('reviewed');
  });

  it('rejects oversized reviewer notes', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry({ eventId: 'evt-notes-01' }));
    await expect(
      log.markReviewed('evt-notes-01', {
        reviewedBy: 'luisa.fernanda',
        reviewedAt: '2026-04-21T11:00:00Z',
        verdict: 'confirmed_hesitation',
        reviewerNotes: 'x'.repeat(1001),
      }),
    ).rejects.toThrow();
  });
});

describe('makeHesitationLog.stats — aggregates for the MLRO daily digest', () => {
  let store: HesitationStore;
  beforeEach(() => {
    store = makeInMemoryHesitationStore();
  });

  it('returns zero baseline when empty', async () => {
    const log = makeHesitationLog(store);
    const s = await log.stats();
    expect(s.total).toBe(0);
    expect(s.pending).toBe(0);
    expect(s.reviewed).toBe(0);
    expect(s.overridden).toBe(0);
    expect(s.oldestPendingHours).toBe(null);
    expect(s.bySource.sanctions_potential_match).toBe(0);
  });

  it('aggregates by reviewState + source bucket', async () => {
    const log = makeHesitationLog(store);
    await log.record(entry({ eventId: 'evt-s-01', source: 'sanctions_potential_match' }));
    await log.record(entry({ eventId: 'evt-s-02', source: 'advisor_trigger_fired', subjectRefHash: SHA256_B }));
    await log.record(entry({ eventId: 'evt-s-03', source: 'threshold_edge_case', subjectRefHash: SHA256_B }));
    await log.markReviewed('evt-s-01', {
      reviewedBy: 'luisa.fernanda',
      reviewedAt: '2026-04-21T11:00:00Z',
      verdict: 'confirmed_hesitation',
    });
    const s = await log.stats();
    expect(s.total).toBe(3);
    expect(s.pending).toBe(2);
    expect(s.reviewed).toBe(1);
    expect(s.overridden).toBe(0);
    expect(s.bySource.sanctions_potential_match).toBe(1);
    expect(s.bySource.advisor_trigger_fired).toBe(1);
    expect(s.bySource.threshold_edge_case).toBe(1);
    expect(s.bySource.pep_by_association).toBe(0);
  });

  it('reports oldestPendingHours based on the oldest pending entry', async () => {
    const log = makeHesitationLog(store);
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const oneHourAgo = new Date(Date.now() - 1 * 3_600_000).toISOString();
    await log.record(entry({ eventId: 'evt-old-01', at: twoDaysAgo }));
    await log.record(entry({ eventId: 'evt-new-01', at: oneHourAgo, subjectRefHash: SHA256_B }));
    const s = await log.stats();
    expect(s.oldestPendingHours).toBeGreaterThan(47);
    expect(s.oldestPendingHours).toBeLessThan(49);
  });
});
