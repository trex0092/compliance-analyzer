/**
 * Bundled tests for Tier B + Tier C services.
 *
 * Tier B:
 *   - dispatchPatternMiner
 *   - priorityScorer
 *   - reasoningChainReplay
 *   - shapleyBrainOverlay
 *
 * Tier C:
 *   - fourEyesCompletionDetector
 *   - smartRetryClassifier
 *   - skillDeadLetterQueue
 *   - tenantRateBudget
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mineDispatchPatterns,
  buildSignature,
} from '@/services/dispatchPatternMiner';
import { scoreCase, sortCasesByPriority } from '@/services/priorityScorer';
import {
  recordReasoningChain,
  readReasoningChain,
  listRecentChains,
  clearReasoningChains,
  verifySeal,
  computeSealHash,
} from '@/services/reasoningChainReplay';
import { computeShapleyOverlay } from '@/services/shapleyBrainOverlay';
import { buildCompletionPlan } from '@/services/fourEyesCompletionDetector';
import { classifyError } from '@/services/smartRetryClassifier';
import {
  recordAttempt,
  recordSuccess,
  readDeadLetter,
  clearDeadLetter,
  getAttemptCount,
} from '@/services/skillDeadLetterQueue';
import {
  consumeTenantTokens,
  snapshotTenantBudgets,
  configureTenantBudget,
  __resetTenantBudgetsForTests,
} from '@/services/tenantRateBudget';
import type { ComplianceCase } from '@/domain/cases';
import type { DispatchAuditEntry } from '@/services/dispatchAuditLog';

// localStorage polyfill
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
  clearReasoningChains();
  clearDeadLetter();
  __resetTenantBudgetsForTests();
});

function mkCase(overrides: Partial<ComplianceCase> = {}): ComplianceCase {
  return {
    id: 'case-x',
    entityId: 'ACME',
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: 10,
    riskLevel: 'medium',
    redFlags: [],
    findings: [],
    narrative: '',
    recommendation: 'continue',
    auditLog: [],
    ...overrides,
  };
}

function mkEntry(overrides: Partial<DispatchAuditEntry> = {}): DispatchAuditEntry {
  return {
    id: 'audit_x',
    dispatchedAtIso: '2026-04-13T12:00:00.000Z',
    caseId: 'case-1',
    verdict: 'flag',
    confidence: 0.8,
    suggestedColumn: 'doing',
    strSubtaskCount: 7,
    fourEyesCount: 0,
    annotatedCount: 0,
    errors: [],
    warnings: [],
    trigger: 'manual',
    dispatcherVersion: '1.0.0',
    ...overrides,
  };
}

// ───── Tier B1: dispatchPatternMiner ─────────────────────────────────────

describe('dispatchPatternMiner', () => {
  it('buildSignature collapses verdict + column + day', () => {
    const sig = buildSignature(mkEntry());
    expect(sig).toBe('flag:doing:2026-04-13');
  });

  it('clusters entries with matching signature', () => {
    const clusters = mineDispatchPatterns(
      [
        mkEntry({ caseId: 'c1' }),
        mkEntry({ caseId: 'c2' }),
        mkEntry({ caseId: 'c3', verdict: 'freeze', suggestedColumn: 'blocked' }),
      ],
      { minClusterSize: 2 }
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(2);
  });

  it('honours topN limit', () => {
    const entries: DispatchAuditEntry[] = [];
    for (let i = 0; i < 6; i++) {
      entries.push(mkEntry({ caseId: `a${i}`, verdict: 'flag' }));
      entries.push(mkEntry({ caseId: `b${i}`, verdict: 'pass', suggestedColumn: 'done' }));
    }
    const clusters = mineDispatchPatterns(entries, { minClusterSize: 2, topN: 1 });
    expect(clusters).toHaveLength(1);
  });
});

// ───── Tier B2: priorityScorer ───────────────────────────────────────────

describe('priorityScorer', () => {
  it('scores a critical-risk case higher than a low-risk case', () => {
    const hi = scoreCase(mkCase({ riskLevel: 'critical' }));
    const lo = scoreCase(mkCase({ riskLevel: 'low' }));
    expect(hi.score).toBeGreaterThan(lo.score);
  });

  it('adds criticality boost for sanctions keyword', () => {
    const plain = scoreCase(mkCase({ riskLevel: 'medium' }));
    const withSanctions = scoreCase(
      mkCase({ riskLevel: 'medium', narrative: 'potential OFAC match' })
    );
    expect(withSanctions.score).toBeGreaterThan(plain.score);
  });

  it('sortCasesByPriority returns descending order', () => {
    const cases = [
      mkCase({ id: 'c1', riskLevel: 'low' }),
      mkCase({ id: 'c2', riskLevel: 'critical' }),
      mkCase({ id: 'c3', riskLevel: 'medium' }),
    ];
    const sorted = sortCasesByPriority(cases);
    expect(sorted[0].id).toBe('c2');
    expect(sorted[2].id).toBe('c1');
  });

  it('urgency component jumps when deadline is within 24h', () => {
    const urgent = scoreCase(mkCase({ riskLevel: 'medium' }), {
      nowIso: '2026-04-13T12:00:00.000Z',
      deadlineResolver: () => '2026-04-14T00:00:00.000Z',
    });
    expect(urgent.components.urgency).toBeGreaterThanOrEqual(30);
  });
});

// ───── Tier B3: reasoningChainReplay ─────────────────────────────────────

describe('reasoningChainReplay', () => {
  it('records a chain and reads it back', () => {
    const record = recordReasoningChain({
      caseId: 'c1',
      verdict: 'flag',
      confidence: 0.8,
      steps: [{ id: 's1', subsystem: 'belief', at: '2026-04-13T12:00:00.000Z' }],
    });
    expect(record.sealHash).toBeDefined();
    const read = readReasoningChain('c1');
    expect(read?.verdict).toBe('flag');
  });

  it('verifySeal returns true on untampered chains', () => {
    const record = recordReasoningChain({
      caseId: 'c2',
      verdict: 'freeze',
      confidence: 0.95,
      steps: [],
    });
    expect(verifySeal(record)).toBe(true);
  });

  it('verifySeal catches tampered payloads', () => {
    const record = recordReasoningChain({
      caseId: 'c3',
      verdict: 'flag',
      confidence: 0.8,
      steps: [],
    });
    const tampered = { ...record, verdict: 'pass' };
    expect(verifySeal(tampered)).toBe(false);
  });

  it('listRecentChains respects the limit', () => {
    for (let i = 0; i < 5; i++) {
      recordReasoningChain({
        caseId: `c${i}`,
        verdict: 'flag',
        confidence: 0.8,
        steps: [],
        recordedAtIso: `2026-04-13T12:0${i}:00.000Z`,
      });
    }
    expect(listRecentChains(3)).toHaveLength(3);
  });

  it('computeSealHash is deterministic', () => {
    const a = computeSealHash({ caseId: 'c1', verdict: 'flag', steps: [] });
    const b = computeSealHash({ caseId: 'c1', verdict: 'flag', steps: [] });
    expect(a).toBe(b);
  });
});

// ───── Tier B4: shapleyBrainOverlay ──────────────────────────────────────

describe('shapleyBrainOverlay', () => {
  it('computes non-zero contributions for each feature in the verdict', () => {
    const features = ['a', 'b', 'c'];
    // Verdict is the size of the coalition — every feature contributes equally.
    const overlay = computeShapleyOverlay(features, (coalition) => coalition.size, {
      samples: 30,
      seed: 1,
    });
    for (const c of overlay.contributions) {
      expect(c.contribution).toBeCloseTo(1, 1);
    }
  });

  it('baseline is the empty-coalition verdict', () => {
    const features = ['a', 'b'];
    const overlay = computeShapleyOverlay(features, () => 0, { samples: 5, seed: 2 });
    expect(overlay.baseline).toBe(0);
  });

  it('ranks features by absolute contribution', () => {
    const features = ['a', 'b'];
    const overlay = computeShapleyOverlay(
      features,
      (coalition) => (coalition.has('a') ? 10 : 0),
      { samples: 30, seed: 3 }
    );
    expect(overlay.contributions[0].feature).toBe('a');
  });
});

// ───── Tier C1: fourEyesCompletionDetector ───────────────────────────────

describe('fourEyesCompletionDetector', () => {
  it('closes parent when all required subtasks complete', () => {
    const plan = buildCompletionPlan(
      [
        { parentGid: 'p1', stage: 'mlro-review', subtaskGid: 's1', required: true },
        { parentGid: 'p1', stage: 'four-eyes', subtaskGid: 's2', required: true },
      ],
      [
        { subtaskGid: 's1', completed: true, completedAtIso: '2026-04-13T12:00:00.000Z' },
        { subtaskGid: 's2', completed: true, completedAtIso: '2026-04-13T12:01:00.000Z' },
      ]
    );
    expect(plan.parentsToClose).toContain('p1');
  });

  it('reports pending when a required subtask is incomplete', () => {
    const plan = buildCompletionPlan(
      [
        { parentGid: 'p1', stage: 'mlro-review', subtaskGid: 's1', required: true },
        { parentGid: 'p1', stage: 'four-eyes', subtaskGid: 's2', required: true },
      ],
      [{ subtaskGid: 's1', completed: true, completedAtIso: '2026-04-13T12:00:00.000Z' }]
    );
    expect(plan.parentsToClose).toHaveLength(0);
    expect(plan.parentsPending[0].pendingStages).toContain('four-eyes');
  });

  it('ignores non-required subtasks', () => {
    const plan = buildCompletionPlan(
      [
        { parentGid: 'p1', stage: 'mlro-review', subtaskGid: 's1', required: true },
        { parentGid: 'p1', stage: 'optional', subtaskGid: 's2', required: false },
      ],
      [{ subtaskGid: 's1', completed: true, completedAtIso: '2026-04-13T12:00:00.000Z' }]
    );
    expect(plan.parentsToClose).toContain('p1');
  });
});

// ───── Tier C2: smartRetryClassifier ─────────────────────────────────────

describe('smartRetryClassifier', () => {
  it('401 → permanent-auth, not retryable', () => {
    const result = classifyError({ status: 401, message: 'unauthorized' });
    expect(result.errorClass).toBe('permanent-auth');
    expect(result.retryable).toBe(false);
  });

  it('429 → transient-rate-limit, retryable with long backoff', () => {
    const result = classifyError({ status: 429, message: 'too many requests' });
    expect(result.errorClass).toBe('transient-rate-limit');
    expect(result.retryable).toBe(true);
    expect(result.suggestedBaseDelayMs).toBeGreaterThanOrEqual(2000);
  });

  it('503 → transient-server, retryable', () => {
    const result = classifyError({ status: 503, message: 'service unavailable' });
    expect(result.errorClass).toBe('transient-server');
    expect(result.retryable).toBe(true);
  });

  it('400 → permanent-client, not retryable', () => {
    const result = classifyError({ status: 400, message: 'bad request' });
    expect(result.errorClass).toBe('permanent-client');
    expect(result.retryable).toBe(false);
  });

  it('network error → transient-network, retryable', () => {
    const result = classifyError('network fetch failed');
    expect(result.errorClass).toBe('transient-network');
    expect(result.retryable).toBe(true);
  });

  it('timeout → transient-timeout, retryable', () => {
    const result = classifyError(new Error('operation timeout'));
    expect(result.errorClass).toBe('transient-timeout');
    expect(result.retryable).toBe(true);
  });

  it('normalizes string input with embedded status code', () => {
    const result = classifyError('HTTP 503: service unavailable');
    expect(result.errorClass).toBe('transient-server');
  });
});

// ───── Tier C3: tenantRateBudget ─────────────────────────────────────────

describe('tenantRateBudget', () => {
  it('allows consumption within budget', () => {
    configureTenantBudget('t1', { tokensPerMinute: 60, burstCapacity: 100 });
    expect(consumeTenantTokens('t1', 10)).toBe(true);
  });

  it('rejects consumption over burst capacity', () => {
    configureTenantBudget('t2', { tokensPerMinute: 60, burstCapacity: 50 });
    const base = 1_700_000_000_000;
    expect(consumeTenantTokens('t2', 100, base)).toBe(false);
  });

  it('refills tokens over elapsed time', () => {
    // Use real wall-clock time so the first call's fresh-bucket
    // lastRefillMs (Date.now()) matches the base we advance from.
    configureTenantBudget('t3', { tokensPerMinute: 60, burstCapacity: 60 });
    const base = Date.now();
    consumeTenantTokens('t3', 60, base); // empty the bucket
    // Advance 60 seconds → 60 new tokens refilled.
    expect(consumeTenantTokens('t3', 30, base + 60_000)).toBe(true);
  });

  it('snapshot reports utilization and exhaustion', () => {
    configureTenantBudget('t4', { tokensPerMinute: 60, burstCapacity: 60 });
    const base = 1_700_000_000_000;
    consumeTenantTokens('t4', 60, base);
    const snapshots = snapshotTenantBudgets(base);
    const t4 = snapshots.find((s) => s.tenantId === 't4');
    expect(t4?.exhausted).toBe(true);
  });
});

// ───── Tier C4: skillDeadLetterQueue ─────────────────────────────────────

describe('skillDeadLetterQueue', () => {
  it('retries up to 4 times then moves to dead letter on 5th', () => {
    for (let i = 1; i <= 4; i++) {
      const result = recordAttempt('job-1', `error ${i}`);
      expect(result.shouldRetry).toBe(true);
      expect(result.movedToDeadLetter).toBe(false);
    }
    const final = recordAttempt('job-1', 'error 5');
    expect(final.shouldRetry).toBe(false);
    expect(final.movedToDeadLetter).toBe(true);
    expect(readDeadLetter()).toHaveLength(1);
  });

  it('recordSuccess clears the attempt counter', () => {
    recordAttempt('job-2', 'err');
    recordAttempt('job-2', 'err');
    expect(getAttemptCount('job-2')).toBe(2);
    recordSuccess('job-2');
    expect(getAttemptCount('job-2')).toBe(0);
  });
});
