/**
 * Tests for Phase 2 Weaponized Brain subsystems (#20-#30).
 *
 * One compact file covering all 11 new subsystems — each subsystem is a
 * small pure function, so 3-5 focused tests per module is plenty. The
 * golden-case regression suite in tests/goldenCases.test.ts exercises
 * the subsystems as an integrated pipeline.
 */
import { describe, it, expect } from 'vitest';

import { redTeamCritique } from '@/services/redTeamCritic';
import { queryPrecedents, buildPrecedentIndex } from '@/services/precedentRetriever';
import { detectContradictions } from '@/services/contradictionDetector';
import { runRegulatorVoicePass } from '@/services/regulatorVoicePass';
import {
  fitPlattCalibration,
  calibrateConfidence,
} from '@/services/confidenceCalibrator';
import { computeCounterfactuals } from '@/services/counterfactualFlipper';
import { detectTemporalPatterns } from '@/services/temporalPatternDetector';
import { matchTypologies } from '@/services/sanctionsEvasionTypologyMatcher';
import { detectNarrativeDrift } from '@/services/narrativeDriftDetector';
import { correlateAcrossCustomers } from '@/services/crossCustomerCorrelator';
import { reviewExtensions } from '@/services/teacherExtensionReviewer';

// ---------------------------------------------------------------------------
// #20 Red Team Critic
// ---------------------------------------------------------------------------

