/**
 * Governance batch tests — policy editor + template library + staff
 * training tracker + review cycle scheduler + RBAC matrix.
 */
import { describe, it, expect } from 'vitest';

import {
  createPolicyVersion,
  signPolicyVersion,
  rejectPolicyVersion,
  policyDiff,
  diffPolicyBodies,
  verifyPolicyChain,
  type PolicyVersion,
} from '../src/services/policyEditor';

import {
  renderTemplate,
  listTemplatesByKind,
  TEMPLATES,
} from '../src/services/templateLibrary';

import {
  computeTrainingCompliance,
  staffNeedingReminder,
  type StaffMember,
  type TrainingSession,
} from '../src/services/staffTrainingTracker';

import {
  computeReviewSchedule,
  type CustomerReviewRecord,
  __test__ as scheduleInternals,
} from '../src/services/reviewCycleScheduler';

import {
  can,
  buildPermissionMatrix,
  __test__ as rbacInternals,
} from '../src/services/rbacPermissionMatrix';

// ===========================================================================
// policyEditor
// ===========================================================================

describe('policyEditor', () => {
  const tenantId = 'tenant-a';

  it('createPolicyVersion produces draft with hash + id', () => {
    const v = createPolicyVersion({
      tenantId,
      previous: null,
      body: '# Policy v1\nAll the rules.',
      createdByUserId: 'u1',
      changeReason: 'Initial publication of policy',
      now: () => new Date('2026-04-15T10:00:00Z'),
    });
    expect(v.version).toBe(1);
    expect(v.status).toBe('draft');
    expect(v.signatures).toEqual([]);
    expect(v.bodyHashHex.length).toBe(128);
  });

  it('rejects empty body and short changeReason', () => {
    expect(() =>
      createPolicyVersion({
        tenantId,
        previous: null,
        body: '',
        createdByUserId: 'u1',
        changeReason: 'x',
      })
    ).toThrow();
    expect(() =>
      createPolicyVersion({
        tenantId,
        previous: null,
        body: 'good',
        createdByUserId: 'u1',
        changeReason: 'short',
      })
    ).toThrow();
  });

  it('three-signature flow approves the policy', () => {
    let v = createPolicyVersion({
      tenantId,
      previous: null,
      body: 'policy body',
      createdByUserId: 'u1',
      changeReason: 'Initial publication of policy',
    });
    v = signPolicyVersion({ version: v, signerUserId: 'mlro-1', signerRole: 'mlro' });
    expect(v.status).toBe('pending_approval');
    v = signPolicyVersion({ version: v, signerUserId: 'co-1', signerRole: 'co' });
    expect(v.status).toBe('pending_approval');
    v = signPolicyVersion({ version: v, signerUserId: 'board-1', signerRole: 'board' });
    expect(v.status).toBe('approved');
    expect(v.effectiveFromIso).not.toBeNull();
  });

  it('same user cannot sign twice', () => {
    let v = createPolicyVersion({
      tenantId,
      previous: null,
      body: 'body',
      createdByUserId: 'u1',
      changeReason: 'Initial publication of policy',
    });
    v = signPolicyVersion({ version: v, signerUserId: 'mlro-1', signerRole: 'mlro' });
    expect(() =>
      signPolicyVersion({ version: v, signerUserId: 'mlro-1', signerRole: 'co' })
    ).toThrow();
  });

  it('same role cannot be signed twice', () => {
    let v = createPolicyVersion({
      tenantId,
      previous: null,
      body: 'body',
      createdByUserId: 'u1',
      changeReason: 'Initial publication of policy',
    });
    v = signPolicyVersion({ version: v, signerUserId: 'mlro-1', signerRole: 'mlro' });
    expect(() =>
      signPolicyVersion({ version: v, signerUserId: 'mlro-2', signerRole: 'mlro' })
    ).toThrow();
  });

  it('rejectPolicyVersion sets status + requires long reason', () => {
    const v = createPolicyVersion({
      tenantId,
      previous: null,
      body: 'body',
      createdByUserId: 'u1',
      changeReason: 'Initial publication of policy',
    });
    expect(() => rejectPolicyVersion(v, 'short', 'u2')).toThrow();
    const rejected = rejectPolicyVersion(v, 'insufficient detail on thresholds', 'u2');
    expect(rejected.status).toBe('rejected');
  });

  it('diffPolicyBodies identifies added + removed lines', () => {
    const diff = diffPolicyBodies('a\nb\nc', 'a\nb\nd');
    const added = diff.filter((l) => l.kind === 'added').map((l) => l.text);
    const removed = diff.filter((l) => l.kind === 'removed').map((l) => l.text);
    expect(added).toEqual(['d']);
    expect(removed).toEqual(['c']);
  });

  it('policyDiff wraps diffPolicyBodies with counts', () => {
    const v1: PolicyVersion = createPolicyVersion({
      tenantId,
      previous: null,
      body: 'a\nb\nc',
      createdByUserId: 'u1',
      changeReason: 'first version of policy',
    });
    const v2: PolicyVersion = createPolicyVersion({
      tenantId,
      previous: v1,
      body: 'a\nb\nd',
      createdByUserId: 'u1',
      changeReason: 'updated to reflect new circular',
    });
    const d = policyDiff(v1, v2);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
    expect(d.unchangedCount).toBe(2);
  });

  it('verifyPolicyChain validates a clean chain', () => {
    const v1 = createPolicyVersion({
      tenantId,
      previous: null,
      body: 'v1',
      createdByUserId: 'u1',
      changeReason: 'first version of policy',
    });
    const v2 = createPolicyVersion({
      tenantId,
      previous: v1,
      body: 'v2',
      createdByUserId: 'u1',
      changeReason: 'second version of policy',
    });
    expect(verifyPolicyChain([v1, v2])).toBe(true);
  });

  it('verifyPolicyChain detects a tampered body', () => {
    const v1 = createPolicyVersion({
      tenantId,
      previous: null,
      body: 'v1',
      createdByUserId: 'u1',
      changeReason: 'first version of policy',
    });
    const tampered = { ...v1, body: 'EVIL' };
    expect(verifyPolicyChain([tampered])).toBe(false);
  });
});

