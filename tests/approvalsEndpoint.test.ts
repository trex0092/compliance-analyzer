/**
 * Four-eyes approval endpoint — pure logic tests.
 *
 * The live endpoint depends on Netlify Blobs which we can't import in
 * the unit suite, so we test the pure helpers: the needsFourEyes gate
 * (which codifies which events require two approvers) and the event-id
 * derivation.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mts import from tests
import { __test__ } from '../netlify/functions/approvals.mts';

const { needsFourEyes, makeEventId, REQUIRED_APPROVERS } = __test__;

const base = {
  at: '2026-04-10T08:00:00Z',
  event: { kind: 'manual', severity: 'low', summary: 'x' },
  decision: { tool: null, purpose: 'p', autoActions: [], escalate: false },
};

describe('approvals: needsFourEyes gate', () => {
  it('low severity manual event → no four-eyes needed', () => {
    expect(needsFourEyes(base)).toBe(false);
  });

  it('high severity → four-eyes required', () => {
    expect(
      needsFourEyes({
        ...base,
        event: { ...base.event, severity: 'high' },
      }),
    ).toBe(true);
  });

  it('critical severity → four-eyes required', () => {
    expect(
      needsFourEyes({
        ...base,
        event: { ...base.event, severity: 'critical' },
      }),
    ).toBe(true);
  });

  it('escalate=true flips the gate even on low severity', () => {
    expect(
      needsFourEyes({
        ...base,
        decision: { ...base.decision, escalate: true },
      }),
    ).toBe(true);
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

describe('approvals: makeEventId', () => {
  it('produces a stable id for the same entry and index', () => {
    const id1 = makeEventId(base, 0);
    const id2 = makeEventId(base, 0);
    expect(id1).toBe(id2);
  });

  it('different index → different id', () => {
    expect(makeEventId(base, 0)).not.toBe(makeEventId(base, 1));
  });

  it('ids fit within the 64-char refId cap', () => {
    const id = makeEventId(base, 999);
    expect(id.length).toBeLessThanOrEqual(64);
  });

  it('ids are url-safe base64 (no +, /, =)', () => {
    const id = makeEventId(base, 42);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('approvals: REQUIRED_APPROVERS constant', () => {
  it('enforces exactly 2 (four-eyes)', () => {
    expect(REQUIRED_APPROVERS).toBe(2);
  });
});
