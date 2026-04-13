/**
 * Tests for the super-brain batch dispatcher. Uses an injected
 * dispatcher fake so we never touch Asana or localStorage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runSuperBrainBatch } from '@/services/superBrainBatchDispatcher';
import type { ComplianceCase } from '@/domain/cases';
import type { SuperBrainDispatchResult } from '@/services/asanaSuperBrainDispatcher';
import { clearAuditLog } from '@/services/dispatchAuditLog';

beforeEach(() => {
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
  clearAuditLog();
});

function mkCase(id: string, riskLevel: ComplianceCase['riskLevel'] = 'medium'): ComplianceCase {
  return {
    id,
    entityId: `ENT-${id}`,
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: 10,
    riskLevel,
    redFlags: ['RF-1', 'RF-2'],
    findings: ['f1', 'f2'],
    narrative: 'demo',
    recommendation: 'continue',
    auditLog: [],
  };
}

function mkSuccessResult(caseObj: ComplianceCase): SuperBrainDispatchResult {
  return {
    plan: {
      verdict: 'flag',
      suggestedColumn: 'doing',
      enrichment: {
        customFields: {},
        notesBlock: 'notes',
        suggestedColumn: 'doing',
        headline: 'Brain verdict: FLAG',
        stageEnrichments: {
          'mlro-review': '',
          'four-eyes': '',
          'goaml-xml': '',
          'submit-fiu': '',
          'retain-10y': '',
          'monitor-ack': '',
          close: '',
        },
      },
      dispatchStrLifecycle: true,
      dispatchFourEyes: false,
      parentTaskPayload: { name: 't', notes: 'n', projects: ['p'] },
      strSubtaskPayloads: [],
      fourEyesPayloads: [],
      toast: {
        id: `t_${caseObj.id}`,
        kind: 'asana_comment',
        severity: 'info',
        title: 'Super-brain',
        body: 'flag',
        caseId: caseObj.id,
        atIso: '2026-04-13T12:00:00.000Z',
      },
      warnings: [],
    },
    ok: true,
    errors: [],
    parentGid: `asana-${caseObj.id}`,
    strLifecycle: undefined,
    fourEyesGids: [],
    annotatedCount: 0,
  };
}

describe('runSuperBrainBatch', () => {
  it('dispatches each case once and reports the summary', async () => {
    const dispatcher = vi.fn(async (input: { case: ComplianceCase }) =>
      mkSuccessResult(input.case)
    );
    const summary = await runSuperBrainBatch(
      [mkCase('c1'), mkCase('c2'), mkCase('c3')],
      { trigger: 'manual', dispatcher, skipAlreadyDispatched: false }
    );
    expect(summary.total).toBe(3);
    expect(summary.dispatched).toBe(3);
    expect(summary.failed).toBe(0);
    expect(dispatcher).toHaveBeenCalledTimes(3);
  });

  it('skips cases already in the audit log', async () => {
    const dispatcher = vi.fn(async (input: { case: ComplianceCase }) =>
      mkSuccessResult(input.case)
    );
    await runSuperBrainBatch([mkCase('c1')], {
      trigger: 'manual',
      dispatcher,
      skipAlreadyDispatched: true,
    });
    const summary = await runSuperBrainBatch([mkCase('c1'), mkCase('c2')], {
      trigger: 'manual',
      dispatcher,
      skipAlreadyDispatched: true,
    });
    expect(summary.skipped).toBe(1);
    expect(summary.dispatched).toBe(1);
  });

  it('aborts after consecutive failures', async () => {
    const dispatcher = vi.fn(async () => {
      throw new Error('HTTP 500 server error');
    });
    const summary = await runSuperBrainBatch(
      Array.from({ length: 10 }, (_, i) => mkCase(`c${i}`)),
      {
        trigger: 'manual',
        dispatcher,
        consecutiveFailureLimit: 2,
        backoff: { maxAttempts: 1 },
      }
    );
    expect(summary.aborted).toBeDefined();
    expect(summary.failed).toBeGreaterThanOrEqual(2);
    expect(summary.failed).toBeLessThanOrEqual(3);
  });
});
