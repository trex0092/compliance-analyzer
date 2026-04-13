/**
 * Tests for the Kanban auto-sort planner. Pure — injected
 * case resolver drives the verdict routing.
 */
import { describe, it, expect } from 'vitest';
import { buildAutoSortPlan } from '@/services/kanbanAutoSort';
import type { KanbanBoard } from '@/services/asanaKanbanView';
import type { ComplianceCase } from '@/domain/cases';

function mkBoard(): KanbanBoard {
  const mkCard = (gid: string, dueOn?: string) => ({
    gid,
    name: `task ${gid}`,
    column: 'todo' as const,
    dueOn,
    tagLabels: [],
    breachWarning: false,
  });
  return {
    columns: {
      todo: [mkCard('t1'), mkCard('t2')],
      doing: [mkCard('d1')],
      review: [],
      done: [mkCard('done1')],
      blocked: [],
    },
    totalCards: 4,
    breachCount: 0,
    projectGid: 'proj-1',
    fetchedAtIso: '2026-04-13T12:00:00.000Z',
  };
}

function mkCase(id: string, riskLevel: ComplianceCase['riskLevel']): ComplianceCase {
  return {
    id,
    entityId: `ENT-${id}`,
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: riskLevel === 'critical' ? 20 : riskLevel === 'high' ? 14 : 8,
    riskLevel,
    redFlags: [],
    findings: [],
    narrative: '',
    recommendation: 'continue',
    auditLog: [],
  };
}

describe('buildAutoSortPlan', () => {
  it('reports unresolved cards when the resolver returns undefined', () => {
    const plan = buildAutoSortPlan(mkBoard(), { resolveCase: () => undefined });
    expect(plan.unresolved).toBe(4);
    expect(plan.unchanged).toBe(0);
  });

  it('moves a critical-risk card from todo to blocked', () => {
    const plan = buildAutoSortPlan(mkBoard(), {
      resolveCase: (gid) =>
        gid === 't1' ? mkCase('case-1', 'critical') : undefined,
    });
    const move = plan.moves.find((m) => m.taskGid === 't1' && !m.unresolved);
    expect(move).toBeDefined();
    expect(move?.fromColumn).toBe('todo');
    expect(move?.toColumn).toBe('blocked');
    expect(move?.verdict).toBe('freeze');
  });

  it('keeps a low-risk card in done', () => {
    const plan = buildAutoSortPlan(mkBoard(), {
      resolveCase: (gid) => (gid === 'done1' ? mkCase('c-done', 'low') : undefined),
    });
    expect(plan.unchanged).toBe(1);
    const move = plan.moves.find((m) => m.taskGid === 'done1' && !m.unresolved);
    expect(move).toBeUndefined();
  });
});
