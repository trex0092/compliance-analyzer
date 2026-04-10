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

const { needsFourEyes, makeEventIdFromKey, isStoredBrainEvent, REQUIRED_APPROVERS } = __test__;

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
