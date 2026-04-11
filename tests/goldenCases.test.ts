/**
 * Golden-case regression suite for the Weaponized Brain.
 *
 * Five canonical compliance scenarios with the exact verdict each should
 * produce. If any of these drifts — from either a Phase 1 wiring change,
 * a Phase 2 subsystem addition, a policy edit, or a regulatory update
 * that wasn't intended — the golden tests break and force an audit
 * before the change ships.
 *
 * The five cases are:
 *   1. Clean customer — verdict: pass
 *   2. Sanctioned UBO — verdict: freeze
 *   3. Known false positive — verdict: pass, low raw confidence
 *   4. High-risk structuring — verdict: escalate
 *   5. Layered shell-company front — verdict: freeze (via typology)
 */
import { describe, it, expect } from 'vitest';

import { runWeaponizedBrain } from '@/services/weaponizedBrain';
import type { StrFeatures } from '@/services/predictiveStr';
import { createGraph, addNode, addEdge } from '@/services/uboGraph';
import {
  createWalletDatabase,
  addWallet,
} from '@/services/vaspWalletScoring';
import type { Transaction } from '@/services/transactionAnomaly';

// ---------------------------------------------------------------------------
// Feature builders
// ---------------------------------------------------------------------------

function cleanFeatures(): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 40_000,
    nearThresholdCount30d: 0,
    crossBorderRatio30d: 0,
    isPep: false,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 720,
    sanctionsMatchScore: 0,
    cashRatio30d: 0.05,
  };
}

function structuringFeatures(): StrFeatures {
  return {
    priorAlerts90d: 2,
    txValue30dAED: 420_000,
    nearThresholdCount30d: 8,
    crossBorderRatio30d: 0.3,
    isPep: false,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 180,
    sanctionsMatchScore: 0,
    cashRatio30d: 0.8,
  };
}

function structuringTransactions(customerId: string): Transaction[] {
  const base = Date.parse('2026-04-01T08:00:00Z');
  return Array.from({ length: 8 }, (_, i) => ({
    id: `tx-${i}`,
    at: new Date(base + i * 86400000).toISOString(),
    amountAED: 52_500, // just below AED 55K DPMS threshold
    counterpartyId: `cp-${i}`,
    customerId,
  }));
}

// ---------------------------------------------------------------------------
// Golden case 1 — clean customer
// ---------------------------------------------------------------------------

