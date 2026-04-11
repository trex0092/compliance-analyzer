/**
 * Tests for Asana Phase 3 — clusters M/N/O/P/Q combined.
 */
import { describe, it, expect } from 'vitest';

import {
  STR_PIPELINE_DEPENDENCIES,
  validateNoCycles,
  buildCustomerCaseFolderTemplate,
  COMPLIANCE_WORKFLOW_RULES,
  sweepInbox,
  pickNextAssignee,
  buildMigrationPlan,
} from '@/services/asanaWorkflowAutomation';
import {
  buildSlaBreachSlackAlert,
  buildIcalEvent,
  buildApprovalEnvelope,
  reconcileWebhookGaps,
  parseEmailIntoTask,
} from '@/services/asanaExternalIntegrations';
import {
  TenantTokenRegistry,
  assertTenantOwnsTask,
  TenantIsolationError,
  TenantRateLimiter,
} from '@/services/asanaMultiTenancy';
import {
  rollupTimeByAnalyst,
  buildCapacityHeatmap,
  rollupFilingFunnel,
  pickColdStorageEligible,
} from '@/services/asanaOperational';
import {
  createSignatureScanner,
  assertScanClean,
  redactPii,
  isMimeAllowed,
  assertMimeAllowed,
  checkLinkIntegrity,
} from '@/services/asanaAttachmentSecurity';

// ---------------------------------------------------------------------------
// Cluster M
// ---------------------------------------------------------------------------

describe('Cluster M — workflow automation', () => {
  it('STR pipeline DAG has no cycles', () => {
    expect(validateNoCycles(STR_PIPELINE_DEPENDENCIES)).toBe(true);
  });

  it('customer case folder template has expected sections', () => {
    const t = buildCustomerCaseFolderTemplate('Acme Gold LLC');
    expect(t.sections).toContain('MLRO decision');
    expect(t.sections).toContain('Filed');
  });

  it('workflow rules have regulatory citations', () => {
    expect(COMPLIANCE_WORKFLOW_RULES.length).toBeGreaterThan(0);
    for (const rule of COMPLIANCE_WORKFLOW_RULES) {
      expect(rule.citation.length).toBeGreaterThan(0);
    }
  });

  it('inbox sweeper archives read + completed + old notifications', () => {
    const { archive, keep } = sweepInbox([
      { id: 'n1', taskGid: 't1', read: true, taskCompleted: true, ageHours: 48 },
      { id: 'n2', taskGid: 't2', read: false, taskCompleted: true, ageHours: 48 },
      { id: 'n3', taskGid: 't3', read: true, taskCompleted: false, ageHours: 48 },
      { id: 'n4', taskGid: 't4', read: true, taskCompleted: true, ageHours: 2 },
    ]);
    expect(archive).toEqual(['n1']);
    expect(keep.length).toBe(3);
  });

  it('auto-assign picks analyst with lowest load ratio', () => {
    const pick = pickNextAssignee([
      { analystGid: 'A', name: 'Alice', openTasks: 5, dailyCapacity: 10 },
      { analystGid: 'B', name: 'Bob', openTasks: 2, dailyCapacity: 10 },
      { analystGid: 'C', name: 'Carol', openTasks: 8, dailyCapacity: 10 },
    ]);
    expect(pick?.name).toBe('Bob');
  });

  it('auto-assign returns null when everyone is over capacity', () => {
    const pick = pickNextAssignee([
      { analystGid: 'A', name: 'Alice', openTasks: 10, dailyCapacity: 10 },
    ]);
    expect(pick).toBeNull();
  });

  it('migration plan preserves every task', () => {
    const plan = buildMigrationPlan({
      taskGids: ['t1', 't2', 't3'],
      fromProject: 'P1',
      toProject: 'P2',
    });
    expect(plan.totalTasks).toBe(3);
    expect(plan.citation).toContain('FDL No.10/2025 Art.24');
  });
});

// ---------------------------------------------------------------------------
// Cluster N
// ---------------------------------------------------------------------------