describe('redTeamCritic', () => {
  it('freeze verdict with weak evidence produces a downgrade challenge', () => {
    const r = redTeamCritique({
      verdict: 'freeze',
      confidence: 0.5,
      clampReasons: [],
      signals: { sanctionsMatchScore: 0.3, uboUndisclosedPct: 10, adverseMediaCriticalCount: 0 },
    });
    expect(r.hasChallenge).toBe(true);
    expect(r.proposedVerdict).toBe('flag');
    expect(r.narrative).toContain('challenges');
  });

  it('pass verdict with sanctioned UBO produces upgrade challenge to freeze', () => {
    const r = redTeamCritique({
      verdict: 'pass',
      confidence: 0.9,
      clampReasons: [],
      signals: { hasSanctionedUbo: true },
    });
    expect(r.hasChallenge).toBe(true);
    expect(r.proposedVerdict).toBe('freeze');
  });

  it('pass verdict with no red flags yields no challenge', () => {
    const r = redTeamCritique({
      verdict: 'pass',
      confidence: 0.9,
      clampReasons: [],
      signals: {},
    });
    expect(r.hasChallenge).toBe(false);
    expect(r.proposedVerdict).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #21 Precedent Retriever
// ---------------------------------------------------------------------------

describe('precedentRetriever', () => {
  const index = buildPrecedentIndex([
    {
      caseId: 'C1',
      decidedAt: '2026-01-15T00:00:00Z',
      verdict: 'escalate',
      outcome: 'str_filed',
      factors: [0.9, 0.8, 0.7],
      label: 'High-risk UBO case',
    },
    {
      caseId: 'C2',
      decidedAt: '2026-02-20T00:00:00Z',
      verdict: 'escalate',
      outcome: 'str_filed',
      factors: [0.85, 0.75, 0.7],
      label: 'Similar UBO case',
    },
    {
      caseId: 'C3',
      decidedAt: '2026-03-10T00:00:00Z',
      verdict: 'pass',
      outcome: 'dismissed',
      factors: [0.1, 0.2, 0.1],
      label: 'Clean low-risk',
    },
  ]);

  it('top match for a high-risk query is a str_filed precedent', () => {
    const r = queryPrecedents(index, { factors: [0.88, 0.78, 0.72], topK: 3 });
    expect(r.matches[0].record.caseId).toMatch(/^C[12]$/);
    expect(r.dominantOutcome).toBe('str_filed');
    expect(r.outcomeCounts.str_filed).toBe(2);
  });

  it('empty index returns empty matches', () => {
    const r = queryPrecedents([], { factors: [0.5, 0.5, 0.5] });
    expect(r.matches).toHaveLength(0);
    expect(r.dominantOutcome).toBeNull();
  });

  it('similarity is 1.0 for identical factor vectors', () => {
    const r = queryPrecedents(index, { factors: [0.9, 0.8, 0.7], topK: 1 });
    expect(r.matches[0].similarity).toBeCloseTo(1.0, 3);
  });
});

// ---------------------------------------------------------------------------
// #22 Contradiction Detector
// ---------------------------------------------------------------------------

describe('contradictionDetector', () => {
  it('pass vs freeze signal → material contradiction', () => {
    const r = detectContradictions([
      { name: 'ubo', impliedVerdict: 'pass', confidence: 0.9 },
      { name: 'wallets', impliedVerdict: 'freeze', confidence: 0.95 },
    ]);
    expect(r.hasContradiction).toBe(true);
    expect(r.score).toBe(1);
    expect(r.disagreements).toHaveLength(1);
  });

  it('pass vs flag signal → no material contradiction', () => {
    const r = detectContradictions([
      { name: 'a', impliedVerdict: 'pass', confidence: 0.9 },
      { name: 'b', impliedVerdict: 'flag', confidence: 0.8 },
    ]);
    expect(r.hasContradiction).toBe(false);
    expect(r.disagreements).toHaveLength(0);
  });

  it('single signal → cannot contradict', () => {
    const r = detectContradictions([
      { name: 'only', impliedVerdict: 'freeze', confidence: 1 },
    ]);
    expect(r.hasContradiction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #23 Regulator Voice Pass
// ---------------------------------------------------------------------------

describe('regulatorVoicePass', () => {
  it('freeze with all evidence answers all questions', () => {
    const r = runRegulatorVoicePass({
      verdict: 'freeze',
      narrative: 'complete',
      evidence: {
        hasSanctionsScreen: true,
        hasUboAnalysis: true,
        hasTransactionRecord: true,
        hasStrNarrative: true,
        hasAuditChain: true,
        hasFourEyesApproval: true,
        hasRegulatoryCitation: true,
      },
    });
    expect(r.hasGaps).toBe(false);
    expect(r.unansweredCount).toBe(0);
  });

  it('escalate without STR narrative flags a gap', () => {
    const r = runRegulatorVoicePass({
      verdict: 'escalate',
      narrative: '',
      evidence: {
        hasSanctionsScreen: true,
        hasUboAnalysis: true,
        hasTransactionRecord: true,
        hasStrNarrative: false,
        hasAuditChain: true,
        hasFourEyesApproval: true,
        hasRegulatoryCitation: true,
      },
    });
    expect(r.hasGaps).toBe(true);
    expect(r.questions.find((q) => q.id === 'Q4')?.answered).toBe(false);
  });

  it('pass verdict has fewer applicable questions than freeze', () => {
    const passReport = runRegulatorVoicePass({
      verdict: 'pass',
      narrative: '',
      evidence: { hasSanctionsScreen: true, hasAuditChain: true },
    });
    const freezeReport = runRegulatorVoicePass({
      verdict: 'freeze',
      narrative: '',
      evidence: { hasSanctionsScreen: true, hasAuditChain: true },
    });
    expect(passReport.questions.length).toBeLessThan(freezeReport.questions.length);
  });
});

// ---------------------------------------------------------------------------
// #24 Confidence Calibrator
// ---------------------------------------------------------------------------

describe('confidenceCalibrator', () => {
  it('tiny sample returns identity calibration', () => {
    const params = fitPlattCalibration([{ rawConfidence: 0.5, outcomePositive: true }]);
    expect(params.a).toBe(1);
    expect(params.b).toBe(0);
  });

  it('fits calibration on larger sample and calibrated score is in [0,1]', () => {
    const examples = Array.from({ length: 50 }, (_, i) => ({
      rawConfidence: i / 49,
      outcomePositive: i > 25,
    }));
    const params = fitPlattCalibration(examples, 200, 0.2);
    const calibrated = calibrateConfidence(0.5, params);
    expect(calibrated).toBeGreaterThanOrEqual(0);
    expect(calibrated).toBeLessThanOrEqual(1);
    expect(params.sampleSize).toBe(50);
  });

  it('calibration produces higher output for higher raw confidence', () => {
    const examples = Array.from({ length: 100 }, (_, i) => ({
      rawConfidence: i / 99,
      outcomePositive: i > 50,
    }));
    const params = fitPlattCalibration(examples, 300);
    const low = calibrateConfidence(0.1, params);
    const high = calibrateConfidence(0.9, params);
    expect(high).toBeGreaterThan(low);
  });
});

// ---------------------------------------------------------------------------
// #25 Counterfactual Flipper
// ---------------------------------------------------------------------------

describe('counterfactualFlipper', () => {
  it('freeze with confirmed wallet hit has counterfactuals to flag', () => {
    const r = computeCounterfactuals({
      verdict: 'freeze',
      signals: { confirmedWalletHits: 2, sanctionsMatchScore: 0.95 },
    });
    expect(r.counterfactuals.length).toBeGreaterThan(0);
    expect(r.counterfactuals.some((c) => c.signal === 'confirmedWalletHits')).toBe(true);
  });

  it('pass with no signals suggests what could flip it', () => {
    const r = computeCounterfactuals({ verdict: 'pass', signals: {} });
    expect(r.counterfactuals.length).toBeGreaterThan(0);
    expect(r.counterfactuals.some((c) => c.flippedVerdict === 'escalate')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #26 Temporal Pattern Detector
// ---------------------------------------------------------------------------

describe('temporalPatternDetector', () => {
  const base = Date.parse('2026-04-01T00:00:00Z');
  it('detects repeat pattern with 3+ events in window', () => {
    const events = [
      { entityId: 'E1', at: new Date(base).toISOString(), severity: 'low' as const, kind: 'alert' },
      { entityId: 'E1', at: new Date(base + 86400000).toISOString(), severity: 'medium' as const, kind: 'alert' },
      { entityId: 'E1', at: new Date(base + 2 * 86400000).toISOString(), severity: 'high' as const, kind: 'alert' },
    ];
    const r = detectTemporalPatterns(events, 'E1', new Date(base + 3 * 86400000));
    expect(r.hasRepeatPattern).toBe(true);
    expect(r.hasEscalatingPattern).toBe(true);
    expect(r.strength).toBeGreaterThan(0);
  });

  it('burst pattern on same day triggers burst flag', () => {
    const events = [
      { entityId: 'E1', at: new Date(base).toISOString(), severity: 'low' as const, kind: 'alert' },
      { entityId: 'E1', at: new Date(base + 3600000).toISOString(), severity: 'low' as const, kind: 'alert' },
    ];
    const r = detectTemporalPatterns(events, 'E1', new Date(base + 86400000));
    expect(r.hasBurstPattern).toBe(true);
    expect(r.burstCount).toBe(2);
  });

  it('no events → no patterns', () => {
    const r = detectTemporalPatterns([], 'E1');
    expect(r.hasRepeatPattern).toBe(false);
    expect(r.hasBurstPattern).toBe(false);
    expect(r.strength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #27 Typology Matcher
// ---------------------------------------------------------------------------

describe('sanctionsEvasionTypologyMatcher', () => {
  it('sanctioned UBO front company matches typology T2', () => {
    const r = matchTypologies({ hasSanctionedUbo: true, isShellCompany: true });
    expect(r.topHit?.id).toBe('T2');
    expect(r.topHit?.action).toBe('freeze');
  });

  it('threshold structuring matches T3', () => {
    const r = matchTypologies({ nearThresholdCount: 10, counterpartyCount30d: 15 });
    expect(r.hits.some((h) => h.id === 'T3')).toBe(true);
  });

  it('no signals → no hits', () => {
    const r = matchTypologies({});
    expect(r.hits).toHaveLength(0);
    expect(r.topHit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// #28 Narrative Drift Detector
// ---------------------------------------------------------------------------

describe('narrativeDriftDetector', () => {
  it('identical narrative to prior filing flags drift', () => {
    const prior = [
      {
        filingId: 'F1',
        typology: 'STR',
        narrative:
          'The customer transferred large amounts of cash across multiple jurisdictions within a short period without clear economic purpose.',
      },
    ];
    const r = detectNarrativeDrift(
      'The customer transferred large amounts of cash across multiple jurisdictions within a short period without clear economic purpose.',
      'STR',
      prior
    );
    expect(r.hasDrift).toBe(true);
    expect(r.closestMatch?.filingId).toBe('F1');
  });

  it('unique narrative does not flag drift', () => {
    const prior = [
      {
        filingId: 'F1',
        typology: 'STR',
        narrative: 'Alpha beta gamma structuring detected via peer benchmark analysis.',
      },
    ];
    const r = detectNarrativeDrift(
      'Completely different content about real estate purchase anomalies with no overlap.',
      'STR',
      prior
    );
    expect(r.hasDrift).toBe(false);
  });

  it('empty prior filings library does not crash and returns no drift', () => {
    const r = detectNarrativeDrift('anything at all', 'STR', []);
    expect(r.hasDrift).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #29 Cross-Customer Correlator
// ---------------------------------------------------------------------------

describe('crossCustomerCorrelator', () => {
  it('shared UBO across two customers produces a hit', () => {
    const r = correlateAcrossCustomers([
      { customerId: 'C1', customerName: 'Alpha', uboIds: ['ubo-1', 'ubo-2'] },
      { customerId: 'C2', customerName: 'Beta', uboIds: ['ubo-1'] },
    ]);
    expect(r.hits.some((h) => h.kind === 'ubo' && h.value === 'ubo-1')).toBe(true);
    expect(r.countsByKind.ubo).toBe(1);
  });

  it('no overlaps → no hits', () => {
    const r = correlateAcrossCustomers([
      { customerId: 'C1', customerName: 'A', walletAddresses: ['wallet-1'] },
      { customerId: 'C2', customerName: 'B', walletAddresses: ['wallet-2'] },
    ]);
    expect(r.hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #30 Teacher Extension Reviewer
// ---------------------------------------------------------------------------

describe('teacherExtensionReviewer', () => {
  it('ratifies when extensions agree with verdict', () => {
    const r = reviewExtensions({
      studentVerdict: 'freeze',
      extensions: { hasSanctionedUbo: true },
    });
    expect(r.verdict).toBe('ratified');
  });

  it('contests when sanctioned UBO present but verdict is pass', () => {
    const r = reviewExtensions({
      studentVerdict: 'pass',
      extensions: { hasSanctionedUbo: true },
    });
    expect(r.verdict).toBe('contested');
    expect(r.concerns.some((c) => c.includes('Sanctioned UBO'))).toBe(true);
  });

  it('contests when typology says freeze but verdict is pass', () => {
    const r = reviewExtensions({
      studentVerdict: 'pass',
      extensions: {},
      phase2: { typologyTopAction: 'freeze' },
    });
    expect(r.verdict).toBe('contested');
  });
});
