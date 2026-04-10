import { describe, it, expect } from 'vitest';
import { InspectorPortal } from '@/services/inspectorPortal';

const sampleStrs = [
  { id: 'STR-001', subject: 'A', filedAt: '2026-04-01T00:00:00Z' },
  { id: 'STR-002', subject: 'B', filedAt: '2026-04-02T00:00:00Z' },
  { id: 'STR-003', subject: 'C', filedAt: '2026-04-03T00:00:00Z' },
];

describe('inspectorPortal — session management', () => {
  it('issues a session with scopes and expiry', () => {
    const portal = new InspectorPortal();
    const session = portal.issueSession('Jane Doe', 'MoE', ['str', 'ctr'], 60);
    expect(session.inspectorName).toBe('Jane Doe');
    expect(session.scopes).toContain('str');
    expect(session.queryBudget).toBeGreaterThan(0);
  });

  it('verifyInspectorSession rejects unknown session', () => {
    const portal = new InspectorPortal();
    expect(portal.verifyInspectorSession('nope')).toBeNull();
  });

  it('verifyInspectorSession rejects expired session', () => {
    let time = new Date('2026-04-10T12:00:00Z');
    const portal = new InspectorPortal({ now: () => time });
    const session = portal.issueSession('X', 'MoE', ['str'], 10);
    time = new Date('2026-04-10T13:00:00Z');
    expect(portal.verifyInspectorSession(session.sessionId)).toBeNull();
  });

  it('revoke removes session', () => {
    const portal = new InspectorPortal();
    const s = portal.issueSession('X', 'MoE', ['str']);
    expect(portal.revokeSession(s.sessionId)).toBe(true);
    expect(portal.verifyInspectorSession(s.sessionId)).toBeNull();
  });
});

describe('inspectorPortal — scoped queries', () => {
  it('returns watermarked results within scope', () => {
    const portal = new InspectorPortal();
    const session = portal.issueSession('Inspector', 'EOCN', ['str']);
    const result = portal.query({
      sessionId: session.sessionId,
      resourceType: 'str',
      requiredScope: 'str',
      dataset: sampleStrs,
    });
    expect(result.items).toHaveLength(3);
    expect(result.watermark).toContain('INSPECTOR:');
    expect(result.watermark).toContain('EOCN');
  });

  it('blocks query without required scope', () => {
    const portal = new InspectorPortal();
    const session = portal.issueSession('Inspector', 'LBMA', ['dpms']);
    expect(() =>
      portal.query({
        sessionId: session.sessionId,
        resourceType: 'str',
        requiredScope: 'str',
        dataset: sampleStrs,
      }),
    ).toThrow(/not authorised/);
  });

  it('"all" scope grants access to any resource', () => {
    const portal = new InspectorPortal();
    const session = portal.issueSession('Inspector', 'MoE', ['all']);
    const result = portal.query({
      sessionId: session.sessionId,
      resourceType: 'str',
      requiredScope: 'sanctions',
      dataset: sampleStrs,
    });
    expect(result.items).toHaveLength(3);
  });

  it('applies filter when provided', () => {
    const portal = new InspectorPortal();
    const session = portal.issueSession('Inspector', 'MoE', ['str']);
    const result = portal.query({
      sessionId: session.sessionId,
      resourceType: 'str',
      requiredScope: 'str',
      dataset: sampleStrs,
      filter: (r) => r.subject === 'B',
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('STR-002');
  });

  it('truncates large result sets', () => {
    const portal = new InspectorPortal({ maxRowsPerQuery: 2 });
    const session = portal.issueSession('Inspector', 'MoE', ['str']);
    const result = portal.query({
      sessionId: session.sessionId,
      resourceType: 'str',
      requiredScope: 'str',
      dataset: sampleStrs,
    });
    expect(result.items).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('exhausts query budget', () => {
    const portal = new InspectorPortal({ defaultBudget: 2 });
    const session = portal.issueSession('Inspector', 'MoE', ['str']);
    portal.query({
      sessionId: session.sessionId,
      resourceType: 'str',
      requiredScope: 'str',
      dataset: sampleStrs,
    });
    portal.query({
      sessionId: session.sessionId,
      resourceType: 'str',
      requiredScope: 'str',
      dataset: sampleStrs,
    });
    expect(() =>
      portal.query({
        sessionId: session.sessionId,
        resourceType: 'str',
        requiredScope: 'str',
        dataset: sampleStrs,
      }),
    ).toThrow(/budget/);
  });
});

describe('inspectorPortal — audit log', () => {
  it('logs allowed and blocked queries', () => {
    const portal = new InspectorPortal();
    const session = portal.issueSession('Inspector', 'MoE', ['str']);
    portal.query({
      sessionId: session.sessionId,
      resourceType: 'str',
      requiredScope: 'str',
      dataset: sampleStrs,
    });
    try {
      portal.query({
        sessionId: session.sessionId,
        resourceType: 'sanctions',
        requiredScope: 'sanctions',
        dataset: sampleStrs,
      });
    } catch {
      // expected
    }
    const log = portal.getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0].allowed).toBe(true);
    expect(log[1].allowed).toBe(false);
  });
});