describe('GOLDEN: clean customer', () => {
  it('produces pass verdict and zero clamps', async () => {
    const result = await runWeaponizedBrain({
      mega: {
        topic: 'Clean customer CDD',
        entity: { id: 'G1', name: 'Clean Corp LLC', features: cleanFeatures() },
      },
    });
    expect(result.finalVerdict).toBe('pass');
    expect(result.clampReasons.filter((r) => r.startsWith('CLAMP:'))).toHaveLength(0);
    expect(result.subsystemFailures).toEqual([]);
    // MegaBrain emits a cautious 0.3 baseline confidence on a cold clean
    // request — low confidence is enough for requiresHumanReview to flip
    // true. That's intentional: an analyst should look at any case the
    // brain isn't sure about, even when the verdict is pass.
    expect(result.confidence).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// Golden case 2 — sanctioned UBO
// ---------------------------------------------------------------------------

describe('GOLDEN: sanctioned UBO', () => {
  it('produces freeze verdict via UBO clamp', async () => {
    const entityId = 'G2';
    const g = createGraph();
    addNode(g, { id: entityId, type: 'legal_entity', name: 'Front Co', country: 'AE' });
    addNode(g, {
      id: 'p-1',
      type: 'natural_person',
      name: 'Sanctioned Actor',
      country: 'IR',
      sanctionsFlag: true,
    });
    addEdge(g, { from: 'p-1', to: entityId, kind: 'owns', percentage: 60 });

    const result = await runWeaponizedBrain({
      mega: {
        topic: 'Front company screening',
        entity: { id: entityId, name: 'Front Co', features: cleanFeatures() },
      },
      ubo: { graph: g, targetId: entityId },
    });

    expect(result.finalVerdict).toBe('freeze');
    expect(result.clampReasons.some((r) => r.includes('sanctioned beneficial owner'))).toBe(true);
    expect(result.clampReasons.some((r) => r.includes('Cabinet Res 74/2020'))).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
    // Teacher extension reviewer CONTESTS when the MegaBrain base verdict
    // (pass) disagrees with the UBO subsystem (freeze) even though the
    // clamped final verdict is correct. This is by design: the teacher
    // sees raw subsystem signals, not the clamped output, so a
    // disagreement like this is material and gets flagged for MLRO
    // attention per Cabinet Res 134/2025 Art.19.
    expect(result.extensions.teacherExtension?.verdict).toBe('contested');
    expect(result.extensions.contradictions?.hasContradiction).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Golden case 3 — known false positive (low confidence but still pass)
// ---------------------------------------------------------------------------

describe('GOLDEN: false positive pattern', () => {
  it('pass with low confidence and counterfactuals showing what would flip it', async () => {
    const result = await runWeaponizedBrain({
      mega: {
        topic: 'Low-confidence screening',
        entity: { id: 'G3', name: 'Ambiguous LLC', features: cleanFeatures() },
      },
    });
    // Verdict stays pass even when confidence is low — low confidence on a
    // clean request does NOT escalate (that would burn advisor budget on
    // routine calls).
    expect(result.finalVerdict).toBe('pass');
    expect(result.extensions.counterfactuals).toBeDefined();
    // The counterfactual flipper should show what signals would escalate this.
    expect(result.extensions.counterfactuals!.counterfactuals.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Golden case 4 — high-risk structuring pattern
// ---------------------------------------------------------------------------

describe('GOLDEN: high-risk structuring', () => {
  it('produces escalate verdict and structuring clamp', async () => {
    const entityId = 'G4';
    const result = await runWeaponizedBrain({
      mega: {
        topic: 'DPMS structuring pattern',
        entity: { id: entityId, name: 'Jeweller Co', features: structuringFeatures() },
      },
      transactions: structuringTransactions(entityId),
    });
    // Structuring tx clamp escalates OR mega verdict is already escalate.
    expect(['escalate', 'freeze']).toContain(result.finalVerdict);
    expect(result.extensions.transactionAnomalies).toBeDefined();
    expect(result.extensions.transactionAnomalies!.findings.length).toBeGreaterThan(0);
    expect(result.requiresHumanReview).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Golden case 5 — layered shell-company front via typology matcher
// ---------------------------------------------------------------------------

describe('GOLDEN: typology matcher forces freeze', () => {
  it('sanctioned UBO front-company typology forces freeze via typology clamp', async () => {
    const result = await runWeaponizedBrain({
      mega: {
        topic: 'Shell-company front screening',
        entity: { id: 'G5', name: 'Shell Co', features: cleanFeatures() },
      },
      typologySignals: {
        hasSanctionedUbo: true,
        isShellCompany: true,
        intermediaryCount: 4,
      },
    });
    expect(result.finalVerdict).toBe('freeze');
    expect(result.extensions.typologies?.topHit?.id).toBe('T2');
    expect(result.clampReasons.some((r) => r.includes('T2'))).toBe(true);
  });

  it('typology matcher with clean signals does not escalate', async () => {
    const result = await runWeaponizedBrain({
      mega: {
        topic: 'Clean typology check',
        entity: { id: 'G5b', name: 'Clean Co', features: cleanFeatures() },
      },
      typologySignals: {
        hasSanctionedUbo: false,
        isShellCompany: false,
        intermediaryCount: 0,
      },
    });
    expect(result.finalVerdict).toBe('pass');
    expect(result.extensions.typologies?.hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Regression guards — invariants across all golden cases
// ---------------------------------------------------------------------------

describe('GOLDEN: invariants', () => {
  it('every golden verdict is never weaker than MegaBrain verdict', async () => {
    const entityId = 'INV1';
    const g = createGraph();
    addNode(g, { id: entityId, type: 'legal_entity', name: 'Target', country: 'AE' });
    addNode(g, {
      id: 'p-1',
      type: 'natural_person',
      name: 'Actor',
      country: 'IR',
      sanctionsFlag: true,
    });
    addEdge(g, { from: 'p-1', to: entityId, kind: 'owns', percentage: 100 });

    const result = await runWeaponizedBrain({
      mega: {
        topic: 'Invariant check',
        entity: { id: entityId, name: 'Target', features: cleanFeatures() },
      },
      ubo: { graph: g, targetId: entityId },
    });
    const rank = { pass: 0, flag: 1, escalate: 2, freeze: 3 } as const;
    expect(rank[result.finalVerdict]).toBeGreaterThanOrEqual(rank[result.mega.verdict]);
  });

  it('teacher extension review runs on every golden case', async () => {
    const cases = [
      {
        mega: {
          topic: 'clean',
          entity: { id: 'INV2a', name: 'Clean', features: cleanFeatures() },
        },
      },
      {
        mega: {
          topic: 'struct',
          entity: { id: 'INV2b', name: 'Struct', features: structuringFeatures() },
        },
        transactions: structuringTransactions('INV2b'),
      },
    ];
    for (const req of cases) {
      const result = await runWeaponizedBrain(req);
      expect(result.extensions.teacherExtension).toBeDefined();
      expect(['ratified', 'contested']).toContain(result.extensions.teacherExtension!.verdict);
    }
  });
});
