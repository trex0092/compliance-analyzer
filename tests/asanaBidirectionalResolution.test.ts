/**
 * Tests for the Asana → local case resolution bridge. The plan
 * builder + applier are pure so the tests don't touch the store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildResolutionPlan,
  applyResolutionPlan,
} from '@/services/asanaBidirectionalResolution';
import { addTaskLink } from '@/services/asanaTaskLinks';
import type { ComplianceCase } from '@/domain/cases';

beforeEach(() => {
  // Polyfill localStorage so asanaTaskLinks.addTaskLink has somewhere to write.
  const storage = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    get length() {
      return storage.size;
    },
  } as unknown as Storage;
});

function mkCase(overrides: Partial<ComplianceCase> = {}): ComplianceCase {
  return {
    id: 'case-test',
    entityId: 'ACME',
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: 8,
    riskLevel: 'medium',
    redFlags: [],
    findings: [],
    narrative: '',
    recommendation: 'continue',
    auditLog: [],
    ...overrides,
  };
}

describe('buildResolutionPlan', () => {
  it('returns notFound when the asana gid is not linked', () => {
    const plan = buildResolutionPlan({
      asanaGid: 'unknown-task',
      completed: true,
    });
    expect('notFound' in plan && plan.notFound).toBe(true);
  });

  it('closes the case when verdict is pass/flag', () => {
    addTaskLink('case-1', 'case', 'asana-1', 'proj-1');
    const plan = buildResolutionPlan({
      asanaGid: 'asana-1',
      completed: true,
      verdict: 'pass',
      atIso: '2026-04-13T12:00:00.000Z',
    });
    if ('notFound' in plan) throw new Error('unexpected notFound');
    expect(plan.nextStatus).toBe('closed');
  });

  it('marks the case escalated when verdict is freeze', () => {
    addTaskLink('case-2', 'case', 'asana-2', 'proj-1');
    const plan = buildResolutionPlan({
      asanaGid: 'asana-2',
      completed: true,
      verdict: 'freeze',
    });
    if ('notFound' in plan) throw new Error('unexpected notFound');
    expect(plan.nextStatus).toBe('escalated');
  });

  it('marks the case under-review when verdict is escalate', () => {
    addTaskLink('case-3', 'case', 'asana-3', 'proj-1');
    const plan = buildResolutionPlan({
      asanaGid: 'asana-3',
      completed: true,
      verdict: 'escalate',
    });
    if ('notFound' in plan) throw new Error('unexpected notFound');
    expect(plan.nextStatus).toBe('under-review');
  });

  it('reopens a case when completed=false', () => {
    addTaskLink('case-4', 'case', 'asana-4', 'proj-1');
    const plan = buildResolutionPlan({
      asanaGid: 'asana-4',
      completed: false,
    });
    if ('notFound' in plan) throw new Error('unexpected notFound');
    expect(plan.nextStatus).toBe('open');
  });
});

describe('applyResolutionPlan', () => {
  it('returns a new case object with the updated status + audit log', () => {
    addTaskLink('case-5', 'case', 'asana-5', 'proj-1');
    const plan = buildResolutionPlan({
      asanaGid: 'asana-5',
      completed: true,
      verdict: 'pass',
      atIso: '2026-04-13T15:00:00.000Z',
    });
    if ('notFound' in plan) throw new Error('unexpected');
    const updated = applyResolutionPlan(mkCase({ id: 'case-5' }), plan);
    expect(updated.status).toBe('closed');
    expect(updated.auditLog.at(-1)?.action).toBe('status-changed');
    expect(updated.auditLog.at(-1)?.note).toContain('closed');
  });
});
