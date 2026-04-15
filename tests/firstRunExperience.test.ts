/**
 * First-Run Experience tests — batch A of the completeness roadmap.
 *
 * Covers:
 *   - buildDemoDataset deterministic + bounded
 *   - Demo blob keys all under `demo:` prefix
 *   - demoMode toggle validation + banner + prefix switch
 *   - Empty-state catalogue: every panel has copy
 *   - envConfigValidator health report on good + bad snapshots
 *   - brainHealthCheck aggregation: all-ok and degraded paths
 *   - onboarding wizard state machine: happy path + validation + back
 */
import { describe, it, expect } from 'vitest';

import {
  buildDemoDataset,
  demoBlobKeys,
  DEMO_DATASET_ID,
  DEMO_TENANT_ID,
} from '../src/services/sampleDataLoader';

import {
  InMemoryDemoStateStore,
  enableDemoMode,
  disableDemoMode,
  shouldShowBanner,
  blobPrefixFor,
  initialSnapshot,
  resetDemoData,
} from '../src/services/demoMode';

import {
  getEmptyState,
  listEmptyStates,
  PANEL_IDS,
} from '../src/services/emptyStates';

import {
  validateEnv,
  listEnvSpecs,
  __test__ as envInternals,
} from '../src/services/envConfigValidator';

import {
  runHealthCheck,
  type HealthProbes,
  type DependencyStatus,
} from '../src/services/brainHealthCheck';

import {
  initialWizardState,
  reduceWizard,
  isWizardComplete,
  type TenantSetupPayload,
} from '../src/services/onboardingWizard';

// ===========================================================================
// sampleDataLoader
// ===========================================================================

