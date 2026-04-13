/**
 * Tests for the pure case → EnrichableBrain derivation. Every
 * safety clamp is exercised explicitly because they drive the
 * verdict routing in the super-brain dispatcher downstream.
 */
import { describe, it, expect } from 'vitest';
import type { ComplianceCase } from '@/domain/cases';
import {
  caseToEnrichableBrain,
  deriveCaseVerdict,
  mentionsSanctions,
} from '@/services/caseToEnrichableBrain';

function mkCase(overrides: Partial<ComplianceCase> = {}): ComplianceCase {
  return {
    id: 'case-test',
    entityId: 'ACME LLC',
    caseType: 'transaction-monitoring',
    status: 'open',
    createdAt: '2026-04-13T12:00:00.000Z',
    updatedAt: '2026-04-13T12:00:00.000Z',
    createdBy: 'system',
    sourceModule: 'analyze',
    riskScore: 4,
    riskLevel: 'low',
    redFlags: [],
    findings: [],
    narrative: 'routine transaction monitoring',
    recommendation: 'continue',
    auditLog: [],
    ...overrides,
  };
}

describe('mentionsSanctions', () => {
  it('detects "sanction" in findings', () => {
    expect(
      mentionsSanctions(mkCase({ findings: ['Potential sanctions proximity'] }))
    ).toBe(true);
  });

  it('detects "OFAC" in narrative', () => {
    expect(
      mentionsSanctions(mkCase({ narrative: 'entity surfaced on OFAC watchlist' }))
    ).toBe(true);
  });

  it('returns false on a clean case', () => {
    expect(mentionsSanctions(mkCase())).toBe(false);
  });
});

describe('deriveCaseVerdict — safety clamps', () => {
  it('critical risk level → freeze', () => {
    const d = deriveCaseVerdict(mkCase({ riskLevel: 'critical' }));
    expect(d.verdict).toBe('freeze');
    expect(d.clamps.length).toBeGreaterThan(0);
  });

  it('sanctions keyword → freeze (even on low risk)', () => {
    const d = deriveCaseVerdict(
      mkCase({ riskLevel: 'low', findings: ['Adjacent to UN sanctioned entity'] })
    );
    expect(d.verdict).toBe('freeze');
  });

  it('high risk level → escalate', () => {
    const d = deriveCaseVerdict(mkCase({ riskLevel: 'high' }));
    expect(d.verdict).toBe('escalate');
  });

  it('≥5 red flags → escalate on low risk', () => {
    const d = deriveCaseVerdict(
      mkCase({ riskLevel: 'low', redFlags: ['RF1', 'RF2', 'RF3', 'RF4', 'RF5'] })
    );
    expect(d.verdict).toBe('escalate');
  });

  it('≥2 red flags → flag on low risk', () => {
    const d = deriveCaseVerdict(
      mkCase({ riskLevel: 'low', redFlags: ['RF1', 'RF2'] })
    );
    expect(d.verdict).toBe('flag');
  });

  it('clean low-risk → pass', () => {
    const d = deriveCaseVerdict(mkCase({ riskLevel: 'low' }));
    expect(d.verdict).toBe('pass');
  });

  it('confidence scales with clamp count', () => {
    const cleanConfidence = deriveCaseVerdict(mkCase({ riskLevel: 'low' })).confidence;
    const clampedConfidence = deriveCaseVerdict(
      mkCase({ riskLevel: 'critical', findings: ['OFAC sanctions match'] })
    ).confidence;
    expect(clampedConfidence).toBeGreaterThan(cleanConfidence);
  });

  it('pass verdict with no red flags does NOT require human review', () => {
    const d = deriveCaseVerdict(mkCase({ riskLevel: 'low' }));
    expect(d.requiresHumanReview).toBe(false);
  });

  it('any non-pass verdict requires human review', () => {
    expect(deriveCaseVerdict(mkCase({ riskLevel: 'high' })).requiresHumanReview).toBe(true);
    expect(deriveCaseVerdict(mkCase({ riskLevel: 'critical' })).requiresHumanReview).toBe(true);
  });
});

describe('caseToEnrichableBrain', () => {
  it('produces an EnrichableBrain with the derived verdict', () => {
    const brain = caseToEnrichableBrain(mkCase({ riskLevel: 'critical' }));
    expect(brain.verdict).toBe('freeze');
    expect(brain.entityId).toBe('case-test');
  });

  it('populates strPrediction + reflection subsystems always', () => {
    const brain = caseToEnrichableBrain(mkCase());
    expect(brain.subsystems.strPrediction).toBeDefined();
    expect(brain.subsystems.reflection).toBeDefined();
  });

  it('populates belief only when there is at least one red flag', () => {
    expect(caseToEnrichableBrain(mkCase()).subsystems.belief).toBeUndefined();
    expect(
      caseToEnrichableBrain(mkCase({ redFlags: ['RF1'] })).subsystems.belief
    ).toBeDefined();
  });

  it('populates anomaly only when there are ≥2 findings', () => {
    expect(
      caseToEnrichableBrain(mkCase({ findings: ['finding'] })).subsystems.anomaly
    ).toBeUndefined();
    expect(
      caseToEnrichableBrain(mkCase({ findings: ['f1', 'f2'] })).subsystems.anomaly
    ).toBeDefined();
  });

  it('normalizes risk score to [0,1] in strPrediction', () => {
    const brain = caseToEnrichableBrain(mkCase({ riskScore: 50 }));
    const score = (brain.subsystems.strPrediction as { score?: number }).score;
    expect(score).toBeCloseTo(0.5);
  });

  it('clamps score above 100 to 1', () => {
    const brain = caseToEnrichableBrain(mkCase({ riskScore: 200 }));
    const score = (brain.subsystems.strPrediction as { score?: number }).score;
    expect(score).toBe(1);
  });

  it('notes include every clamp rationale for explainability', () => {
    const brain = caseToEnrichableBrain(mkCase({ riskLevel: 'critical' }));
    // critical → freeze clamp fires → at least one clamp line in notes
    expect(brain.notes?.some((n) => n.includes('freeze'))).toBe(true);
  });
});
