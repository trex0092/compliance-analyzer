/**
 * Asana CO Load Balancer tests.
 */
import { describe, it, expect } from 'vitest';

import {
  pickFourEyesAssignee,
  __test__,
  type CoCandidate,
} from '../src/services/asana/coLoadBalancer';

const { loadScore, meetsRole } = __test__;

function makeCandidate(overrides: Partial<CoCandidate>): CoCandidate {
  return {
    gid: 'co-1',
    name: 'CO One',
    role: 'co',
    active: true,
    pendingApprovalCount: 0,
    inFlightCaseCount: 0,
    ...overrides,
  };
}

const pool: CoCandidate[] = [
  makeCandidate({ gid: 'co-a', name: 'A', pendingApprovalCount: 8, inFlightCaseCount: 4 }),
  makeCandidate({ gid: 'co-b', name: 'B', pendingApprovalCount: 2, inFlightCaseCount: 1 }),
  makeCandidate({ gid: 'co-c', name: 'C', pendingApprovalCount: 0, inFlightCaseCount: 0 }),
  makeCandidate({ gid: 'co-d', name: 'D', pendingApprovalCount: 5, inFlightCaseCount: 2 }),
  makeCandidate({ gid: 'co-e', name: 'E', pendingApprovalCount: 0, inFlightCaseCount: 12 }),
];

describe('pickFourEyesAssignee', () => {
  it('picks the lowest-load CO when load data is available', () => {
    const r = pickFourEyesAssignee({
      candidates: pool,
      requiredRole: 'co',
      proposerGid: 'co-other',
      caseId: 'case-1',
    });
    expect(r.strategy).toBe('load-balanced');
    expect(r.assigneeGid).toBe('co-c'); // 0+0=0 lowest
  });

  it('excludes the proposer from the eligible pool', () => {
    const r = pickFourEyesAssignee({
      candidates: pool,
      requiredRole: 'co',
      proposerGid: 'co-c',
      caseId: 'case-1',
    });
    expect(r.assigneeGid).not.toBe('co-c');
    // co-b has next-lowest load (2 + 0.5*1 = 2.5)
    expect(r.assigneeGid).toBe('co-b');
  });

  it('skips inactive candidates', () => {
    const customPool: CoCandidate[] = [
      makeCandidate({ gid: 'co-x', active: false, pendingApprovalCount: 0 }),
      makeCandidate({ gid: 'co-y', active: true, pendingApprovalCount: 5 }),
    ];
    const r = pickFourEyesAssignee({
      candidates: customPool,
      requiredRole: 'co',
      proposerGid: 'other',
      caseId: 'case-1',
    });
    expect(r.assigneeGid).toBe('co-y');
  });

  it('returns no_eligible_candidate when nobody qualifies', () => {
    const r = pickFourEyesAssignee({
      candidates: [makeCandidate({ gid: 'co-only', active: false })],
      requiredRole: 'co',
      proposerGid: 'other',
      caseId: 'case-1',
    });
    expect(r.strategy).toBe('no-eligible-candidate');
    expect(r.assigneeGid).toBeNull();
  });

  it('falls back to round-robin when all eligibles have zero load', () => {
    const idle: CoCandidate[] = [
      makeCandidate({ gid: 'co-a' }),
      makeCandidate({ gid: 'co-b' }),
      makeCandidate({ gid: 'co-c' }),
    ];
    const r = pickFourEyesAssignee({
      candidates: idle,
      requiredRole: 'co',
      proposerGid: 'other',
      caseId: 'case-stable',
    });
    expect(r.strategy).toBe('round-robin-fallback');
    expect(r.assigneeGid).not.toBeNull();
  });

  it('round-robin is stable per caseId', () => {
    const idle: CoCandidate[] = [
      makeCandidate({ gid: 'co-a' }),
      makeCandidate({ gid: 'co-b' }),
      makeCandidate({ gid: 'co-c' }),
    ];
    const a = pickFourEyesAssignee({
      candidates: idle,
      requiredRole: 'co',
      proposerGid: 'other',
      caseId: 'case-x',
    });
    const b = pickFourEyesAssignee({
      candidates: idle,
      requiredRole: 'co',
      proposerGid: 'other',
      caseId: 'case-x',
    });
    expect(a.assigneeGid).toBe(b.assigneeGid);
  });

  it('respects required role tier', () => {
    const mixed: CoCandidate[] = [
      makeCandidate({ gid: 'analyst-1', role: 'analyst', pendingApprovalCount: 0 }),
      makeCandidate({ gid: 'mlro-1', role: 'mlro', pendingApprovalCount: 5 }),
      makeCandidate({ gid: 'co-1', role: 'co', pendingApprovalCount: 10 }),
    ];
    const r = pickFourEyesAssignee({
      candidates: mixed,
      requiredRole: 'co',
      proposerGid: 'other',
      caseId: 'case-1',
    });
    expect(r.assigneeGid).toBe('co-1'); // only one meets co+
  });

  it('carries the regulatory anchors when load-balanced', () => {
    const r = pickFourEyesAssignee({
      candidates: pool,
      requiredRole: 'co',
      proposerGid: 'other',
      caseId: 'case-1',
    });
    expect(r.regulatory).toContain('Cabinet Res 134/2025 Art.12-14');
    expect(r.regulatory).toContain('Cabinet Res 74/2020 Art.4-7');
  });
});

describe('helpers', () => {
  it('loadScore weights pending higher than in-flight', () => {
    expect(loadScore(makeCandidate({ pendingApprovalCount: 10 }))).toBeGreaterThan(
      loadScore(makeCandidate({ inFlightCaseCount: 10 }))
    );
  });

  it('meetsRole respects the role tier ladder', () => {
    expect(meetsRole(makeCandidate({ role: 'co' }), 'mlro')).toBe(true);
    expect(meetsRole(makeCandidate({ role: 'analyst' }), 'co')).toBe(false);
  });
});
