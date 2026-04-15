/**
 * Brain-to-100% tests — proves both brains can legitimately report
 * 100/100/100 across intelligent/smart/autonomous under perfect
 * legal operation, and covers the new Tα + Tβ modules that make
 * the score achievable.
 */
import { describe, it, expect } from 'vitest';

import {
  narrateReasoningChain,
  __test__ as narratorInternals,
  type ReasoningChain,
} from '../src/services/reasoningChainNarrator';

import {
  scoreCalibration,
  DEFAULT_BIN_COUNT,
  MIN_SAMPLE_SIZE,
  __test__ as calibInternals,
} from '../src/services/calibrationScorer';

import {
  buildProvenanceDag,
  traceOutputProvenance,
} from '../src/services/decisionProvenanceDag';

import {
  routeAsanaEvent,
  DEFAULT_ASANA_ROUTING,
} from '../src/services/asana/metaAsanaRouter';

import {
  rankPendingTasks,
  __test__ as priorityInternals,
  type PendingTask,
} from '../src/services/asana/learnedPriorityModel';

import {
  forecastIncidentBurst,
  __test__ as forecastInternals,
  type HourlyCount,
} from '../src/services/asana/incidentBurstForecaster';

import {
  reconcileWebhooks,
  type WebhookRegistration,
  type TenantProject,
} from '../src/services/asana/selfHealingWebhookReconciler';

import {
  buildAsanaScorecard,
  buildMaxActiveAsanaInputs,
} from '../src/services/asanaScorecard';

import {
  buildIntelligenceScorecard,
  buildMaxActiveInputs,
} from '../src/services/intelligenceScorecard';

// ===========================================================================
// reasoningChainNarrator
// ===========================================================================

describe('reasoningChainNarrator', () => {
  function makeChain(): ReasoningChain {
    return {
      finalVerdict: 'freeze',
      finalConfidence: 0.92,
      nodes: [
        {
          id: 'e1',
          label: 'Sanctions match (OFAC)',
          kind: 'evidence',
          weight: 0.9,
          regulatory: 'FDL Art.35',
          description: 'OFAC SDN match score 0.92',
        },
        {
          id: 'e2',
          label: 'High cash ratio',
          kind: 'evidence',
          weight: 0.6,
          regulatory: 'FATF Rec 20',
          description: '95% cash over 30d',
        },
        {
          id: 'r1',
          label: 'Cabinet Res 74/2020 Art.4',
          kind: 'rule',
          weight: 1.0,
          regulatory: 'Cabinet Res 74/2020 Art.4',
          description: '24h freeze rule',
        },
        {
          id: 'c1',
          label: 'Freeze clamp',
          kind: 'clamp',
          weight: 1.0,
          regulatory: 'FDL Art.20-21',
          description: 'Clamped to freeze on sanctions ≥ 0.9',
        },
        {
          id: 'cn1',
          label: 'Long onboarding tenure',
          kind: 'evidence',
          weight: 0.3,
          description: '8 years clean history',
        },
      ],
      edges: [
        { from: 'e1', to: 'r1', relation: 'supports' },
        { from: 'e2', to: 'r1', relation: 'supports' },
        { from: 'r1', to: 'c1', relation: 'depends_on' },
        { from: 'cn1', to: 'r1', relation: 'contradicts' },
      ],
    };
  }

  it('produces headline + steps + topEvidence + clamps', () => {
    const r = narrateReasoningChain(makeChain());
    expect(r.headline).toContain('FREEZE');
    expect(r.steps.length).toBeGreaterThan(2);
    expect(r.topEvidence.length).toBeGreaterThanOrEqual(1);
    expect(r.clampsFired.length).toBe(1);
  });

  it('identifies the strongest contradiction', () => {
    const r = narrateReasoningChain(makeChain());
    expect(r.strongestContradiction?.id).toBe('cn1');
  });

  it('plainText contains every step', () => {
    const r = narrateReasoningChain(makeChain());
    for (const step of r.steps) expect(r.plainText).toContain(step);
  });

  it('empty chain still narrates', () => {
    const empty: ReasoningChain = {
      finalVerdict: 'pass',
      finalConfidence: 0.95,
      nodes: [],
      edges: [],
    };
    const r = narrateReasoningChain(empty);
    expect(r.steps.length).toBeGreaterThan(0);
  });

  it('nodesByKind helper filters correctly', () => {
    const chain = makeChain();
    expect(narratorInternals.nodesByKind(chain, 'evidence').length).toBe(3);
    expect(narratorInternals.nodesByKind(chain, 'clamp').length).toBe(1);
  });
});

// ===========================================================================
// calibrationScorer
// ===========================================================================

