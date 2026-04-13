/**
 * Tests for the pure planner in the Asana super-brain dispatcher.
 * The executor path depends on fetch + localStorage and is covered
 * indirectly by the individual service tests it composes.
 */
import { describe, it, expect } from 'vitest';
import type { ComplianceCase } from '@/domain/cases';
import { buildSuperBrainDispatchPlan } from '@/services/asanaSuperBrainDispatcher';
import type { FourEyesApprover } from '@/services/fourEyesSubtasks';

function mkCase(overrides: Partial<ComplianceCase> = {}): ComplianceCase {
  return {
    id: 'case-sb-1',
    entityId: 'ACME LLC',
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: 14,
    riskLevel: 'high',
    redFlags: ['RF1', 'RF2'],
    findings: ['Unusual wire transfer pattern', 'Source of funds unclear'],
    narrative: 'Case surfaced during transaction monitoring',
    recommendation: 'edd',
    auditLog: [],
    ...overrides,
  };
}

const approvers: [FourEyesApprover, FourEyesApprover] = [
  { gid: 'user-1', name: 'MLRO Primary' },
  { gid: 'user-2', name: 'MLRO Independent' },
];

describe('buildSuperBrainDispatchPlan — verdict routing', () => {
  it('high-risk case → verdict escalate → STR lifecycle + four-eyes dispatched', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'high' }),
      projectGid: 'proj-1',
      fourEyesApprovers: approvers,
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.verdict).toBe('escalate');
    expect(plan.dispatchStrLifecycle).toBe(true);
    expect(plan.dispatchFourEyes).toBe(true);
    expect(plan.strSubtaskPayloads).toHaveLength(7);
    expect(plan.fourEyesPayloads).toHaveLength(2);
  });

  it('critical case → verdict freeze → four-eyes required', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'critical' }),
      projectGid: 'proj-1',
      fourEyesApprovers: approvers,
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.verdict).toBe('freeze');
    expect(plan.dispatchFourEyes).toBe(true);
    expect(plan.suggestedColumn).toBe('blocked');
  });

  it('low-risk clean case → verdict pass → no STR, no four-eyes', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'low', redFlags: [], findings: [] }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.verdict).toBe('pass');
    expect(plan.dispatchStrLifecycle).toBe(false);
    expect(plan.dispatchFourEyes).toBe(false);
    expect(plan.strSubtaskPayloads).toEqual([]);
    expect(plan.fourEyesPayloads).toEqual([]);
    expect(plan.suggestedColumn).toBe('done');
  });

  it('medium-risk with 2 red flags → verdict flag → STR dispatched, no four-eyes', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'medium', redFlags: ['RF1', 'RF2'] }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.verdict).toBe('flag');
    expect(plan.dispatchStrLifecycle).toBe(true);
    expect(plan.dispatchFourEyes).toBe(false);
    expect(plan.fourEyesPayloads).toHaveLength(0);
  });
});

describe('buildSuperBrainDispatchPlan — warnings', () => {
  it('warns when four-eyes is required but no approvers are supplied', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'critical' }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.warnings.some((w) => w.includes('four-eyes'))).toBe(true);
    expect(plan.fourEyesPayloads).toHaveLength(0);
  });

  it('no warnings on pass verdict', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'low', redFlags: [], findings: [] }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.warnings).toEqual([]);
  });
});

describe('buildSuperBrainDispatchPlan — FDL Art.29 pin', () => {
  it('parent task name uses case id, never entity legal name', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ entityId: 'MADISON JEWELLERY TRADING LLC', riskLevel: 'high' }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.parentTaskPayload.name).toContain('case-sb-1');
    expect(plan.parentTaskPayload.name).not.toContain('MADISON');
  });

  it('four-eyes subtask names use case id only', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ entityId: 'NAPLES JEWELLERY', riskLevel: 'high' }),
      projectGid: 'proj-1',
      fourEyesApprovers: approvers,
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    for (const p of plan.fourEyesPayloads) {
      expect(p.name).not.toContain('NAPLES');
    }
  });
});

describe('buildSuperBrainDispatchPlan — toast', () => {
  it('toast severity matches verdict urgency', () => {
    const freeze = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'critical' }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(freeze.toast.severity).toBe('critical');

    const escalate = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'high' }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(escalate.toast.severity).toBe('warning');

    const flagPlan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'medium', redFlags: ['RF1', 'RF2'] }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(flagPlan.toast.severity).toBe('info');
  });

  it('toast title and body cite the verdict', () => {
    const plan = buildSuperBrainDispatchPlan({
      case: mkCase({ riskLevel: 'critical' }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    });
    expect(plan.toast.title).toContain('FREEZE');
    expect(plan.toast.body.length).toBeGreaterThan(0);
  });

  it('toast id is deterministic under a fixed dispatchedAtIso', () => {
    const ctx = {
      case: mkCase({ riskLevel: 'high' }),
      projectGid: 'proj-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    };
    const a = buildSuperBrainDispatchPlan(ctx);
    const b = buildSuperBrainDispatchPlan(ctx);
    expect(a.toast.id).toBe(b.toast.id);
  });
});
