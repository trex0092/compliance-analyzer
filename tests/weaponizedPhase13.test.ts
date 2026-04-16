/**
 * Unit tests for Weaponized Brain Phase 13 subsystems (#99-#103).
 *
 * Tests the pure functions directly — not through runWeaponizedBrain —
 * so a regression is pinpointed to the subsystem in question rather than
 * surfacing as a diffuse orchestrator failure.
 */
import { describe, it, expect } from 'vitest';
import {
  runFactorAblation,
  checkCitationIntegrity,
  buildReasoningDag,
  runBenignNarrativeProbe,
  runEvidenceFreshness,
  type BenignNarrativeGenerator,
  type DatedSignal,
} from '@/services/weaponizedPhase13';
import type { SubsystemSignal } from '@/services/contradictionDetector';

// ---------------------------------------------------------------------------
// #99 Factor Ablation
// ---------------------------------------------------------------------------

describe('runFactorAblation (#99)', () => {
  it('flags a signal as necessary when its removal de-escalates', () => {
    const signals: SubsystemSignal[] = [
      { name: 'sanctionsMatch', impliedVerdict: 'freeze', confidence: 0.95 },
      { name: 'adverseMedia', impliedVerdict: 'flag', confidence: 0.6 },
    ];
    const out = runFactorAblation({ baselineVerdict: 'freeze', signals });
    expect(out.baselineVerdict).toBe('freeze');
    expect(out.necessarySignals).toContain('sanctionsMatch');
    expect(out.redundantSignals).toContain('adverseMedia');
    expect(out.narrative).toMatch(/necessary/i);
  });

  it('reports over-determination when two signals independently imply the same verdict', () => {
    const signals: SubsystemSignal[] = [
      { name: 'peA', impliedVerdict: 'escalate', confidence: 0.8 },
      { name: 'peB', impliedVerdict: 'escalate', confidence: 0.8 },
    ];
    const out = runFactorAblation({ baselineVerdict: 'escalate', signals });
    // Removing either one still leaves the other at escalate → none are necessary.
    expect(out.necessarySignals).toEqual([]);
    expect(out.redundantSignals).toEqual(['peA', 'peB']);
    expect(out.narrative).toMatch(/over-determined/i);
  });

  it('ignores low-confidence signals during aggregation', () => {
    const signals: SubsystemSignal[] = [
      { name: 'loud', impliedVerdict: 'freeze', confidence: 0.9 },
      { name: 'whisper', impliedVerdict: 'escalate', confidence: 0.3 },
    ];
    const out = runFactorAblation({ baselineVerdict: 'freeze', signals });
    // Removing the whisper shouldn't de-escalate because it was sub-threshold.
    const whisper = out.results.find((r) => r.signalName === 'whisper');
    expect(whisper?.necessary).toBe(false);
  });

  it('handles empty signals gracefully', () => {
    const out = runFactorAblation({ baselineVerdict: 'pass', signals: [] });
    expect(out.results).toEqual([]);
    expect(out.necessarySignals).toEqual([]);
    expect(out.redundantSignals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #100 Citation Integrity
// ---------------------------------------------------------------------------

describe('checkCitationIntegrity (#100)', () => {
  it('passes when every clamp cites a regulation', () => {
    const clampReasons = [
      'CLAMP: sanctions match escalated (FDL No.10/2025 Art.20 + Cabinet Res 74/2020 Art.4-7)',
      'CLAMP: EDD required for PEP (Cabinet Res 134/2025 Art.14)',
    ];
    const out = checkCitationIntegrity({ clampReasons });
    expect(out.complete).toBe(true);
    expect(out.defects).toHaveLength(0);
    expect(out.coverage).toBe(1);
    expect(out.clampReasonsChecked).toBe(2);
  });

  it('flags clamps that omit a citation', () => {
    const clampReasons = [
      'CLAMP: verdict escalated because reasons',
      'CLAMP: correctly cited (FDL No.10/2025 Art.24)',
    ];
    const out = checkCitationIntegrity({ clampReasons });
    expect(out.complete).toBe(false);
    expect(out.defects).toHaveLength(1);
    expect(out.defects[0].source).toBe('clampReason');
    expect(out.coverage).toBeCloseTo(0.5, 2);
    expect(out.narrative).toMatch(/INCOMPLETE/);
  });

  it('recognises all CLAUDE.md §8 citation patterns', () => {
    const clampReasons = [
      'CLAMP: 1 (FDL No.10/2025 Art.24)',
      'CLAMP: 2 (Cabinet Res 134/2025 Art.14)',
      'CLAMP: 3 (Cabinet Decision 109/2023)',
      'CLAMP: 4 (MoE Circular 08/AML/2021)',
      'CLAMP: 5 (FATF Rec 10)',
      'CLAMP: 6 (LBMA RGG v9)',
      'CLAMP: 7 (EU AI Act Art.13)',
      'CLAMP: 8 (NIST AI RMF)',
    ];
    const out = checkCitationIntegrity({ clampReasons });
    expect(out.complete).toBe(true);
    expect(out.clampReasonsChecked).toBe(8);
  });

  it('flags verdict-bearing narrative lines without citations', () => {
    const out = checkCitationIntegrity({
      clampReasons: [],
      narrativeLines: ['Filed STR on the customer due to suspicion', 'Uneventful day'],
    });
    expect(out.defects).toHaveLength(1);
    expect(out.defects[0].source).toBe('narrativeLine');
  });

  it('returns 100% coverage when no clamp reasons announce themselves as clamps', () => {
    const out = checkCitationIntegrity({
      clampReasons: ['note: nothing to enforce here'],
    });
    expect(out.coverage).toBe(1);
    expect(out.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #101 Reasoning-Chain DAG
// ---------------------------------------------------------------------------

describe('buildReasoningDag (#101)', () => {
  it('builds nodes and edges from signals and clamps', () => {
    const signals: SubsystemSignal[] = [
      { name: 'sanctionsMatch', impliedVerdict: 'freeze', confidence: 0.95 },
      { name: 'benign', impliedVerdict: 'pass', confidence: 0.7 },
    ];
    const out = buildReasoningDag({
      signals,
      clampReasons: ['CLAMP: sanctionsMatch confirmed (Cabinet Res 74/2020 Art.4-7)'],
      megaVerdict: 'flag',
      finalVerdict: 'freeze',
    });
    // 2 verdict nodes + 2 signal nodes + 1 clamp node = 5
    expect(out.nodes).toHaveLength(5);
    // contributes (sanctionsMatch→final) + escalates (clamp→final)
    // + contributes (sanctionsMatch→clamp, via name match) + escalates (mega→final)
    expect(out.edges.length).toBeGreaterThanOrEqual(3);
    expect(out.criticalPath[0]).toBe('verdict.mega');
    expect(out.criticalPath[out.criticalPath.length - 1]).toBe('verdict.final');
  });

  it('does not draw contribution edges from pass-verdict signals', () => {
    const signals: SubsystemSignal[] = [
      { name: 'clean', impliedVerdict: 'pass', confidence: 0.95 },
    ];
    const out = buildReasoningDag({
      signals,
      clampReasons: [],
      megaVerdict: 'pass',
      finalVerdict: 'pass',
    });
    const contribEdges = out.edges.filter((e) => e.kind === 'contributes');
    expect(contribEdges).toHaveLength(0);
  });

  it('truncates long clamp labels at 80 chars', () => {
    const longReason = 'CLAMP: ' + 'x'.repeat(200);
    const out = buildReasoningDag({
      signals: [],
      clampReasons: [longReason],
      megaVerdict: 'pass',
      finalVerdict: 'pass',
    });
    const clampNode = out.nodes.find((n) => n.kind === 'clamp');
    expect(clampNode).toBeDefined();
    expect(clampNode!.label.length).toBeLessThanOrEqual(80);
  });
});

// ---------------------------------------------------------------------------
// #102 Benign-Narrative Probe
// ---------------------------------------------------------------------------

describe('runBenignNarrativeProbe (#102)', () => {
  it('is a no-op when no generator is provided', async () => {
    const out = await runBenignNarrativeProbe({
      entitySummary: 'Acme Inc',
      signals: [],
    });
    expect(out.ran).toBe(false);
    expect(out.text).toBe('');
    expect(out.plausibility).toBe(0);
    expect(out.narrative).toMatch(/skipped/i);
  });

  it('invokes the generator and clamps plausibility to [0,1]', async () => {
    const generator: BenignNarrativeGenerator = async () => ({
      text: 'The entity is a small shop that simply crossed AED 55K on a single cash sale.',
      plausibility: 1.5, // over-max — should clamp
      supportingFactors: ['single_transaction', 'low_prior_alerts'],
    });
    const out = await runBenignNarrativeProbe({
      entitySummary: 'Acme Inc',
      signals: [],
      generator,
    });
    expect(out.ran).toBe(true);
    expect(out.plausibility).toBe(1);
    expect(out.supportingFactors).toEqual(['single_transaction', 'low_prior_alerts']);
    expect(out.narrative).toMatch(/EU AI Act Art\.15/);
  });

  it('caps supporting factors at 10 entries', async () => {
    const generator: BenignNarrativeGenerator = async () => ({
      text: 't',
      plausibility: 0.5,
      supportingFactors: Array.from({ length: 25 }, (_, i) => `f${i}`),
    });
    const out = await runBenignNarrativeProbe({
      entitySummary: 'e',
      signals: [],
      generator,
    });
    expect(out.supportingFactors).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// #103 Evidence Freshness Decay
// ---------------------------------------------------------------------------

describe('runEvidenceFreshness (#103)', () => {
  const now = new Date('2026-04-16T00:00:00Z');

  it('applies 0.5 decay at exactly one half-life', () => {
    const signals: DatedSignal[] = [
      {
        name: 'oldHit',
        impliedVerdict: 'flag',
        confidence: 0.9,
        asOf: new Date('2025-10-18T00:00:00Z'), // ~180 days earlier
      },
    ];
    const out = runEvidenceFreshness({ signals, asOf: now, halfLifeDays: 180 });
    expect(out.halfLifeDays).toBe(180);
    expect(out.adjustments).toHaveLength(1);
    const adj = out.adjustments[0];
    // Decay should be ~0.5 (within rounding).
    expect(adj.decayFactor).toBeGreaterThan(0.49);
    expect(adj.decayFactor).toBeLessThan(0.51);
    expect(adj.adjustedConfidence).toBeCloseTo(0.45, 1);
  });

  it('demotes a signal below 0.5 when age exceeds the half-life', () => {
    const signals: DatedSignal[] = [
      {
        name: 'stale',
        impliedVerdict: 'freeze',
        confidence: 0.8,
        asOf: new Date('2024-04-16T00:00:00Z'), // 2 years earlier at halfLife=180 → ~0.016x
      },
    ];
    const out = runEvidenceFreshness({ signals, asOf: now, halfLifeDays: 180 });
    expect(out.demoted).toBe(1);
    expect(out.adjustments[0].adjustedConfidence).toBeLessThan(0.5);
    expect(out.narrative).toMatch(/FATF Rec 10/);
  });

  it('leaves a fresh signal untouched (decay ~1.0)', () => {
    const signals: DatedSignal[] = [
      {
        name: 'fresh',
        impliedVerdict: 'flag',
        confidence: 0.9,
        asOf: new Date('2026-04-15T00:00:00Z'), // 1 day ago
      },
    ];
    const out = runEvidenceFreshness({ signals, asOf: now, halfLifeDays: 180 });
    expect(out.demoted).toBe(0);
    expect(out.adjustments[0].decayFactor).toBeGreaterThan(0.99);
    expect(out.adjustments[0].adjustedConfidence).toBeCloseTo(0.9, 2);
  });

  it('treats signals without an asOf as present-dated (no decay)', () => {
    const signals: DatedSignal[] = [{ name: 'undated', impliedVerdict: 'flag', confidence: 0.7 }];
    const out = runEvidenceFreshness({ signals, asOf: now });
    expect(out.adjustments[0].ageDays).toBe(0);
    expect(out.adjustments[0].adjustedConfidence).toBeCloseTo(0.7, 2);
  });

  it('floors half-life at 1 day to avoid divide-by-zero', () => {
    const out = runEvidenceFreshness({
      signals: [{ name: 's', impliedVerdict: 'flag', confidence: 0.5, asOf: now }],
      asOf: now,
      halfLifeDays: 0,
    });
    expect(out.halfLifeDays).toBe(1);
  });
});