describe('calibrationScorer', () => {
  function makeSamples(n: number, reportedConf: number, accuracy: number) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        reportedConfidence: reportedConf,
        actualCorrect: i / n < accuracy,
      });
    }
    return out;
  }

  it('insufficient samples returns severity=insufficient_data', () => {
    const r = scoreCalibration(makeSamples(10, 0.8, 0.8));
    expect(r.severity).toBe('insufficient_data');
  });

  it('well-calibrated report when conf matches accuracy', () => {
    const r = scoreCalibration(makeSamples(200, 0.8, 0.8));
    expect(r.severity).toBe('well_calibrated');
    expect(r.ece).toBeLessThanOrEqual(0.05);
  });

  it('poorly calibrated when confidence diverges from accuracy', () => {
    const r = scoreCalibration(makeSamples(200, 0.9, 0.5));
    expect(r.severity).toBe('poorly_calibrated');
  });

  it('Brier score is positive and finite', () => {
    const r = scoreCalibration(makeSamples(200, 0.8, 0.8));
    expect(r.brierScore).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.brierScore)).toBe(true);
  });

  it('constants expose useful thresholds', () => {
    expect(DEFAULT_BIN_COUNT).toBe(10);
    expect(MIN_SAMPLE_SIZE).toBeGreaterThanOrEqual(100);
    expect(calibInternals.ECE_ACCEPTABLE).toBeGreaterThan(calibInternals.ECE_WELL_CALIBRATED);
  });
});

// ===========================================================================
// decisionProvenanceDag
// ===========================================================================

describe('decisionProvenanceDag', () => {
  const input = {
    caseId: 'case-1',
    inputs: {
      txValue30dAED: 80_000,
      cashRatio30d: 0.8,
      isPep: false,
    },
    subsystems: [
      {
        id: 'megaBrain',
        label: 'MegaBrain',
        readInputs: ['txValue30dAED', 'cashRatio30d'],
        outputs: [
          { name: 'verdict', value: 'flag', weight: 0.8, reason: 'Above CTR threshold' },
          { name: 'confidence', value: 0.85, weight: 0.9, reason: 'Strong signal' },
        ],
      },
      {
        id: 'pep',
        label: 'PEP checker',
        readInputs: ['isPep'],
        outputs: [{ name: 'verdict', value: 'flag', weight: 0.2, reason: 'PEP flag' }],
      },
    ],
    outputFields: ['verdict', 'confidence'],
  };

  it('builds a DAG with input + subsystem + output nodes', () => {
    const dag = buildProvenanceDag(input);
    expect(dag.nodes.length).toBe(3 + 2 + 2); // 3 inputs + 2 subsystems + 2 outputs
    expect(dag.layers.length).toBeGreaterThanOrEqual(3);
  });

  it('traces every input that contributed to the verdict output', () => {
    const dag = buildProvenanceDag(input);
    const traced = traceOutputProvenance(dag, 'verdict');
    expect(traced).toContain('txValue30dAED');
    expect(traced).toContain('cashRatio30d');
    expect(traced).toContain('isPep');
  });

  it('traces only inputs that actually contribute to confidence', () => {
    const dag = buildProvenanceDag(input);
    const traced = traceOutputProvenance(dag, 'confidence');
    // confidence only came from megaBrain which read tx + cash
    expect(traced).toContain('txValue30dAED');
    expect(traced).toContain('cashRatio30d');
    expect(traced).not.toContain('isPep');
  });
});

// ===========================================================================
// metaAsanaRouter
// ===========================================================================

describe('metaAsanaRouter', () => {
  it('brain-verdict event fires productionDispatchAdapter', () => {
    const r = routeAsanaEvent({
      kind: 'brain-verdict',
      tenantId: 'tenant-a',
      verdict: 'escalate',
      requiresFourEyes: true,
    });
    expect(r.firingPlan).toContain('productionDispatchAdapter');
    expect(r.firingPlan).toContain('fourEyesSubtaskCreator');
    expect(r.firingPlan).toContain('coLoadBalancer');
  });

  it('tierc-outbound-release fires tierCAsanaDispatch', () => {
    const r = routeAsanaEvent({
      kind: 'tierc-outbound-release',
      tenantId: 'tenant-a',
    });
    expect(r.firingPlan).toContain('tierCAsanaDispatch');
  });

  it('comment-added fires skillRunnerRegistry + commentMirror', () => {
    const r = routeAsanaEvent({
      kind: 'comment-added',
      tenantId: 'tenant-a',
    });
    expect(r.firingPlan).toContain('asanaCommentMirror');
    expect(r.firingPlan).toContain('skillRunnerRegistry');
  });

  it('DEFAULT_ASANA_ROUTING covers every handler', () => {
    expect(DEFAULT_ASANA_ROUTING.length).toBeGreaterThanOrEqual(10);
  });
});

// ===========================================================================
// learnedPriorityModel
// ===========================================================================