describe('buildDemoDataset', () => {
  it('is deterministic', () => {
    const a = buildDemoDataset();
    const b = buildDemoDataset();
    expect(a).toEqual(b);
  });

  it('contains exactly 18 cases (9 personas × 2 each)', () => {
    const ds = buildDemoDataset();
    expect(ds.cases.length).toBe(18);
  });

  it('every record is marked synthetic:true + uses the demo tenant', () => {
    const ds = buildDemoDataset();
    expect(ds.synthetic).toBe(true);
    expect(ds.tenantId).toBe(DEMO_TENANT_ID);
    for (const c of ds.cases) expect(c.synthetic).toBe(true);
    for (const t of ds.asanaTasks) expect(t.synthetic).toBe(true);
    for (const c of ds.clampSuggestions) expect(c.synthetic).toBe(true);
    for (const o of ds.outboundQueue) expect(o.synthetic).toBe(true);
    for (const b of ds.breakGlassRequests) expect(b.synthetic).toBe(true);
  });

  it('telemetry spans the cases', () => {
    const ds = buildDemoDataset();
    expect(ds.telemetry.length).toBe(ds.cases.length);
    for (const t of ds.telemetry) {
      expect(t.tenantId).toBe(DEMO_TENANT_ID);
    }
  });

  it('asana tasks only cover non-pass verdicts', () => {
    const ds = buildDemoDataset();
    for (const t of ds.asanaTasks) {
      expect(['flag', 'escalate', 'freeze']).toContain(t.verdict);
    }
  });

  it('clamp suggestions are within the +15% regulatory envelope', () => {
    const ds = buildDemoDataset();
    for (const s of ds.clampSuggestions) {
      const ratio = s.proposedValue / s.currentValue;
      expect(ratio).toBeLessThanOrEqual(1.15);
      expect(ratio).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('demoBlobKeys', () => {
  it('all keys are under the demo: prefix', () => {
    for (const key of demoBlobKeys()) {
      expect(key.startsWith('demo:')).toBe(true);
    }
  });

  it('includes every category', () => {
    const keys = demoBlobKeys();
    expect(keys.length).toBe(7);
  });

  it('dataset id matches sampleDataLoader constant', () => {
    expect(DEMO_DATASET_ID).toBe('demo:v1');
  });
});

// ===========================================================================
// demoMode
// ===========================================================================

describe('demoMode', () => {
  it('defaults to live mode', () => {
    expect(initialSnapshot().state).toBe('live');
    expect(shouldShowBanner(initialSnapshot())).toBe(false);
    expect(blobPrefixFor(initialSnapshot())).toBe('brain:');
  });

  it('enable flips state and banner', async () => {
    const store = new InMemoryDemoStateStore();
    const snap = await enableDemoMode(store, {
      userId: 'u1',
      reason: 'drill',
      now: () => new Date('2026-04-15T10:00:00Z'),
    });
    expect(snap.state).toBe('demo');
    expect(shouldShowBanner(snap)).toBe(true);
    expect(blobPrefixFor(snap)).toBe('demo:');
    expect(store.auditLog().some((a) => a.event === 'demo_mode_on')).toBe(true);
  });

  it('disable flips back', async () => {
    const store = new InMemoryDemoStateStore();
    await enableDemoMode(store, { userId: 'u1', reason: 'drill' });
    const off = await disableDemoMode(store, { userId: 'u1', reason: 'done' });
    expect(off.state).toBe('live');
    expect(store.auditLog().some((a) => a.event === 'demo_mode_off')).toBe(true);
  });

  it('rejects missing reason', async () => {
    const store = new InMemoryDemoStateStore();
    await expect(
      enableDemoMode(store, { userId: 'u1', reason: '' })
    ).rejects.toThrow();
  });

  it('rejects missing userId', async () => {
    const store = new InMemoryDemoStateStore();
    await expect(
      enableDemoMode(store, { userId: '', reason: 'drill' })
    ).rejects.toThrow();
  });

  it('resetDemoData emits audit record', async () => {
    const store = new InMemoryDemoStateStore();
    await resetDemoData(store, { userId: 'u1', reason: 'clear old drill' });
    expect(store.auditLog().some((a) => a.event === 'demo_data_reset')).toBe(true);
  });
});

// ===========================================================================
// emptyStates
// ===========================================================================

describe('emptyStates catalogue', () => {
  it('every panel in PANEL_IDS has full copy', () => {
    for (const p of PANEL_IDS) {
      const copy = getEmptyState(p);
      expect(copy).toBeDefined();
      expect(copy.heading.length).toBeGreaterThan(0);
      expect(copy.heading.length).toBeLessThanOrEqual(40);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeLessThanOrEqual(200);
      expect(copy.ctaLabel.length).toBeGreaterThan(0);
      expect(copy.ctaAction.length).toBeGreaterThan(0);
      expect(copy.regulatory.length).toBeGreaterThan(0);
    }
  });

  it('listEmptyStates returns every panel', () => {
    const list = listEmptyStates();
    expect(list.length).toBe(PANEL_IDS.length);
  });

  it('includes every critical panel', () => {
    expect(PANEL_IDS).toContain('telemetry');
    expect(PANEL_IDS).toContain('evidence_bundle');
    expect(PANEL_IDS).toContain('dead_letter');
    expect(PANEL_IDS).toContain('drift_monitor');
    expect(PANEL_IDS).toContain('audit_log');
    expect(PANEL_IDS).toContain('tenant_cohort');
  });
});

// ===========================================================================
// envConfigValidator
// ===========================================================================

describe('envConfigValidator', () => {
  const goodEnv = {
    HAWKEYE_BRAIN_TOKEN: 'hk-brain-aaaaaaaaaaaaaaaaaaaaaaaaa', // ≥24 chars
    HAWKEYE_ALLOWED_ORIGIN: 'https://hawkeye-sterling-v2.netlify.app',
    HAWKEYE_CROSS_TENANT_SALT: 'v2026Q2-salt-abcdefghij',
    ANTHROPIC_API_KEY: 'sk-ant-api03-XXXXXXXXXXXXXXXXX',
    ASANA_ACCESS_TOKEN: '1/0123456789012345:AAAAAAAAAAAAAAAAAA',
    ASANA_WORKSPACE_GID: '1234567890123456',
    JWT_SIGNING_SECRET: 'jwt-signing-secret-32-chars-long!!',
    BCRYPT_PEPPER: 'pepper-16-chars!!',
  };

  it('ok status with a clean snapshot', () => {
    const r = validateEnv(goodEnv);
    expect(r.health).toBe('ok');
    expect(r.missingRequired).toEqual([]);
    expect(r.invalidVars).toEqual([]);
  });

  it('broken status when a required var is missing', () => {
    const r = validateEnv({ ...goodEnv, HAWKEYE_BRAIN_TOKEN: undefined });
    expect(r.health).toBe('broken');
    expect(r.missingRequired).toContain('HAWKEYE_BRAIN_TOKEN');
  });

  it('broken status when a required var is invalid', () => {
    const r = validateEnv({ ...goodEnv, ANTHROPIC_API_KEY: 'not-a-key' });
    expect(r.health).toBe('broken');
    expect(r.invalidVars).toContain('ANTHROPIC_API_KEY');
  });

  it('degraded status when only an optional var is invalid', () => {
    const r = validateEnv({ ...goodEnv, BRAIN_RATE_LIMIT_PER_15MIN: '-5' });
    expect(r.health).toBe('degraded');
    expect(r.invalidVars).toContain('BRAIN_RATE_LIMIT_PER_15MIN');
  });

  it('masks secrets in the preview', () => {
    const r = validateEnv(goodEnv);
    const token = r.statuses.find((s) => s.name === 'HAWKEYE_BRAIN_TOKEN')!;
    expect(token.state).toBe('ok');
    // Should NOT include the full value.
    expect(token.valuePreview).not.toContain('aaaaaaaa');
  });

  it('listEnvSpecs returns all specs', () => {
    expect(listEnvSpecs().length).toBeGreaterThan(10);
  });

  it('preview helper never leaks long secrets', () => {
    expect(envInternals.previewValue('HAWKEYE_BRAIN_TOKEN', 'hk-brain-xxxxxxxxxxxxxxxxxxxxxxxxx')).not.toContain('xxxxxxxx');
  });
});

// ===========================================================================
// brainHealthCheck
// ===========================================================================

describe('runHealthCheck', () => {
  const goodDep = (name: string): DependencyStatus => ({
    name,
    state: 'ok',
    latencyMs: 42,
    detail: 'up',
    regulatory: 'FDL Art.20',
  });

  const brokenDep = (name: string): DependencyStatus => ({
    name,
    state: 'broken',
    latencyMs: null,
    detail: 'connection refused',
    regulatory: 'FDL Art.20',
  });

  function makeProbes(overrides: Partial<HealthProbes> = {}): HealthProbes {
    return {
      env: () => ({
        schemaVersion: 1,
        health: 'ok',
        totalVars: 16,
        requiredCount: 9,
        optionalCount: 7,
        missingRequired: [],
        invalidVars: [],
        statuses: [],
        summary: 'All 16 env vars validated.',
        regulatory: [],
      }),
      blobStore: async () => goodDep('Netlify Blobs'),
      asana: async () => goodDep('Asana API'),
      advisorProxy: async () => goodDep('Advisor Proxy'),
      crons: async () => [
        { id: 'brain-clamp-cron', schedule: '0 * * * *', lastRunIso: '2026-04-15T11:00:00Z', lastResult: 'ok', lastError: null },
      ],
      tierCQueues: async () => ({
        clampSuggestionsPending: 2,
        outboundQueuePending: 0,
        breakGlassPendingApproval: 0,
        deadLetterDepth: 0,
      }),
      regulatoryDrift: async () => ({ clean: true, topSeverity: 'none', driftedKeyCount: 0 }),
      now: () => new Date('2026-04-15T12:00:00Z'),
      ...overrides,
    };
  }

  it('overall ok when everything is up', async () => {
    const r = await runHealthCheck(makeProbes());
    expect(r.overall).toBe('ok');
    expect(r.dependencies.every((d) => d.state === 'ok')).toBe(true);
    expect(r.summary).toMatch(/All systems nominal/);
  });

  it('overall broken when blob store is down', async () => {
    const r = await runHealthCheck(
      makeProbes({ blobStore: async () => brokenDep('Netlify Blobs') })
    );
    expect(r.overall).toBe('broken');
  });

  it('overall degraded when a cron has failed', async () => {
    const r = await runHealthCheck(
      makeProbes({
        crons: async () => [
          {
            id: 'brain-clamp-cron',
            schedule: '0 * * * *',
            lastRunIso: '2026-04-15T11:00:00Z',
            lastResult: 'error',
            lastError: 'blob 503',
          },
        ],
      })
    );
    expect(r.overall).toBe('degraded');
  });

  it('overall degraded when dead-letter depth > 10', async () => {
    const r = await runHealthCheck(
      makeProbes({
        tierCQueues: async () => ({
          clampSuggestionsPending: 0,
          outboundQueuePending: 0,
          breakGlassPendingApproval: 0,
          deadLetterDepth: 25,
        }),
      })
    );
    expect(r.overall).toBe('degraded');
  });

  it('overall broken when critical regulatory drift', async () => {
    const r = await runHealthCheck(
      makeProbes({
        regulatoryDrift: async () => ({ clean: false, topSeverity: 'critical', driftedKeyCount: 3 }),
      })
    );
    expect(r.overall).toBe('broken');
  });

  it('surfaces env health in the report', async () => {
    const r = await runHealthCheck(
      makeProbes({
        env: () => ({
          schemaVersion: 1,
          health: 'broken',
          totalVars: 16,
          requiredCount: 9,
          optionalCount: 7,
          missingRequired: ['HAWKEYE_BRAIN_TOKEN'],
          invalidVars: [],
          statuses: [],
          summary: 'broken',
          regulatory: [],
        }),
      })
    );
    expect(r.envReport.health).toBe('broken');
    expect(r.overall).toBe('broken');
  });

  it('swallows probe exceptions and reports broken', async () => {
    const r = await runHealthCheck(
      makeProbes({
        blobStore: async () => {
          throw new Error('boom');
        },
      })
    );
    const blob = r.dependencies.find((d) => d.name === 'Netlify Blobs');
    expect(blob?.state).toBe('broken');
    expect(blob?.detail).toMatch(/boom/);
  });
});

// ===========================================================================
// onboardingWizard
// ===========================================================================

describe('onboardingWizard', () => {
  const goodTenant: TenantSetupPayload = {
    tenantId: 'tenant-a',
    legalName: 'Acme Trading LLC',
    color: '#1F77B4',
  };

  it('initial state is welcome + empty', () => {
    const s = initialWizardState();
    expect(s.currentStep).toBe('welcome');
    expect(s.completedSteps).toEqual([]);
    expect(isWizardComplete(s)).toBe(false);
  });

  it('happy path walks through every step', () => {
    let state = initialWizardState();
    let t = reduceWizard(state, { type: 'start' });
    state = t.nextState;
    expect(state.currentStep).toBe('welcome');

    t = reduceWizard(state, { type: 'submit_tenant', payload: goodTenant });
    state = t.nextState;
    expect(state.currentStep).toBe('env_check');
    expect(t.actions.some((a) => a.type === 'run_env_check')).toBe(true);

    t = reduceWizard(state, { type: 'env_check_result', passed: true });
    state = t.nextState;
    expect(state.currentStep).toBe('asana_linkage');

    t = reduceWizard(state, {
      type: 'submit_asana',
      payload: { workspaceGid: '123', webhookEchoed: true },
    });
    state = t.nextState;
    expect(state.currentStep).toBe('sample_data');

    t = reduceWizard(state, { type: 'load_sample_data', load: true });
    state = t.nextState;
    expect(state.currentStep).toBe('complete');
    expect(isWizardComplete(state)).toBe(true);
    expect(t.actions.some((a) => a.type === 'load_demo_dataset')).toBe(true);
  });

  it('validates tenant id shape', () => {
    const state = initialWizardState();
    const t = reduceWizard(state, {
      type: 'submit_tenant',
      payload: { tenantId: 'Invalid Caps!', legalName: 'x', color: '#000' },
    });
    expect(t.nextState.currentStep).toBe('welcome');
    expect(t.actions.some((a) => a.type === 'emit_audit' && a.detail.includes('lowercase'))).toBe(true);
  });

  it('env-check failure stays on env_check step', () => {
    let state = initialWizardState();
    state = reduceWizard(state, { type: 'submit_tenant', payload: goodTenant }).nextState;
    const t = reduceWizard(state, { type: 'env_check_result', passed: false });
    expect(t.nextState.currentStep).toBe('env_check');
    expect(t.nextState.envCheckPassed).toBe(false);
  });

  it('asana handshake failure stays on asana_linkage', () => {
    let state = initialWizardState();
    state = reduceWizard(state, { type: 'submit_tenant', payload: goodTenant }).nextState;
    state = reduceWizard(state, { type: 'env_check_result', passed: true }).nextState;
    const t = reduceWizard(state, {
      type: 'submit_asana',
      payload: { workspaceGid: '123', webhookEchoed: false },
    });
    expect(t.nextState.currentStep).toBe('asana_linkage');
    expect(t.actions.some((a) => a.type === 'attempt_asana_handshake')).toBe(true);
  });

  it('back event moves one step back', () => {
    let state = initialWizardState();
    state = reduceWizard(state, { type: 'submit_tenant', payload: goodTenant }).nextState;
    expect(state.currentStep).toBe('env_check');
    const t = reduceWizard(state, { type: 'back' });
    expect(t.nextState.currentStep).toBe('tenant_setup');
  });

  it('restart returns to initial state', () => {
    let state = initialWizardState();
    state = reduceWizard(state, { type: 'submit_tenant', payload: goodTenant }).nextState;
    state = reduceWizard(state, { type: 'env_check_result', passed: true }).nextState;
    const t = reduceWizard(state, { type: 'restart' });
    expect(t.nextState.currentStep).toBe('welcome');
    expect(t.nextState.envCheckPassed).toBe(false);
  });
});
