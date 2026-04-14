/**
 * Auto-remediation executor tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildRemediationPlan,
  AutoRemediationExecutor,
  __test__,
  type ActionSink,
  type RemediationAction,
  type RemediationPlan,
} from '../src/services/autoRemediationExecutor';

const { DEFAULT_MAX } = __test__;

// ---------------------------------------------------------------------------
// Fake sink
// ---------------------------------------------------------------------------

class FakeSink implements ActionSink {
  calls: RemediationAction[] = [];
  okByDefault = true;
  throwNext = false;
  failKinds = new Set<string>();

  async execute(action: RemediationAction): Promise<{ ok: boolean; message: string }> {
    this.calls.push(action);
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error('sink-boom');
    }
    if (this.failKinds.has(action.kind)) {
      return { ok: false, message: `kind ${action.kind} fail-injected` };
    }
    return { ok: this.okByDefault, message: 'ok' };
  }
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

describe('buildRemediationPlan', () => {
  const ctx = { tenantId: 'tA', entityRef: 'ent-1' };

  it('pass verdict yields zero actions', () => {
    const plan = buildRemediationPlan('pass', ctx);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toMatch(/No remediation actions required/);
  });

  it('flag verdict yields at least mlro review + risk band raise', () => {
    const plan = buildRemediationPlan('flag', ctx);
    expect(plan.actions.some((a) => a.kind === 'create_mlro_review_task')).toBe(true);
    expect(plan.actions.some((a) => a.kind === 'raise_risk_band')).toBe(true);
  });

  it('flag with UBO re-verification flag adds the UBO action', () => {
    const plan = buildRemediationPlan('flag', {
      ...ctx,
      uboReverificationRequired: true,
    });
    const ubo = plan.actions.find((a) => a.kind === 'request_ubo_reverification');
    expect(ubo).toBeDefined();
    expect(ubo!.deadlineBusinessDays).toBe(15);
  });

  it('escalate verdict requires two-person approval on mlro review task', () => {
    const plan = buildRemediationPlan('escalate', ctx);
    const mlro = plan.actions.find((a) => a.kind === 'create_mlro_review_task');
    expect(mlro?.requiresTwoPersonApproval).toBe(true);
  });

  it('escalate verdict flags enhanced CDD request as tipping-off risk', () => {
    const plan = buildRemediationPlan('escalate', ctx);
    const cdd = plan.actions.find((a) => a.kind === 'request_enhanced_cdd');
    expect(cdd?.tippingOffRisk).toBe(true);
  });

  it('freeze verdict produces the full 24h + CNMR chain', () => {
    const plan = buildRemediationPlan('freeze', ctx);
    const kinds = plan.actions.map((a) => a.kind);
    expect(kinds).toContain('freeze_account');
    expect(kinds).toContain('pause_transactions');
    expect(kinds).toContain('start_freeze_countdown');
    expect(kinds).toContain('notify_eocn');
    expect(kinds).toContain('queue_cnmr_filing');
    const freeze = plan.actions.find((a) => a.kind === 'freeze_account');
    expect(freeze?.deadlineClockHours).toBe(24);
    expect(freeze?.requiresTwoPersonApproval).toBe(true);
    expect(freeze?.reversible).toBe(false);
    const cnmr = plan.actions.find((a) => a.kind === 'queue_cnmr_filing');
    expect(cnmr?.deadlineBusinessDays).toBe(5);
  });

  it('regulatory citations include 74/2020 + 134/2025', () => {
    const plan = buildRemediationPlan('freeze', ctx);
    expect(plan.regulatory).toContain('Cabinet Res 74/2020 Art.4-7');
    expect(plan.regulatory).toContain('Cabinet Res 134/2025 Art.12-14');
  });

  it('deterministic — same verdict + ctx produces same plan', () => {
    const a = buildRemediationPlan('escalate', ctx);
    const b = buildRemediationPlan('escalate', ctx);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Executor — dry-run path
// ---------------------------------------------------------------------------

describe('AutoRemediationExecutor dry-run', () => {
  const plan = buildRemediationPlan('escalate', {
    tenantId: 'tA',
    entityRef: 'ent-1',
  });

  it('dry-run is the default — no sink calls', async () => {
    const sink = new FakeSink();
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(plan);
    expect(rep.dryRun).toBe(true);
    expect(sink.calls).toHaveLength(0);
    expect(rep.executedCount).toBe(0);
    for (const r of rep.results) {
      expect(r.status).toBe('dry_run_skipped');
    }
  });

  it('dry-run still records every action result', async () => {
    const sink = new FakeSink();
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(plan);
    expect(rep.totalActions).toBe(plan.actions.length);
    expect(rep.results).toHaveLength(plan.actions.length);
  });
});

// ---------------------------------------------------------------------------
// Executor — live path gates
// ---------------------------------------------------------------------------

describe('AutoRemediationExecutor live gates', () => {
  const freezePlan: RemediationPlan = buildRemediationPlan('freeze', {
    tenantId: 'tA',
    entityRef: 'ent-1',
  });

  it('rejects every action when authorisedExecutorId missing in live mode', async () => {
    const sink = new FakeSink();
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(freezePlan, { dryRun: false });
    expect(rep.executedCount).toBe(0);
    expect(rep.rejectedCount).toBeGreaterThan(0);
    for (const r of rep.results) {
      expect(r.status).toBe('rejected_unauthorised');
    }
    expect(sink.calls).toHaveLength(0);
  });

  it('rejects two-person actions when only one approver present', async () => {
    const sink = new FakeSink();
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(freezePlan, {
      dryRun: false,
      authorisedExecutorId: 'mlro-1',
      twoPersonApprovalIds: ['mlro-1'],
    });
    const rejections = rep.results.filter((r) => r.status === 'rejected_missing_approval');
    expect(rejections.length).toBeGreaterThan(0);
  });

  it('executes two-person actions when both approvers present', async () => {
    const sink = new FakeSink();
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(freezePlan, {
      dryRun: false,
      authorisedExecutorId: 'mlro-1',
      twoPersonApprovalIds: ['mlro-1', 'mlro-2'],
    });
    expect(rep.executedCount).toBeGreaterThan(0);
    expect(sink.calls.some((c) => c.kind === 'freeze_account')).toBe(true);
  });

  it('respects allowedActionKinds allowlist', async () => {
    const sink = new FakeSink();
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(freezePlan, {
      dryRun: false,
      authorisedExecutorId: 'mlro-1',
      twoPersonApprovalIds: ['mlro-1', 'mlro-2'],
      allowedActionKinds: ['create_mlro_review_task'],
    });
    // Only one action kind permitted.
    expect(sink.calls.every((c) => c.kind === 'create_mlro_review_task')).toBe(true);
    const notAllowed = rep.results.filter((r) => r.status === 'rejected_not_allowed');
    expect(notAllowed.length).toBeGreaterThan(0);
  });

  it('circuit breaker caps execution at maxActionsPerRun', async () => {
    const sink = new FakeSink();
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(freezePlan, {
      dryRun: false,
      authorisedExecutorId: 'mlro-1',
      twoPersonApprovalIds: ['mlro-1', 'mlro-2'],
      maxActionsPerRun: 2,
    });
    expect(sink.calls.length).toBeLessThanOrEqual(2);
    const breaker = rep.results.filter((r) => r.status === 'rejected_circuit_breaker');
    expect(breaker.length).toBeGreaterThan(0);
  });

  it('records execution_failed when sink returns ok:false', async () => {
    const sink = new FakeSink();
    sink.failKinds.add('freeze_account');
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(freezePlan, {
      dryRun: false,
      authorisedExecutorId: 'mlro-1',
      twoPersonApprovalIds: ['mlro-1', 'mlro-2'],
    });
    const failed = rep.results.filter((r) => r.status === 'execution_failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(rep.failedCount).toBeGreaterThan(0);
  });

  it('records execution_failed on sink throw', async () => {
    const sink = new FakeSink();
    sink.throwNext = true;
    const escalate = buildRemediationPlan('escalate', {
      tenantId: 'tA',
      entityRef: 'ent-1',
    });
    const exec = new AutoRemediationExecutor(sink);
    const rep = await exec.execute(escalate, {
      dryRun: false,
      authorisedExecutorId: 'mlro-1',
      twoPersonApprovalIds: ['mlro-1', 'mlro-2'],
    });
    const failed = rep.results.filter((r) => r.status === 'execution_failed');
    expect(failed.length).toBeGreaterThan(0);
  });

  it('DEFAULT_MAX is 20', () => {
    expect(DEFAULT_MAX).toBe(20);
  });
});
