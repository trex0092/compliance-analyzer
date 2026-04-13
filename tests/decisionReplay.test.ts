import { describe, expect, it } from 'vitest';
import { replayDecision } from '@/services/decisionReplay';
import type { ComplianceDecision } from '@/services/complianceDecisionEngine';

function minimalDecision(overrides: Partial<ComplianceDecision> = {}): ComplianceDecision {
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
    at: new Date().toISOString(),
    auditNarrative: 'routine',
    ...overrides,
  };
}

describe('replayDecision', () => {
  it('produces a clean replay for a pass decision', () => {
    const r = replayDecision(minimalDecision());
    expect(r.finalVerdict).toBe('pass');
    expect(r.steps[0].kind).toBe('mega-brain');
    expect(r.steps[r.steps.length - 1].kind).toBe('final');
    expect(r.steps[r.steps.length - 1].verdict).toBe('pass');
  });

  it('records every clamp reason as a step and extracts regulatory citation', () => {
    const r = replayDecision(
      minimalDecision({
        verdict: 'freeze',
        raw: {
          mega: { verdict: 'pass', confidence: 0.9, recommendedAction: 'proceed' },
          extensions: {},
          clampReasons: [
            'CLAMP: sanctioned beneficial owner detected — verdict forced to freeze (Cabinet Res 74/2020 Art.4-7)',
          ],
          subsystemFailures: [],
          auditNarrative: 'frozen',
        } as unknown as ComplianceDecision['raw'],
      })
    );
    const clampStep = r.steps.find((s) => s.kind === 'clamp');
    expect(clampStep).toBeDefined();
    expect(clampStep!.regulatory).toContain('Cabinet Res 74/2020');
    expect(r.finalVerdict).toBe('freeze');
  });

  it('escalates verdict on subsystem failure', () => {
    const r = replayDecision(
      minimalDecision({
        verdict: 'flag',
        raw: {
          mega: { verdict: 'pass', confidence: 0.9, recommendedAction: 'proceed' },
          extensions: {},
          clampReasons: [],
          subsystemFailures: ['vaspWalletScoring'],
          auditNarrative: 'one subsystem failed',
        } as unknown as ComplianceDecision['raw'],
      })
    );
    const fail = r.steps.find((s) => s.kind === 'subsystem-failure');
    expect(fail).toBeDefined();
    expect(fail!.regulatory).toMatch(/FDL/);
  });

  it('emits a human-review step when the engine flagged it', () => {
    const r = replayDecision(minimalDecision({ requiresHumanReview: true }));
    expect(r.steps.some((s) => s.kind === 'human-review')).toBe(true);
  });

  it('emits an attestation step when an attestation was sealed', () => {
    const r = replayDecision(
      minimalDecision({
        attestation: {
          commitHash: 'a'.repeat(128),
          attestationPublishedAtIso: new Date().toISOString(),
          listName: 'OFAC',
          screenedAtIso: new Date().toISOString(),
        },
      })
    );
    expect(r.steps.some((s) => s.kind === 'attestation')).toBe(true);
  });
});