describe('Cluster N — external integrations', () => {
  it('Slack alert has breach urgency for breached SLA', () => {
    const alert = buildSlaBreachSlackAlert({
      customerName: 'Acme',
      deadlineType: 'STR',
      daysRemaining: -2,
      taskGid: '12345',
    });
    expect(alert.text).toContain('BREACHED');
  });

  it('iCal event contains SUMMARY and DTSTART', () => {
    const ical = buildIcalEvent({
      uid: 'abc',
      summary: 'Review STR',
      description: 'Four-eyes pending',
      startIso: '2026-04-15T09:00:00Z',
      endIso: '2026-04-15T10:00:00Z',
    });
    expect(ical).toContain('SUMMARY:Review STR');
    expect(ical).toContain('DTSTART:');
    expect(ical).toContain('END:VEVENT');
  });

  it('DocuSign envelope routes primary → independent', () => {
    const env = buildApprovalEnvelope({
      caseId: 'C1',
      caseType: 'STR approval',
      approvers: [
        { email: 'alice@x.com', name: 'Alice' },
        { email: 'bob@x.com', name: 'Bob' },
      ],
      documentBase64: 'YWJj',
    });
    expect(env.recipients.length).toBe(2);
    expect(env.recipients[0].routingOrder).toBe(1);
    expect(env.recipients[1].routingOrder).toBe(2);
  });

  it('webhook reconciler detects completion missed', () => {
    const missed = reconcileWebhookGaps(
      [{ taskGid: 't1', lastKnownStatus: 'open', lastSeenAt: '2026-04-01T00:00:00Z' }],
      [{ taskGid: 't1', remoteStatus: 'completed', remoteUpdatedAt: '2026-04-02T00:00:00Z' }]
    );
    expect(missed.length).toBe(1);
    expect(missed[0].kind).toBe('completion_missed');
  });

  it('email-to-task builds sane payload', () => {
    const payload = parseEmailIntoTask({
      from: 'regulator@moe.gov.ae',
      subject: 'Circular 08/AML/2021 update',
      body: 'Please review the attached update.',
      attachments: ['update.pdf'],
    });
    expect(payload.name).toContain('[EMAIL]');
    expect(payload.notes).toContain('regulator@moe.gov.ae');
    expect(payload.attachments).toContain('update.pdf');
  });
});

// ---------------------------------------------------------------------------
// Cluster O
// ---------------------------------------------------------------------------

describe('Cluster O — multi-tenancy', () => {
  it('registry stores + retrieves tenant credentials', () => {
    const reg = new TenantTokenRegistry();
    reg.register({
      tenantId: 'acme',
      asanaToken: 'token',
      asanaWorkspaceGid: 'ws1',
      allowedProjectGids: ['p1', 'p2'],
    });
    expect(reg.has('acme')).toBe(true);
    expect(reg.listTenants()).toContain('acme');
  });

  it('isolation guard allows access to allowed project', () => {
    const reg = new TenantTokenRegistry();
    reg.register({
      tenantId: 'acme',
      asanaToken: 'token',
      asanaWorkspaceGid: 'ws1',
      allowedProjectGids: ['p1'],
    });
    expect(() => assertTenantOwnsTask(reg, 'acme', 'p1')).not.toThrow();
  });

  it('isolation guard blocks cross-tenant access', () => {
    const reg = new TenantTokenRegistry();
    reg.register({
      tenantId: 'acme',
      asanaToken: 'token',
      asanaWorkspaceGid: 'ws1',
      allowedProjectGids: ['p1'],
    });
    expect(() => assertTenantOwnsTask(reg, 'acme', 'p2')).toThrow(TenantIsolationError);
  });

  it('isolation guard blocks unknown tenant', () => {
    const reg = new TenantTokenRegistry();
    expect(() => assertTenantOwnsTask(reg, 'ghost', 'p1')).toThrow(/Unknown tenant/);
  });

  it('rate limiter returns 0 wait for a fresh tenant', () => {
    const rl = new TenantRateLimiter({ defaultDelayMs: 250 });
    expect(rl.waitMsFor('acme', 1_000_000_000)).toBe(0);
  });

  it('rate limiter grows on 429 and decays on success', () => {
    const rl = new TenantRateLimiter({ defaultDelayMs: 250 });
    rl.onRateLimit('acme', 4000, 1_000_000_000);
    expect(rl.state('acme')!.currentDelayMs).toBeGreaterThanOrEqual(4000);
    rl.onSuccess('acme', 1_000_010_000);
    expect(rl.state('acme')!.currentDelayMs).toBeLessThan(4000);
  });
});

