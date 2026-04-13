/**
 * Bundled tests for Tier D + Tier E services.
 *
 * Tier D:
 *   - eocnDeltaWatcher
 *   - moeCircularIngestor
 *   - fiuAckAutoIngest
 *   - autoFreezeExecutor
 *
 * Tier E:
 *   - federatedLearningPrep
 *   - voiceCommandAdapter
 *   - boardReportPipeline
 *   - aiGovernanceSelfAuditWatchdog
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  diffEocnLists,
  watchEocnDelta,
  saveSnapshot,
} from '@/services/eocnDeltaWatcher';
import { classifyCircular } from '@/services/moeCircularIngestor';
import {
  resolveFiuAckConfig,
  isFiuAckConfigured,
  pollFiuAcks,
  planAckApplication,
} from '@/services/fiuAckAutoIngest';
import { buildFreezePlan, executeAutoFreeze } from '@/services/autoFreezeExecutor';
import {
  anonymizeCaseId,
  maskErrorText,
  toFederatedSample,
  auditFederatedSample,
} from '@/services/federatedLearningPrep';
import { buildInvocationFromTranscript } from '@/services/voiceCommandAdapter';
import {
  buildBoardReport,
  renderBoardReportAsText,
} from '@/services/boardReportPipeline';
import {
  decideSelfAuditAction,
  buildGovernanceTaskPayload,
} from '@/services/aiGovernanceSelfAuditWatchdog';
import type { ComplianceCase } from '@/domain/cases';
import type { CustomerProfile } from '@/domain/customers';
import type { DispatchAuditEntry } from '@/services/dispatchAuditLog';
import type { GovernanceAudit } from '@/agents/aiGovernance/types';

// Env + localStorage stash
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of [
    'GOAML_PORTAL_API_KEY',
    'GOAML_PORTAL_BASE_URL',
    'BANKING_FREEZE_API_KEY',
    'BANKING_FREEZE_BASE_URL',
    'EOCN_FEED_URL',
  ]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
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
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function mkCase(overrides: Partial<ComplianceCase> = {}): ComplianceCase {
  return {
    id: 'case-d',
    entityId: 'ACME',
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: 18,
    riskLevel: 'critical',
    redFlags: ['RF1'],
    findings: ['sanctions proximity'],
    narrative: 'possible sanctions match',
    recommendation: 'freeze',
    auditLog: [],
    ...overrides,
  };
}

// ───── Tier D1: eocnDeltaWatcher ─────────────────────────────────────────

describe('eocnDeltaWatcher', () => {
  it('diffEocnLists detects added + removed entries', () => {
    const diff = diffEocnLists(
      [{ id: 'a', name: 'A', type: 'entity' }],
      [{ id: 'b', name: 'B', type: 'individual' }]
    );
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).toBe('b');
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].id).toBe('a');
  });

  it('reports unchanged count', () => {
    const diff = diffEocnLists(
      [
        { id: 'a', name: 'A', type: 'entity' },
        { id: 'b', name: 'B', type: 'entity' },
      ],
      [
        { id: 'a', name: 'A', type: 'entity' },
        { id: 'c', name: 'C', type: 'entity' },
      ]
    );
    expect(diff.unchanged).toBe(1);
  });

  it('watchEocnDelta uses injected fetcher', async () => {
    const result = await watchEocnDelta({
      fetcher: async () => [{ id: 'x', name: 'X', type: 'entity' }],
      snapshotSource: () => [],
      persist: false,
      nowIso: '2026-04-13T12:00:00.000Z',
    });
    expect(result.added).toHaveLength(1);
    expect(result.fetchedAtIso).toBe('2026-04-13T12:00:00.000Z');
  });

  it('persists snapshot when persist=true', async () => {
    await watchEocnDelta({
      fetcher: async () => [{ id: 'new', name: 'N', type: 'entity' }],
      snapshotSource: () => [],
      persist: true,
    });
    // The snapshot should be writable (no throw)
    saveSnapshot([{ id: 'y', name: 'Y', type: 'entity' }]);
  });
});

// ───── Tier D2: moeCircularIngestor ──────────────────────────────────────

describe('moeCircularIngestor', () => {
  it('detects sanctions-related policy impact', () => {
    const report = classifyCircular({
      id: 'moe-001',
      title: 'Updated sanctions screening requirements',
      publishedAtIso: '2026-04-13T12:00:00.000Z',
      body: 'All DPMS entities shall screen against OFAC immediately',
    });
    expect(report.impactedPolicies.some((p) => p.area === 'sanctions')).toBe(true);
  });

  it('derives critical severity from freeze/immediate keywords', () => {
    const report = classifyCircular({
      id: 'moe-002',
      title: 'Immediate asset freeze required',
      publishedAtIso: '2026-04-13T12:00:00.000Z',
      body: 'Freeze all assets without delay',
    });
    expect(report.severity).toBe('critical');
  });

  it('sets 30-day action deadline from published date', () => {
    const report = classifyCircular({
      id: 'moe-003',
      title: 'CDD policy update',
      publishedAtIso: '2026-04-01T00:00:00.000Z',
      body: 'Update CDD policy',
    });
    expect(report.actionDeadlineIso.startsWith('2026-05')).toBe(true);
  });

  it('detects multiple policy areas in one circular', () => {
    const report = classifyCircular({
      id: 'moe-004',
      title: 'Multi-area update',
      publishedAtIso: '2026-04-13T12:00:00.000Z',
      body: 'STR filing + CDD + training + retention must all be updated',
    });
    const areas = report.impactedPolicies.map((p) => p.area);
    expect(areas).toContain('str');
    expect(areas).toContain('cdd');
    expect(areas).toContain('training');
    expect(areas).toContain('record-retention');
  });
});

// ───── Tier D3: fiuAckAutoIngest ─────────────────────────────────────────

describe('fiuAckAutoIngest', () => {
  it('isFiuAckConfigured false without API key', () => {
    expect(isFiuAckConfigured()).toBe(false);
  });

  it('resolveFiuAckConfig reads from env', () => {
    process.env.GOAML_PORTAL_API_KEY = 'real-key';
    process.env.GOAML_PORTAL_BASE_URL = 'https://example.test/goaml';
    const cfg = resolveFiuAckConfig();
    expect(cfg.apiKey).toBe('real-key');
    expect(cfg.baseUrl).toBe('https://example.test/goaml');
  });

  it('pollFiuAcks returns unconfigured status without a key', async () => {
    const result = await pollFiuAcks(['STR-1']);
    expect(result.status).toBe('unconfigured');
  });

  it('pollFiuAcks returns stub status on placeholder key', async () => {
    process.env.GOAML_PORTAL_API_KEY = 'STUB';
    const result = await pollFiuAcks(['STR-1']);
    expect(result.status).toBe('stub');
  });

  it('planAckApplication resolves accepted events to subtask completions', () => {
    const plan = planAckApplication(
      [
        {
          strRef: 'STR-1',
          caseId: 'case-1',
          ackReference: 'ACK-1',
          acknowledgedAtIso: '2026-04-13T12:00:00.000Z',
          status: 'accepted',
        },
      ],
      (strRef) =>
        strRef === 'STR-1'
          ? { monitorAckSubtaskGid: 'sub-1', parentGid: 'parent-1' }
          : undefined
    );
    expect(plan.completeSubtaskGids).toContain('sub-1');
    expect(plan.escalateParentGids).toHaveLength(0);
  });

  it('planAckApplication escalates on rejected events', () => {
    const plan = planAckApplication(
      [
        {
          strRef: 'STR-2',
          caseId: 'case-2',
          ackReference: 'ACK-2',
          acknowledgedAtIso: '2026-04-13T12:00:00.000Z',
          status: 'rejected',
          rejectReason: 'schema error',
        },
      ],
      () => ({ monitorAckSubtaskGid: 'sub-2', parentGid: 'parent-2' })
    );
    expect(plan.escalateParentGids).toContain('parent-2');
  });
});

// ───── Tier D4: autoFreezeExecutor ───────────────────────────────────────

describe('autoFreezeExecutor', () => {
  it('buildFreezePlan sets 24h EOCN deadline + 5bd CNMR deadline', () => {
    const plan = buildFreezePlan(mkCase(), undefined, '2026-04-13T12:00:00.000Z');
    expect(plan.caseId).toBe('case-d');
    expect(plan.eocnDeadlineIso).toBe('2026-04-14T12:00:00.000Z');
    const cnmrMs = Date.parse(plan.cnmrDeadlineIso);
    const nowMs = Date.parse('2026-04-13T12:00:00.000Z');
    // 5 business days is at least 5 calendar days, at most 7 (if spanning a weekend)
    expect(cnmrMs - nowMs).toBeGreaterThanOrEqual(5 * 86_400_000);
    expect(cnmrMs - nowMs).toBeLessThanOrEqual(7 * 86_400_000);
  });

  it('executeAutoFreeze returns unconfigured without API key', async () => {
    const result = await executeAutoFreeze(mkCase(), undefined, {
      nowIso: '2026-04-13T12:00:00.000Z',
    });
    expect(result.status).toBe('unconfigured');
  });

  it('executeAutoFreeze returns plan-only on STUB key', async () => {
    process.env.BANKING_FREEZE_API_KEY = 'STUB';
    const result = await executeAutoFreeze(mkCase(), undefined, {
      nowIso: '2026-04-13T12:00:00.000Z',
    });
    expect(result.status).toBe('plan-only');
  });

  it('freeze plan citation includes Cabinet Res 74/2020', () => {
    const plan = buildFreezePlan(mkCase());
    expect(plan.regulatoryBasis).toContain('Cabinet Res 74/2020');
    expect(plan.regulatoryBasis).toContain('Art.29');
  });
});

// ───── Tier E1: federatedLearningPrep ────────────────────────────────────

describe('federatedLearningPrep', () => {
  it('anonymizeCaseId is deterministic', () => {
    expect(anonymizeCaseId('case-1')).toBe(anonymizeCaseId('case-1'));
  });

  it('anonymizeCaseId differs for different inputs', () => {
    expect(anonymizeCaseId('case-1')).not.toBe(anonymizeCaseId('case-2'));
  });

  it('maskErrorText redacts digits', () => {
    expect(maskErrorText('error code 429 at 12:00')).not.toMatch(/\d/);
  });

  it('maskErrorText truncates to 60 chars', () => {
    expect(maskErrorText('a'.repeat(200)).length).toBeLessThanOrEqual(60);
  });

  it('toFederatedSample strips raw identifiers', () => {
    const sample = toFederatedSample({
      id: 'audit-1',
      dispatchedAtIso: '2026-04-13T12:00:00.000Z',
      caseId: 'case-madison',
      verdict: 'flag',
      confidence: 0.8,
      suggestedColumn: 'doing',
      strSubtaskCount: 7,
      fourEyesCount: 0,
      annotatedCount: 0,
      errors: ['HTTP 429 at 12:00'],
      warnings: [],
      trigger: 'manual',
      dispatcherVersion: '1.0.0',
    });
    expect(sample.caseHash).not.toContain('madison');
    expect(sample.errorFingerprint).not.toMatch(/\d/);
  });

  it('auditFederatedSample reports violations on tampered samples', () => {
    const violations = auditFederatedSample({
      caseHash: 'case_MADISON_LLC',
      verdict: 'flag',
      confidence: 0.8,
      dayBucket: '2026-04-13',
      strSubtaskCount: 0,
      fourEyesCount: 0,
      errorCount: 0,
      trigger: 'manual',
    });
    expect(violations.length).toBeGreaterThan(0);
  });
});

// ───── Tier E2: voiceCommandAdapter ──────────────────────────────────────

describe('voiceCommandAdapter', () => {
  it('returns unknown on empty transcript', () => {
    expect(buildInvocationFromTranscript('').intent).toBe('unknown');
  });

  it('matches the screen intent and extracts target', () => {
    const cmd = buildInvocationFromTranscript('screen ACME for sanctions');
    expect(cmd.intent).toBe('screen');
    expect(cmd.slashCommand).toContain('acme');
  });

  it('matches the incident intent on freeze keywords', () => {
    const cmd = buildInvocationFromTranscript('freeze the Madison account emergency');
    expect(cmd.intent).toBe('incident');
    expect(cmd.slashCommand).toContain('/incident');
  });

  it('matches deploy-check on ship keyword', () => {
    const cmd = buildInvocationFromTranscript('can we ship the release');
    expect(cmd.intent).toBe('deploy-check');
    expect(cmd.slashCommand).toBe('/deploy-check');
  });

  it('falls back to help for unknown transcripts', () => {
    const cmd = buildInvocationFromTranscript('the weather today');
    expect(cmd.intent).toBe('unknown');
  });
});

// ───── Tier E3: boardReportPipeline ──────────────────────────────────────

describe('boardReportPipeline', () => {
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

  it('buildBoardReport aggregates dispatch activity', () => {
    const report = buildBoardReport({
      period: 'quarterly',
      periodStartIso: '2026-04-01T00:00:00.000Z',
      periodEndIso: '2026-04-30T23:59:59.999Z',
      auditEntries: [
        mkEntry({ caseId: 'c1' }),
        mkEntry({ caseId: 'c2', verdict: 'freeze' }),
      ],
    });
    expect(report.metrics.totalDispatches).toBe(2);
    expect(report.sections.length).toBeGreaterThanOrEqual(4);
  });

  it('renderBoardReportAsText produces a non-empty string', () => {
    const report = buildBoardReport({
      period: 'monthly',
      periodStartIso: '2026-04-01T00:00:00.000Z',
      periodEndIso: '2026-04-30T23:59:59.999Z',
      auditEntries: [],
    });
    const text = renderBoardReportAsText(report);
    expect(text).toContain('EXECUTIVE SUMMARY');
  });

  it('error rate is 0 for an empty audit log', () => {
    const report = buildBoardReport({
      period: 'monthly',
      periodStartIso: '2026-04-01T00:00:00.000Z',
      periodEndIso: '2026-04-30T23:59:59.999Z',
      auditEntries: [],
    });
    expect(report.metrics.errorRatePct).toBe(0);
  });
});

// ───── Tier E4: aiGovernanceSelfAuditWatchdog ────────────────────────────

describe('aiGovernanceSelfAuditWatchdog', () => {
  function mkAudit(overrides: Partial<GovernanceAudit> = {}): GovernanceAudit {
    return {
      auditTarget: 'compliance-analyzer',
      auditedAt: '2026-04-13T12:00:00.000Z',
      auditedBy: 'cron',
      frameworks: [],
      euAiActTier: 'high',
      overallScore: 92,
      remediation: [],
      narrative: 'test audit',
      ...overrides,
    };
  }

  it('ok tier when score is above watch floor', () => {
    const decision = decideSelfAuditAction({
      audit: mkAudit({ overallScore: 95 }),
    });
    expect(decision.severity).toBe('ok');
    expect(decision.shouldOpenTask).toBe(false);
  });

  it('watch tier just below watch floor', () => {
    const decision = decideSelfAuditAction({
      audit: mkAudit({ overallScore: 88 }),
    });
    expect(decision.severity).toBe('watch');
  });

  it('warn tier below warn floor', () => {
    const decision = decideSelfAuditAction({
      audit: mkAudit({ overallScore: 82 }),
    });
    expect(decision.severity).toBe('warn');
    expect(decision.shouldOpenTask).toBe(true);
  });

  it('critical tier below floor', () => {
    const decision = decideSelfAuditAction({
      audit: mkAudit({ overallScore: 70 }),
    });
    expect(decision.severity).toBe('critical');
    expect(decision.shouldOpenTask).toBe(true);
  });

  it('critical tier when any framework has critical failure', () => {
    const decision = decideSelfAuditAction({
      audit: mkAudit({
        overallScore: 95,
        frameworks: [
          {
            framework: 'eu_ai_act',
            frameworkName: 'EU AI Act',
            assessments: [],
            summary: { pass: 0, partial: 0, fail: 0, unknown: 0, not_applicable: 0 },
            score: 70,
            hasCriticalFailure: true,
            narrative: '',
          },
        ],
      }),
    });
    expect(decision.severity).toBe('critical');
  });

  it('buildGovernanceTaskPayload emits a payload with ai-governance tag', () => {
    const decision = decideSelfAuditAction({
      audit: mkAudit({ overallScore: 70 }),
    });
    const payload = buildGovernanceTaskPayload({
      decision,
      audit: mkAudit({ overallScore: 70 }),
      projectGid: 'proj-gov',
    });
    expect(payload.tags).toContain('ai-governance');
    expect(payload.name).toContain('70');
  });
});
