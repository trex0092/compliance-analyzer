/**
 * Four-eyes approval endpoint — pure logic tests.
 *
 * Live blob I/O is not exercised here (Netlify Blobs runtime isn't
 * available in vitest). We test:
 *   - the needsFourEyes gate (which brain events require 2 approvers)
 *   - the makeEventIdFromKey derivation (stable, url-safe, length-bounded)
 *   - the isStoredBrainEvent shape guard (F-07: malformed blobs
 *     must not crash listPending)
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mts import from tests
import { __test__ } from '../netlify/functions/approvals.mts';

const {
  needsFourEyes,
  makeEventIdFromKey,
  isStoredBrainEvent,
  applyDecisionToRecord,
  REQUIRED_APPROVERS,
} = __test__;

interface ApprovalEntry {
  eventId: string;
  approvals: Array<{ actor: string; at: string; note?: string }>;
  rejections: Array<{ actor: string; at: string; note?: string }>;
  status: 'pending' | 'approved' | 'rejected';
}

function blankRec(eventId = 'evt-1'): ApprovalEntry {
  return { eventId, approvals: [], rejections: [], status: 'pending' };
}

const base = {
  at: '2026-04-10T08:00:00Z',
  event: { kind: 'manual', severity: 'low', summary: 'x' },
  decision: { tool: null, purpose: 'p', autoActions: [], escalate: false },
};

// ---------------------------------------------------------------------------
// needsFourEyes
// ---------------------------------------------------------------------------
describe('approvals: needsFourEyes gate', () => {
  it('low severity manual event → no four-eyes needed', () => {
    expect(needsFourEyes(base)).toBe(false);
  });

  it('high severity → four-eyes required', () => {
    expect(needsFourEyes({ ...base, event: { ...base.event, severity: 'high' } })).toBe(true);
  });

  it('critical severity → four-eyes required', () => {
    expect(needsFourEyes({ ...base, event: { ...base.event, severity: 'critical' } })).toBe(true);
  });

  it('escalate=true flips the gate even on low severity', () => {
    expect(needsFourEyes({ ...base, decision: { ...base.decision, escalate: true } })).toBe(true);
  });

  it('sanctions_match with matchScore >= 0.5 → four-eyes required', () => {
    expect(
      needsFourEyes({
        ...base,
        event: { ...base.event, kind: 'sanctions_match', matchScore: 0.6 },
      }),
    ).toBe(true);
  });

  it('sanctions_match with matchScore < 0.5 → NOT required', () => {
    expect(
      needsFourEyes({
        ...base,
        event: { ...base.event, kind: 'sanctions_match', matchScore: 0.2 },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeEventIdFromKey
// ---------------------------------------------------------------------------
describe('approvals: makeEventIdFromKey', () => {
  it('is stable for the same blob key', () => {
    const a = makeEventIdFromKey('events/2026-04-10/08-12-34-uuid.json');
    const b = makeEventIdFromKey('events/2026-04-10/08-12-34-uuid.json');
    expect(a).toBe(b);
  });

  it('different blob keys → different ids', () => {
    const a = makeEventIdFromKey('events/2026-04-10/08-12-34-uuid-a.json');
    const b = makeEventIdFromKey('events/2026-04-10/08-12-34-uuid-b.json');
    expect(a).not.toBe(b);
  });

  it('ids are ≤64 chars url-safe base64', () => {
    const id = makeEventIdFromKey('events/2026-04-10/x.json');
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

// ---------------------------------------------------------------------------
// isStoredBrainEvent (F-07)
// ---------------------------------------------------------------------------
describe('approvals: isStoredBrainEvent shape guard', () => {
  it('accepts a well-formed entry', () => {
    expect(isStoredBrainEvent(base)).toBe(true);
  });

  it('rejects null / primitives', () => {
    expect(isStoredBrainEvent(null)).toBe(false);
    expect(isStoredBrainEvent(undefined)).toBe(false);
    expect(isStoredBrainEvent(42)).toBe(false);
    expect(isStoredBrainEvent('string')).toBe(false);
  });

  it('rejects missing decision', () => {
    // @ts-expect-error — deliberate bad shape
    expect(isStoredBrainEvent({ at: 'x', event: { kind: 'x', severity: 'x', summary: 'x' } })).toBe(false);
  });

  it('rejects missing event.severity', () => {
    expect(
      isStoredBrainEvent({
        at: 'x',
        event: { kind: 'x', summary: 'x' },
        decision: { escalate: false, autoActions: [] },
      }),
    ).toBe(false);
  });

  it('rejects missing decision.escalate', () => {
    expect(
      isStoredBrainEvent({
        at: 'x',
        event: { kind: 'x', severity: 'high', summary: 'x' },
        decision: { autoActions: [] },
      }),
    ).toBe(false);
  });

  it('rejects decision.autoActions that is not an array', () => {
    expect(
      isStoredBrainEvent({
        at: 'x',
        event: { kind: 'x', severity: 'high', summary: 'x' },
        decision: { escalate: true, autoActions: 'not-array' },
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// REQUIRED_APPROVERS
// ---------------------------------------------------------------------------
describe('approvals: REQUIRED_APPROVERS constant', () => {
  it('enforces exactly 2 (four-eyes)', () => {
    expect(REQUIRED_APPROVERS).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// applyDecisionToRecord — Tier-1 #7 solo-MLRO cooldown
// ---------------------------------------------------------------------------

const T_FIRST = '2026-04-14T10:00:00.000Z';
const T_FIRST_MS = Date.parse(T_FIRST);
const T_PLUS_1H_MS = T_FIRST_MS + 1 * 3_600_000;
const T_PLUS_24H_MS = T_FIRST_MS + 24 * 3_600_000;

describe('approvals: applyDecisionToRecord — standard distinct-approver path', () => {
  it('records a first approval and stays pending', () => {
    const result = applyDecisionToRecord(blankRec(), 'mlro', 'approve', 'first vote', {
      soloMode: false,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    expect(result.shouldPersist).toBe(true);
    expect(result.rec.approvals).toHaveLength(1);
    expect(result.rec.status).toBe('pending');
  });

  it('flips to approved when two distinct approvers vote', () => {
    const rec = blankRec();
    applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: false,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    const result = applyDecisionToRecord(rec, 'deputy', 'approve', undefined, {
      soloMode: false,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    expect(result.rec.status).toBe('approved');
    expect(result.rec.approvals).toHaveLength(2);
  });

  it('same approver voting twice is a no-op when solo mode OFF', () => {
    const rec = blankRec();
    applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: false,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    const result = applyDecisionToRecord(rec, 'mlro', 'approve', 'sneaking in', {
      soloMode: false,
      soloCooldownHours: 24,
      nowMs: T_PLUS_24H_MS,
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.rec.status).toBe('pending');
    expect(result.rec.approvals).toHaveLength(1);
  });

  it('any rejection is terminal', () => {
    const result = applyDecisionToRecord(blankRec(), 'mlro', 'reject', 'too risky', {
      soloMode: false,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    expect(result.rec.status).toBe('rejected');
    expect(result.rec.rejections).toHaveLength(1);
  });

  it('does not mutate a terminal record', () => {
    const rec = blankRec();
    rec.status = 'approved';
    rec.approvals = [{ actor: 'a', at: T_FIRST }, { actor: 'b', at: T_FIRST }];
    const result = applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: false,
      soloCooldownHours: 24,
      nowMs: T_PLUS_24H_MS,
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.rec.approvals).toHaveLength(2);
  });
});

describe('approvals: applyDecisionToRecord — solo-MLRO mode', () => {
  it('rejects the second vote BEFORE the cooldown elapses', () => {
    const rec = blankRec();
    applyDecisionToRecord(rec, 'mlro', 'approve', 'first vote', {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    const result = applyDecisionToRecord(rec, 'mlro', 'approve', 'second vote (too soon)', {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_PLUS_1H_MS,
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.cooldownPendingUntilIso).toBe('2026-04-15T10:00:00.000Z');
    expect(result.rec.status).toBe('pending');
    expect(result.rec.approvals).toHaveLength(1);
  });

  it('accepts the second vote AFTER the cooldown elapses', () => {
    const rec = blankRec();
    applyDecisionToRecord(rec, 'mlro', 'approve', 'first vote', {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    const result = applyDecisionToRecord(rec, 'mlro', 'approve', 'second vote (next day)', {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_PLUS_24H_MS,
    });
    expect(result.shouldPersist).toBe(true);
    expect(result.cooldownPendingUntilIso).toBeUndefined();
    expect(result.rec.status).toBe('approved');
    expect(result.rec.approvals).toHaveLength(2);
  });

  it('marks the second vote with a [solo-mlro] audit-trail tag', () => {
    const rec = blankRec();
    applyDecisionToRecord(rec, 'mlro', 'approve', 'first vote', {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_FIRST_MS,
    });
    applyDecisionToRecord(rec, 'mlro', 'approve', 'second vote', {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_PLUS_24H_MS,
    });
    const second = rec.approvals[1];
    expect(second.note).toContain('[solo-mlro 2nd vote');
    expect(second.note).toContain('24h cooldown');
    expect(second.note).toContain('second vote');
  });

  it('honours custom cooldown hours', () => {
    const rec = blankRec();
    applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: true,
      soloCooldownHours: 6,
      nowMs: T_FIRST_MS,
    });
    // 5 hours later → still blocked
    const tooSoon = applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: true,
      soloCooldownHours: 6,
      nowMs: T_FIRST_MS + 5 * 3_600_000,
    });
    expect(tooSoon.cooldownPendingUntilIso).toBe('2026-04-14T16:00:00.000Z');
    // 7 hours later → accepted
    const accepted = applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: true,
      soloCooldownHours: 6,
      nowMs: T_FIRST_MS + 7 * 3_600_000,
    });
    expect(accepted.shouldPersist).toBe(true);
    expect(accepted.rec.status).toBe('approved');
  });

  it('refuses the second vote when the prior timestamp is corrupted', () => {
    const rec = blankRec();
    rec.approvals.push({ actor: 'mlro', at: 'not-a-date' });
    const result = applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_PLUS_24H_MS,
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.cooldownPendingUntilIso).toBeUndefined();
    expect(result.rec.approvals).toHaveLength(1);
  });

  it('does not allow the second vote to flip an already-approved record', () => {
    const rec = blankRec();
    rec.status = 'approved';
    rec.approvals.push({ actor: 'mlro', at: T_FIRST });
    rec.approvals.push({ actor: 'mlro', at: T_FIRST });
    const result = applyDecisionToRecord(rec, 'mlro', 'approve', undefined, {
      soloMode: true,
      soloCooldownHours: 24,
      nowMs: T_PLUS_24H_MS,
    });
    expect(result.shouldPersist).toBe(false);
    expect(result.rec.approvals).toHaveLength(2);
  });
});
