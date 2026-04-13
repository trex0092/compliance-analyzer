import { describe, expect, it } from 'vitest';
import {
  bridgeDecisionToAsana,
  buildAsanaOrchestrationEvent,
  mapVerdictToEventKind,
} from '@/services/complianceDecisionToAsanaBridge';
import type { ComplianceDecision } from '@/services/complianceDecisionEngine';

function decision(overrides: Partial<ComplianceDecision> = {}): ComplianceDecision {
  return {
    id: 'd-1',
    tenantId: 'acme',
    verdict: 'pass',
    confidence: 0.9,
    recommendedAction: 'proceed',
    requiresHumanReview: false,
    strPrediction: {
      probability: 0.05,
      factors: [],
      logit: -3,
      explanation: 'low',
      topRiskFactors: [],
      topProtectiveFactors: [],
    } as unknown as ComplianceDecision['strPrediction'],
    warRoomEvent: {
      id: 'w-1',
      at: new Date().toISOString(),
      kind: 'screening',
      severity: 'info',
      title: 'ok',
    },
    raw: {
      mega: { verdict: 'pass', confidence: 0.9, recommendedAction: 'proceed' },
      verdict: 'pass',
      finalVerdict: 'pass',
      confidence: 0.9,
      recommendedAction: 'proceed',
      requiresHumanReview: false,
      extensions: {},
      clampReasons: [],
      subsystemFailures: [],
      auditNarrative: 'routine',
    } as unknown as ComplianceDecision['raw'],
    at: '2026-04-13T00:00:00.000Z',
    auditNarrative: 'routine',
    ...overrides,
  };
}

describe('mapVerdictToEventKind', () => {
  it('freeze → freeze_initiated', () => {
    expect(mapVerdictToEventKind(decision({ verdict: 'freeze' }))).toBe('freeze_initiated');
  });
  it('escalate → sanctions_match', () => {
    expect(mapVerdictToEventKind(decision({ verdict: 'escalate' }))).toBe('sanctions_match');
  });
  it('flag → str_drafted', () => {
    expect(mapVerdictToEventKind(decision({ verdict: 'flag' }))).toBe('str_drafted');
  });
  it('pass → decision_landed (which the bridge then short-circuits)', () => {
    expect(mapVerdictToEventKind(decision({ verdict: 'pass' }))).toBe('decision_landed');
  });
});

describe('buildAsanaOrchestrationEvent', () => {
  it('carries decision id, tenant, verdict, confidence', () => {
    const ev = buildAsanaOrchestrationEvent(decision({ verdict: 'flag' }));
    expect(ev.tenantId).toBe('acme');
    expect(ev.refId).toBe('d-1');
    expect(ev.decision?.verdict).toBe('flag');
    expect(ev.decision?.confidence).toBe(0.9);
  });

  it('honours kindOverride', () => {
    const ev = buildAsanaOrchestrationEvent(decision(), { kindOverride: 'edd_required' });
    expect(ev.kind).toBe('edd_required');
  });

  it('passes confirmedSanctionsMatch through as payload.confirmed', () => {
    const ev = buildAsanaOrchestrationEvent(decision({ verdict: 'escalate' }), {
      confirmedSanctionsMatch: true,
    });
    expect(ev.payload?.['confirmed']).toBe(true);
  });

  it('forwards clampReasons and subsystemFailures into the decision payload', () => {
    const ev = buildAsanaOrchestrationEvent(
      decision({
        verdict: 'freeze',
        raw: {
          mega: { verdict: 'freeze', confidence: 0.95, recommendedAction: 'execute freeze' },
          extensions: {},
          clampReasons: ['CLAMP: sanctioned UBO (Cabinet Res 74/2020 Art.4-7)'],
          subsystemFailures: ['vaspWalletScoring'],
          auditNarrative: 'frozen',
          verdict: 'freeze',
          finalVerdict: 'freeze',
          confidence: 0.95,
          recommendedAction: 'execute freeze',
          requiresHumanReview: true,
        } as unknown as ComplianceDecision['raw'],
      })
    );
    expect(ev.decision?.clampReasons?.[0]).toMatch(/Cabinet Res 74\/2020/);
    expect(ev.decision?.subsystemFailures).toContain('vaspWalletScoring');
  });
});

describe('bridgeDecisionToAsana', () => {
  it('returns null for a clean pass decision', () => {
    const plan = bridgeDecisionToAsana(decision({ verdict: 'pass' }));
    expect(plan).toBeNull();
  });

  it('returns a freeze plan for a freeze verdict', () => {
    const plan = bridgeDecisionToAsana(decision({ verdict: 'freeze' }));
    expect(plan).not.toBeNull();
    expect(plan!.tasks.length).toBeGreaterThan(0);
    expect(plan!.tasks[0].templateId).toBe('sanctions_freeze');
  });

  it('still produces a plan for a pass verdict when kindOverride is supplied', () => {
    const plan = bridgeDecisionToAsana(decision({ verdict: 'pass' }), {
      kindOverride: 'weekly_digest',
    });
    expect(plan).not.toBeNull();
    expect(plan!.projectName).toBe('MLRO Weekly Digest');
  });

  it('attaches a four-eyes plan for sanctions_match', () => {
    const plan = bridgeDecisionToAsana(decision({ verdict: 'escalate' }));
    expect(plan!.fourEyes).toBeDefined();
    expect(plan!.fourEyes!.parent.isParent).toBe(true);
  });
});