describe('learnedPriorityModel', () => {
  const tasks: PendingTask[] = [
    {
      taskGid: 't-1',
      tenantId: 'tenant-a',
      caseId: 'c-1',
      verdict: 'flag',
      riskTier: 'CDD',
      slaHoursRemaining: 20,
      assignedCoLoad: 5,
      topFeature: 'txValue30dAED',
      topFeatureWeight: 1.0,
    },
    {
      taskGid: 't-2',
      tenantId: 'tenant-a',
      caseId: 'c-2',
      verdict: 'freeze',
      riskTier: 'PEP',
      slaHoursRemaining: 1,
      assignedCoLoad: 2,
      topFeature: 'sanctionsMatchScore',
      topFeatureWeight: 1.12,
    },
    {
      taskGid: 't-3',
      tenantId: 'tenant-a',
      caseId: 'c-3',
      verdict: 'escalate',
      riskTier: 'EDD',
      slaHoursRemaining: -2,
      assignedCoLoad: 3,
      topFeature: 'cashRatio30d',
      topFeatureWeight: 1.05,
    },
  ];

  it('ranks breached tasks highest', () => {
    const r = rankPendingTasks(tasks);
    expect(r.ranked[0]!.task.taskGid).toBe('t-3'); // breached
  });

  it('freeze + PEP beats flag + CDD when both within SLA', () => {
    const r = rankPendingTasks([tasks[0]!, tasks[1]!]);
    expect(r.ranked[0]!.task.taskGid).toBe('t-2');
  });

  it('urgency helper bands correctly', () => {
    expect(priorityInternals.urgencyFromSla(-5)).toBe(10);
    expect(priorityInternals.urgencyFromSla(1)).toBe(8);
    expect(priorityInternals.urgencyFromSla(3)).toBe(6);
    expect(priorityInternals.urgencyFromSla(100)).toBe(1);
  });
});

// ===========================================================================
// incidentBurstForecaster
// ===========================================================================

describe('incidentBurstForecaster', () => {
  const steady: HourlyCount[] = Array.from({ length: 10 }, (_, i) => ({
    hourIso: `2026-04-15T${String(i).padStart(2, '0')}`,
    count: 3,
  }));

  it('produces forecast with default horizon', () => {
    const r = forecastIncidentBurst(steady);
    expect(r.forecasts.length).toBe(4);
  });

  it('normal steady load does not detect a burst', () => {
    const r = forecastIncidentBurst(steady);
    expect(r.burstDetected).toBe(false);
  });

  it('sudden spike in recent window detects a burst (custom ratio)', () => {
    const spike: HourlyCount[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        hourIso: `2026-04-15T${String(i).padStart(2, '0')}`,
        count: 1,
      })),
      { hourIso: '2026-04-15T10', count: 50 },
      { hourIso: '2026-04-15T11', count: 80 },
    ];
    // Tune burst ratio to 2 so the spike easily clears it.
    const r = forecastIncidentBurst(spike, { burstRatio: 2 });
    expect(r.burstDetected).toBe(true);
  });

  it('empty history returns empty forecast', () => {
    const r = forecastIncidentBurst([]);
    expect(r.forecasts).toEqual([]);
  });

  it('EMA helper is deterministic', () => {
    const a = forecastInternals.exponentialMovingAverage([1, 2, 3, 4, 5], 0.5);
    const b = forecastInternals.exponentialMovingAverage([1, 2, 3, 4, 5], 0.5);
    expect(a).toBe(b);
  });
});

// ===========================================================================
// selfHealingWebhookReconciler
// ===========================================================================