// ---------------------------------------------------------------------------
// Cluster P
// ---------------------------------------------------------------------------

describe('Cluster P — operational', () => {
  it('rollupTimeByAnalyst sums hours', () => {
    const rows = rollupTimeByAnalyst([
      { analystGid: 'A', taskGid: 't1', hours: 2, loggedAt: '2026-04-01T09:00:00Z', category: 'review' },
      { analystGid: 'A', taskGid: 't2', hours: 3, loggedAt: '2026-04-01T13:00:00Z', category: 'filing' },
      { analystGid: 'B', taskGid: 't3', hours: 1, loggedAt: '2026-04-01T10:00:00Z', category: 'screening' },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0].analystGid).toBe('A');
    expect(rows[0].totalHours).toBe(5);
  });

  it('capacity heatmap flags overflow weeks', () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      analystGid: 'A',
      taskGid: `t${i}`,
      hours: 5,
      loggedAt: '2026-04-13T09:00:00Z',
      category: 'review' as const,
    }));
    const heat = buildCapacityHeatmap(entries, 40);
    const overflow = heat.find((c) => c.overflow);
    expect(overflow).toBeDefined();
  });

  it('filing funnel rolls up by quarter + type', () => {
    const funnel = rollupFilingFunnel([
      { filingType: 'STR', status: 'drafted', filedAt: '2026-01-15T00:00:00Z' },
      { filingType: 'STR', status: 'submitted', filedAt: '2026-02-15T00:00:00Z' },
      { filingType: 'STR', status: 'accepted', filedAt: '2026-03-15T00:00:00Z' },
    ]);
    expect(funnel.length).toBe(1);
    expect(funnel[0].drafted).toBe(1);
    expect(funnel[0].submitted).toBe(1);
    expect(funnel[0].accepted).toBe(1);
  });

  it('cold storage picks tasks completed > 5 years ago', () => {
    const gids = pickColdStorageEligible(
      [
        { taskGid: 'old', completedAt: '2018-01-01T00:00:00Z' },
        { taskGid: 'recent', completedAt: '2025-01-01T00:00:00Z' },
      ],
      new Date('2026-04-11T00:00:00Z'),
      5
    );
    expect(gids).toEqual(['old']);
  });
});

// ---------------------------------------------------------------------------
// Cluster Q
// ---------------------------------------------------------------------------

describe('Cluster Q — attachment security', () => {
  it('EICAR-like signature triggers infected verdict', async () => {
    const scanner = createSignatureScanner(['MAL-SIG-XYZ']);
    const result = await scanner('something MAL-SIG-XYZ more text');
    expect(result.verdict).toBe('infected');
  });

  it('clean content passes', async () => {
    const scanner = createSignatureScanner(['MAL-SIG-XYZ']);
    const result = await scanner('normal clean content');
    expect(result.verdict).toBe('clean');
  });

  it('assertScanClean throws on infected', async () => {
    const scanner = createSignatureScanner(['MAL-SIG-XYZ']);
    await expect(assertScanClean('MAL-SIG-XYZ here', scanner)).rejects.toThrow(/infected/);
  });

  it('PII redactor redacts emirates ID + passport + IBAN', () => {
    const { redacted, counts } = redactPii(
      'Passport A12345678, Emirates ID 784-1990-1234567-1, IBAN AE070331234567890123456, ' +
        'email alice@acme.com, phone +971501234567'
    );
    expect(redacted).not.toContain('A12345678');
    expect(redacted).toContain('[REDACTED-PASSPORT]');
    expect(redacted).toContain('[REDACTED-EID]');
    expect(redacted).toContain('[REDACTED-IBAN]');
    expect(redacted).toContain('[REDACTED-EMAIL]');
    expect(counts.passport).toBeGreaterThanOrEqual(1);
  });

  it('MIME allowlist accepts PDF and rejects executables', () => {
    expect(isMimeAllowed('application/pdf')).toBe(true);
    expect(isMimeAllowed('application/x-msdownload')).toBe(false);
    expect(() => assertMimeAllowed('application/x-executable')).toThrow();
  });

  it('link integrity checker reports missing links', async () => {
    const report = await checkLinkIntegrity(['t1', 't2', 't3'], async (gid) => gid !== 't2');
    expect(report.ok).toBe(2);
    expect(report.missing).toContain('t2');
  });
});