// ===========================================================================
// templateLibrary
// ===========================================================================

describe('templateLibrary', () => {
  it('renders a known template with all variables', () => {
    const r = renderTemplate('str-v1', {
      caseId: 'case-1',
      entityName: 'Acme',
      triggerDate: '2026-04-15',
      amountAED: 65000,
      topFactors: '- txValue30dAED',
      verdict: 'flag',
    });
    expect(r.ok).toBe(true);
    expect(r.body).toContain('Acme');
    expect(r.body).toContain('65000');
  });

  it('rejects missing required variables', () => {
    const r = renderTemplate('str-v1', { caseId: 'case-1' });
    expect(r.ok).toBe(false);
    expect(r.missingVars.length).toBeGreaterThan(0);
  });

  it('unknown template id fails gracefully', () => {
    const r = renderTemplate('does-not-exist', {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it('listTemplatesByKind filters correctly', () => {
    const str = listTemplatesByKind('str_narrative');
    expect(str.length).toBeGreaterThan(0);
    expect(str.every((t) => t.kind === 'str_narrative')).toBe(true);
  });

  it('every shipped template has non-empty required vars', () => {
    for (const t of TEMPLATES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
      expect(t.regulatory.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// staffTrainingTracker
// ===========================================================================

describe('staffTrainingTracker', () => {
  const staff: StaffMember[] = [
    { id: 's1', tenantId: 'tenant-a', fullName: 'Alice', role: 'mlro', active: true },
    { id: 's2', tenantId: 'tenant-a', fullName: 'Bob', role: 'analyst', active: true },
    { id: 's3', tenantId: 'tenant-a', fullName: 'Carol', role: 'co', active: false },
  ];

  const sessions: TrainingSession[] = [
    {
      id: 't1',
      staffId: 's1',
      completedAtIso: '2026-03-10T00:00:00Z',
      durationHours: 5,
      topic: 'Annual AML',
      provider: 'UAE FIU',
      evidenceUrl: null,
    },
    {
      id: 't2',
      staffId: 's2',
      completedAtIso: '2026-01-15T00:00:00Z',
      durationHours: 1,
      topic: 'Intro',
      provider: 'Internal',
      evidenceUrl: null,
    },
  ];

  it('computes compliance report for the calendar year', () => {
    const r = computeTrainingCompliance('tenant-a', staff, sessions, 2026);
    // Carol is inactive so excluded
    expect(r.totalStaff).toBe(2);
    expect(r.staffMeetingMinimum).toBe(1); // Alice with 5h
    expect(r.staffBelowMinimum).toBe(1); // Bob with 1h
    expect(r.overallComplianceRate).toBeCloseTo(0.5);
  });

  it('sorts per-staff ascending by completed hours', () => {
    const r = computeTrainingCompliance('tenant-a', staff, sessions, 2026);
    expect(r.perStaff[0]!.completedHoursInYear).toBeLessThanOrEqual(
      r.perStaff[1]!.completedHoursInYear
    );
  });

  it('excludes sessions outside the calendar year', () => {
    const lastYear: TrainingSession = {
      id: 't-old',
      staffId: 's1',
      completedAtIso: '2025-12-01T00:00:00Z',
      durationHours: 10,
      topic: 'Old',
      provider: 'Old',
      evidenceUrl: null,
    };
    const r = computeTrainingCompliance('tenant-a', staff, [...sessions, lastYear], 2026);
    expect(r.perStaff.find((s) => s.staffId === 's1')!.completedHoursInYear).toBe(5); // only 2026 session
  });

  it('staffNeedingReminder lists below-minimum staff', () => {
    const r = computeTrainingCompliance('tenant-a', staff, sessions, 2026);
    const need = staffNeedingReminder(r);
    expect(need.map((s) => s.fullName)).toContain('Bob');
  });
});

// ===========================================================================
// reviewCycleScheduler
// ===========================================================================

describe('reviewCycleScheduler', () => {
  const { addMonths } = scheduleInternals;

  it('addMonths handles year rollover', () => {
    expect(addMonths('2026-12-01T00:00:00Z', 3).slice(0, 7)).toBe('2027-03');
  });

  it('flags overdue EDD customers', () => {
    const customers: CustomerReviewRecord[] = [
      {
        customerId: 'c1',
        tenantId: 'tenant-a',
        legalName: 'Acme',
        riskTier: 'EDD',
        lastReviewedAtIso: '2025-04-01T00:00:00Z', // > 6 months ago
      },
    ];
    const r = computeReviewSchedule('tenant-a', customers, {
      now: () => new Date('2026-04-15T00:00:00Z'),
    });
    expect(r.overdue.length).toBe(1);
    expect(r.summary).toMatch(/penalty exposure/);
  });

  it('classifies due_soon when within horizon', () => {
    const customers: CustomerReviewRecord[] = [
      {
        customerId: 'c2',
        tenantId: 'tenant-a',
        legalName: 'Beta',
        riskTier: 'CDD',
        lastReviewedAtIso: '2025-05-10T00:00:00Z', // due ~2026-05-10
      },
    ];
    const r = computeReviewSchedule('tenant-a', customers, {
      now: () => new Date('2026-04-15T00:00:00Z'),
      horizonDays: 30,
    });
    expect(r.dueSoon.length).toBe(1);
  });

  it('excludes comfortable customers past the horizon', () => {
    const customers: CustomerReviewRecord[] = [
      {
        customerId: 'c3',
        tenantId: 'tenant-a',
        legalName: 'Gamma',
        riskTier: 'SDD',
        lastReviewedAtIso: '2026-04-01T00:00:00Z', // due 2028
      },
    ];
    const r = computeReviewSchedule('tenant-a', customers, {
      now: () => new Date('2026-04-15T00:00:00Z'),
      horizonDays: 30,
    });
    expect(r.overdue.length + r.dueNow.length + r.dueSoon.length).toBe(0);
  });

  it('carries citations per risk tier', () => {
    const customers: CustomerReviewRecord[] = [
      {
        customerId: 'c4',
        tenantId: 'tenant-a',
        legalName: 'PEP Corp',
        riskTier: 'PEP',
        lastReviewedAtIso: '2025-01-01T00:00:00Z',
      },
    ];
    const r = computeReviewSchedule('tenant-a', customers, {
      now: () => new Date('2026-04-15T00:00:00Z'),
    });
    expect(r.overdue[0]!.citation).toMatch(/PEP/);
  });
});

// ===========================================================================
// rbacPermissionMatrix
// ===========================================================================

describe('rbacPermissionMatrix', () => {
  it('analyst can run brain.analyze', () => {
    expect(can('analyst', 'brain.analyze').allowed).toBe(true);
  });

  it('analyst CANNOT release outbound (co+ only)', () => {
    expect(can('analyst', 'tierC.outbound.release').allowed).toBe(false);
  });

  it('co CAN release outbound', () => {
    expect(can('co', 'tierC.outbound.release').allowed).toBe(true);
  });

  it('only admin can manage RBAC', () => {
    expect(can('co', 'rbac.manage').allowed).toBe(false);
    expect(can('admin', 'rbac.manage').allowed).toBe(true);
  });

  it('unknown action is denied', () => {
    // @ts-expect-error testing unknown action
    expect(can('admin', 'nope.nothing').allowed).toBe(false);
  });

  it('buildPermissionMatrix covers every action', () => {
    const matrix = buildPermissionMatrix();
    expect(matrix.length).toBe(rbacInternals.RULES.length);
    for (const row of matrix) {
      expect(row.allowedRoles.length).toBeGreaterThan(0);
      expect(row.citation.length).toBeGreaterThan(0);
    }
  });

  it('guest role cannot perform any action', () => {
    // Guest rank is below every rule's min rank.
    expect(can('guest', 'brain.analyze').allowed).toBe(false);
  });

  it('board-only policy sign is exclusive to board', () => {
    expect(can('co', 'policy.sign.board').allowed).toBe(false);
    expect(can('board', 'policy.sign.board').allowed).toBe(true);
  });
});