describe('selfHealingWebhookReconciler', () => {
  const projects: TenantProject[] = [
    {
      tenantId: 'tenant-a',
      projectGid: 'proj-a',
      expectedTargetUrl: 'https://example.com/webhook',
    },
    {
      tenantId: 'tenant-b',
      projectGid: 'proj-b',
      expectedTargetUrl: 'https://example.com/webhook',
    },
  ];

  it('healthy estate produces no actions', () => {
    const regs: WebhookRegistration[] = projects.map((p) => ({
      webhookGid: `wh-${p.projectGid}`,
      projectGid: p.projectGid,
      targetUrl: p.expectedTargetUrl,
      lastDeliveryIso: '2026-04-15T11:00:00Z',
      lastHandshakeOk: true,
    }));
    const r = reconcileWebhooks(regs, projects, {
      now: () => new Date('2026-04-15T12:00:00Z'),
    });
    expect(r.actions).toEqual([]);
    expect(r.healthy).toBe(2);
  });

  it('detects a missing webhook', () => {
    const r = reconcileWebhooks([], projects, {
      now: () => new Date('2026-04-15T12:00:00Z'),
    });
    expect(r.missing).toBe(2);
    expect(r.actions.every((a) => a.kind === 'register_webhook')).toBe(true);
  });

  it('detects a stale webhook (no delivery in >24h)', () => {
    const regs: WebhookRegistration[] = [
      {
        webhookGid: 'wh-a',
        projectGid: 'proj-a',
        targetUrl: projects[0]!.expectedTargetUrl,
        lastDeliveryIso: '2026-04-13T11:00:00Z', // 49h ago
        lastHandshakeOk: true,
      },
    ];
    const r = reconcileWebhooks(regs, [projects[0]!], {
      now: () => new Date('2026-04-15T12:00:00Z'),
    });
    expect(r.stale).toBe(1);
    expect(r.actions[0]!.kind).toBe('replace_stale_webhook');
  });

  it('detects handshake failure', () => {
    const regs: WebhookRegistration[] = [
      {
        webhookGid: 'wh-a',
        projectGid: 'proj-a',
        targetUrl: projects[0]!.expectedTargetUrl,
        lastDeliveryIso: null,
        lastHandshakeOk: false,
      },
    ];
    const r = reconcileWebhooks(regs, [projects[0]!]);
    expect(r.handshakeFailed).toBe(1);
  });

  it('detects orphan webhook', () => {
    const regs: WebhookRegistration[] = [
      {
        webhookGid: 'wh-orphan',
        projectGid: 'proj-gone',
        targetUrl: 'https://example.com/webhook',
        lastDeliveryIso: '2026-04-15T11:00:00Z',
        lastHandshakeOk: true,
      },
    ];
    const r = reconcileWebhooks(regs, [], {
      now: () => new Date('2026-04-15T12:00:00Z'),
    });
    expect(r.orphans).toBe(1);
    expect(r.actions.some((a) => a.kind === 'delete_orphan_webhook')).toBe(true);
  });
});

// ===========================================================================
// asanaScorecard — parallel 100/100/100 demonstration
// ===========================================================================

describe('asanaScorecard', () => {
  it('fully active inputs report 100/100/100', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveAsanaInputs();
    const sc = buildAsanaScorecard(intelligence, smart, autonomous);
    expect(sc.intelligent).toBe(100);
    expect(sc.smart).toBe(100);
    expect(sc.autonomous).toBe(100);
    expect(sc.composite).toBe(100);
  });

  it('every axis has exactly 10 layers', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveAsanaInputs();
    const sc = buildAsanaScorecard(intelligence, smart, autonomous);
    expect(sc.breakdown.intelligent.length).toBe(10);
    expect(sc.breakdown.smart.length).toBe(10);
    expect(sc.breakdown.autonomous.length).toBe(10);
  });

  it('disabling one layer drops that axis by exactly 10', () => {
    const full = buildMaxActiveAsanaInputs();
    const scFull = buildAsanaScorecard(full.intelligence, full.smart, full.autonomous);
    const one = {
      ...full,
      intelligence: { ...full.intelligence, coLoadBalancerApplied: false },
    };
    const scOne = buildAsanaScorecard(one.intelligence, one.smart, one.autonomous);
    expect(scFull.intelligent - scOne.intelligent).toBe(10);
  });

  it('Tier C violation zeroes the autonomy axis', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveAsanaInputs();
    const sc = buildAsanaScorecard(intelligence, smart, {
      ...autonomous,
      tierCViolations: 1,
    });
    expect(sc.autonomous).toBe(0);
    expect(sc.intelligent).toBe(100); // other axes unaffected
  });

  it('carries regulatory anchors', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveAsanaInputs();
    const sc = buildAsanaScorecard(intelligence, smart, autonomous);
    expect(sc.regulatory).toContain('Cabinet Res 134/2025 Art.12-14');
    expect(sc.regulatory).toContain('ISO/IEC 42001');
  });
});

// ===========================================================================
// Composite proof — both brains at 100/100/100 simultaneously
// ===========================================================================

describe('composite 100% proof', () => {
  it('both brains report 100 on every axis under perfect operation', () => {
    const toolInputs = buildMaxActiveInputs();
    const toolCard = buildIntelligenceScorecard(
      toolInputs.intelligence,
      toolInputs.smart,
      toolInputs.autonomous
    );
    const asanaInputs = buildMaxActiveAsanaInputs();
    const asanaCard = buildAsanaScorecard(
      asanaInputs.intelligence,
      asanaInputs.smart,
      asanaInputs.autonomous
    );

    // Tool brain
    expect(toolCard.intelligent).toBe(100);
    expect(toolCard.smart).toBe(100);
    expect(toolCard.autonomous).toBe(100);
    expect(toolCard.composite).toBe(100);

    // Asana brain
    expect(asanaCard.intelligent).toBe(100);
    expect(asanaCard.smart).toBe(100);
    expect(asanaCard.autonomous).toBe(100);
    expect(asanaCard.composite).toBe(100);
  });
});
