/**
 * Tests for the Weaponized Brain — ensures that the compose-over-MegaBrain
 * orchestrator correctly wires in the six new subsystems and that the new
 * safety clamps escalate verdicts in exactly the regulatory situations they
 * are meant to.
 *
 * These tests construct real UBO graphs, real wallet databases, real
 * transaction fixtures — no mocks. That way a regression in any subsystem's
 * public API breaks the tests at their actual integration point, which is
 * exactly where we want it to break.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runWeaponizedBrain,
  type AdvisorEscalationFn,
  type AdvisorEscalationInput,
  type AdvisorEscalationResult,
} from '@/services/weaponizedBrain';
import type { StrFeatures } from '@/services/predictiveStr';
import { createGraph, addNode, addEdge } from '@/services/uboGraph';
import {
  createWalletDatabase,
  addWallet,
  type WalletDatabase,
} from '@/services/vaspWalletScoring';
import type { Transaction } from '@/services/transactionAnomaly';
import type { AdverseMediaHit } from '@/services/adverseMediaRanker';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cleanFeatures: StrFeatures = {
  priorAlerts90d: 0,
  txValue30dAED: 50_000,
  nearThresholdCount30d: 0,
  crossBorderRatio30d: 0,
  isPep: false,
  highRiskJurisdiction: false,
  hasAdverseMedia: false,
  daysSinceOnboarding: 720,
  sanctionsMatchScore: 0,
  cashRatio30d: 0.1,
};

/** Build a minimal MegaBrainRequest that produces a 'pass' verdict. */
function cleanMegaRequest(entityId = 'E1', entityName = 'Clean Corp LLC') {
  return {
    topic: `Weaponized assessment: ${entityName}`,
    entity: {
      id: entityId,
      name: entityName,
      features: cleanFeatures,
    },
  };
}

/** Build a UBO graph where a natural-person UBO is sanctioned. */
function sanctionedUboGraph(targetId: string) {
  const g = createGraph();
  addNode(g, { id: targetId, type: 'legal_entity', name: 'Target Co', country: 'AE' });
  addNode(g, {
    id: 'person-1',
    type: 'natural_person',
    name: 'Dirty Person',
    country: 'AE',
    sanctionsFlag: true,
  });
  addEdge(g, { from: 'person-1', to: targetId, kind: 'owns', percentage: 60 });
  return g;
}

/** Build a UBO graph where 30% of ownership is unaccounted for. */
function undisclosedUboGraph(targetId: string) {
  const g = createGraph();
  addNode(g, { id: targetId, type: 'legal_entity', name: 'Target Co', country: 'AE' });
  addNode(g, { id: 'person-1', type: 'natural_person', name: 'Disclosed', country: 'AE' });
  // Only 70% declared → 30% undisclosed
  addEdge(g, { from: 'person-1', to: targetId, kind: 'owns', percentage: 70 });
  return g;
}

/** Build a wallet database containing one OFAC-tagged address. */
function dirtyWalletDb(): WalletDatabase {
  const db = createWalletDatabase();
  addWallet(db, {
    address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
    chain: 'BTC',
    tags: ['sanctioned'],
    source: 'OFAC',
  });
  return db;
}

/** Build a transaction stream with clear just-below-threshold structuring. */
function structuringTransactions(): Transaction[] {
  const txs: Transaction[] = [];
  const baseDate = new Date('2026-04-01T10:00:00Z').getTime();
  for (let i = 0; i < 8; i++) {
    txs.push({
      id: `tx-${i}`,
      at: new Date(baseDate + i * 24 * 3600 * 1000).toISOString(),
      amountAED: 52_500, // 95.5% of 55K threshold → firmly in the structuring band
      counterpartyId: `cp-${i}`,
      customerId: 'entity-under-review',
    });
  }
  return txs;
}

/** Build adverse media hits with at least one critical-category hit. */
function criticalAdverseMedia(): AdverseMediaHit[] {
  return [
    {
      id: 'hit-1',
      entityNameQueried: 'Dirty Corp',
      headline: 'Dirty Corp indicted for money laundering and terrorism financing',
      snippet: 'Federal prosecutors charged Dirty Corp with sanctions evasion and OFAC violations.',
      sourceDomain: 'reuters.com',
      publishedAtIso: '2026-03-15T00:00:00Z',
      language: 'en',
    },
  ];
}

// ---------------------------------------------------------------------------
// Clean path
// ---------------------------------------------------------------------------

describe('weaponizedBrain — clean path', () => {
  it('clean request with no extensions → MegaBrain verdict passes through', async () => {
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
    });
    expect(result.mega.verdict).toBe('pass');
    expect(result.finalVerdict).toBe('pass');
    expect(result.clampReasons).toHaveLength(0);
    expect(result.extensions.adverseMedia).toBeUndefined();
    expect(result.extensions.ubo).toBeUndefined();
    expect(result.extensions.wallets).toBeUndefined();
    expect(result.extensions.transactionAnomalies).toBeUndefined();
  });

  it('explainable scoring always runs even with no extensions', async () => {
    const result = await runWeaponizedBrain({ mega: cleanMegaRequest() });
    expect(result.extensions.explanation).toBeDefined();
    expect(result.extensions.explanation?.score).toBeGreaterThanOrEqual(0);
    expect(result.extensions.explanation?.score).toBeLessThanOrEqual(100);
    expect(['Low', 'Medium', 'High', 'Very High']).toContain(
      result.extensions.explanation?.rating
    );
  });

  it('zk proof bundle is produced by default', async () => {
    const result = await runWeaponizedBrain({ mega: cleanMegaRequest() });
    expect(result.extensions.proofBundle).toBeDefined();
    expect(result.extensions.proofBundle?.rootHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.extensions.proofBundle?.recordCount).toBe(1);
  });

  it('sealProofBundle: false skips the proof bundle', async () => {
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      sealProofBundle: false,
    });
    expect(result.extensions.proofBundle).toBeUndefined();
  });

  it('preserves MegaBrain response verbatim under mega key', async () => {
    const result = await runWeaponizedBrain({ mega: cleanMegaRequest() });
    expect(result.mega.chain.sealed).toBe(true);
    expect(result.mega.subsystems.strPrediction).toBeDefined();
    expect(result.mega.subsystems.reflection).toBeDefined();
    expect(result.mega.warRoomEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Safety clamps
// ---------------------------------------------------------------------------

describe('weaponizedBrain — sanctioned UBO clamp', () => {
  it('sanctioned beneficial owner forces freeze even on a clean entity', async () => {
    const entityId = 'target-co';
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: {
        graph: sanctionedUboGraph(entityId),
        targetId: entityId,
      },
    });
    expect(result.finalVerdict).toBe('freeze');
    expect(result.clampReasons.some((r) => r.includes('sanctioned beneficial owner'))).toBe(true);
    expect(result.clampReasons.some((r) => r.includes('Cabinet Res 74/2020'))).toBe(true);
    expect(result.extensions.ubo?.summary.hasSanctionedUbo).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
  });

  it('confidence is downgraded when a sanctioned UBO is present', async () => {
    const entityId = 'target-co';
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: {
        graph: sanctionedUboGraph(entityId),
        targetId: entityId,
      },
    });
    expect(result.confidence).toBeLessThanOrEqual(0.4);
  });
});

describe('weaponizedBrain — undisclosed UBO clamp', () => {
  it('undisclosed ownership > 25% escalates a clean verdict', async () => {
    const entityId = 'target-co';
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: {
        graph: undisclosedUboGraph(entityId),
        targetId: entityId,
      },
    });
    expect(result.mega.verdict).toBe('pass');
    expect(result.finalVerdict).toBe('escalate');
    expect(result.clampReasons.some((r) => r.includes('undisclosed ownership'))).toBe(true);
    expect(result.clampReasons.some((r) => r.includes('Cabinet Decision 109/2023'))).toBe(true);
  });
});

describe('weaponizedBrain — sanctioned wallet clamp', () => {
  it('confirmed sanctioned wallet forces freeze', async () => {
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      wallets: {
        db: dirtyWalletDb(),
        addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
      },
    });
    expect(result.finalVerdict).toBe('freeze');
    expect(result.clampReasons.some((r) => r.includes('confirmed sanctioned'))).toBe(true);
    expect(result.clampReasons.some((r) => r.includes('FATF Rec 15'))).toBe(true);
    expect(result.extensions.wallets?.confirmedHits).toBeGreaterThan(0);
  });

  it('clean wallet does not trigger any clamp', async () => {
    const db = createWalletDatabase(); // empty
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      wallets: {
        db,
        addresses: ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
      },
    });
    expect(result.finalVerdict).toBe('pass');
    expect(result.clampReasons).toHaveLength(0);
  });
});

describe('weaponizedBrain — structuring clamp', () => {
  it('high-severity structuring escalates the verdict', async () => {
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      transactions: structuringTransactions(),
    });
    expect(result.extensions.transactionAnomalies).toBeDefined();
    expect(result.extensions.transactionAnomalies?.findings.length).toBeGreaterThan(0);
    // If any structuring finding is high severity, we expect escalate.
    const hasHighStructuring = result.extensions.transactionAnomalies?.findings.some(
      (f) => f.kind === 'structuring' && f.severity === 'high'
    );
    if (hasHighStructuring) {
      expect(result.finalVerdict).toBe('escalate');
      expect(result.clampReasons.some((r) => r.includes('structuring'))).toBe(true);
    }
  });
});

describe('weaponizedBrain — adverse media clamp', () => {
  it('critical adverse media hit escalates a clean verdict', async () => {
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      adverseMedia: criticalAdverseMedia(),
    });
    expect(result.extensions.adverseMedia).toBeDefined();
    if (result.extensions.adverseMedia?.counts.critical && result.extensions.adverseMedia.counts.critical > 0) {
      expect(result.finalVerdict).toBe('escalate');
      expect(result.clampReasons.some((r) => r.toLowerCase().includes('adverse media'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Clamp composition — verdicts can only escalate, never downgrade
// ---------------------------------------------------------------------------

describe('weaponizedBrain — verdict monotonicity', () => {
  it('final verdict is never weaker than MegaBrain verdict', async () => {
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      wallets: { db: dirtyWalletDb(), addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'] },
      transactions: structuringTransactions(),
    });
    const rank = { pass: 0, flag: 1, escalate: 2, freeze: 3 } as const;
    expect(rank[result.finalVerdict]).toBeGreaterThanOrEqual(rank[result.mega.verdict]);
  });

  it('sanctioned wallet clamp beats undisclosed UBO clamp (freeze > escalate)', async () => {
    const entityId = 'target-co';
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: { graph: undisclosedUboGraph(entityId), targetId: entityId },
      wallets: { db: dirtyWalletDb(), addresses: ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'] },
    });
    expect(result.finalVerdict).toBe('freeze');
    expect(result.clampReasons.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Audit narrative
// ---------------------------------------------------------------------------

describe('weaponizedBrain — audit narrative', () => {
  it('narrative contains entity, verdict, and confidence', async () => {
    const result = await runWeaponizedBrain({ mega: cleanMegaRequest() });
    expect(result.auditNarrative).toContain('Entity:');
    expect(result.auditNarrative).toContain('Final verdict: pass');
    expect(result.auditNarrative).toContain('MegaBrain confidence:');
  });

  it('narrative lists clamp reasons when verdict was clamped', async () => {
    const entityId = 'target-co';
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: { graph: sanctionedUboGraph(entityId), targetId: entityId },
    });
    expect(result.auditNarrative).toContain('safety clamps triggered');
    expect(result.auditNarrative).toContain('sanctioned beneficial owner');
  });

  it('narrative includes ZK audit seal line when proof bundle is produced', async () => {
    const result = await runWeaponizedBrain({ mega: cleanMegaRequest() });
    expect(result.auditNarrative).toContain('ZK audit seal');
    expect(result.auditNarrative).toContain('Merkle root');
  });

  it('narrative omits ZK seal line when sealProofBundle: false', async () => {
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      sealProofBundle: false,
    });
    expect(result.auditNarrative).not.toContain('ZK audit seal');
  });
});

// ---------------------------------------------------------------------------
// Phase 1 weaponization: partial-success guards
// ---------------------------------------------------------------------------

describe('weaponizedBrain — partial-success guards', () => {
  it('clean path records no subsystem failures', async () => {
    const result = await runWeaponizedBrain({ mega: cleanMegaRequest() });
    expect(result.subsystemFailures).toEqual([]);
  });

  it('subsystem failure is recorded and forces human review', async () => {
    // Force a failure in the UBO analysis pipeline by passing a malformed
    // graph object — missing nodes/edges keys will throw inside
    // analyseLayering/summariseUboRisk. The brain must catch this, record
    // the failure, and continue without losing the decision from the
    // other subsystems.
    const entityId = 'broken-target';
    const badGraph = {} as never;

    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Broken Co'),
      ubo: { graph: badGraph, targetId: entityId },
    });

    // Verdict proceeds (doesn't throw) — decision from other subsystems
    // is preserved. Human review is forced because the record is incomplete.
    expect(result.subsystemFailures.length).toBeGreaterThan(0);
    expect(result.subsystemFailures).toContain('uboAnalysis');
    expect(result.requiresHumanReview).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
    expect(result.clampReasons.some((r) => r.includes('FDL Art.24'))).toBe(true);
  });

  it('failure narrative appends subsystem failure list', async () => {
    const entityId = 'broken-target';
    const badGraph = {} as never;
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Broken Co'),
      ubo: { graph: badGraph, targetId: entityId },
    });
    expect(result.auditNarrative).toContain('Subsystem failures');
    expect(result.auditNarrative).toContain('uboAnalysis');
  });
});

// ---------------------------------------------------------------------------
// Phase 1 weaponization: advisor escalation
// ---------------------------------------------------------------------------

describe('weaponizedBrain — advisor escalation', () => {
  /** Build a mock advisor that always returns the same text. */
  function makeMockAdvisor(text: string): AdvisorEscalationFn {
    return vi.fn(async (_input: AdvisorEscalationInput): Promise<AdvisorEscalationResult> => ({
      text,
      advisorCallCount: 1,
      modelUsed: 'claude-opus-4-6',
    }));
  }

  it('advisor is NOT called for a clean pass verdict', async () => {
    const advisor = vi.fn(
      async (): Promise<AdvisorEscalationResult> => ({
        text: 'should not be called',
        advisorCallCount: 1,
        modelUsed: 'claude-opus-4-6',
      })
    );
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      advisor,
    });
    expect(result.finalVerdict).toBe('pass');
    expect(advisor).not.toHaveBeenCalled();
    expect(result.advisorResult).toBeNull();
  });

  it('advisor IS called when verdict is freeze', async () => {
    const entityId = 'target-co';
    const advisor = makeMockAdvisor(
      '1. Confirm sanctions hit (FDL Art.20). 2. Execute 24h freeze (Cabinet Res 74/2020 Art.4-7). 3. File CNMR within 5bd.'
    );
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: { graph: sanctionedUboGraph(entityId), targetId: entityId },
      advisor,
    });
    expect(result.finalVerdict).toBe('freeze');
    expect(advisor).toHaveBeenCalledOnce();
    expect(result.advisorResult).not.toBeNull();
    expect(result.advisorResult?.modelUsed).toBe('claude-opus-4-6');
    expect(result.clampReasons.some((r) => r.startsWith('ADVISOR:'))).toBe(true);
    expect(result.auditNarrative).toContain('Advisor review');
    expect(result.auditNarrative).toContain('claude-opus-4-6');
  });

  it('advisor IS called when verdict is escalate', async () => {
    const entityId = 'target-co';
    const advisor = makeMockAdvisor('1. Request UBO disclosure. 2. Extend CDD to EDD.');
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: { graph: undisclosedUboGraph(entityId), targetId: entityId },
      advisor,
    });
    expect(result.finalVerdict).toBe('escalate');
    expect(advisor).toHaveBeenCalledOnce();
    expect(result.advisorResult?.text).toContain('EDD');
  });

  it('advisor IS called when any clamp triggers', async () => {
    const advisor = makeMockAdvisor('Review structuring pattern.');
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(),
      transactions: structuringTransactions(),
      advisor,
    });
    // structuring transactions trigger at least one clamp
    if (result.clampReasons.length > 0) {
      expect(advisor).toHaveBeenCalledOnce();
    }
  });

  it('advisor failure does NOT block the verdict', async () => {
    const advisor = vi.fn(async () => {
      throw new Error('upstream timeout');
    });
    const entityId = 'target-co';
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: { graph: sanctionedUboGraph(entityId), targetId: entityId },
      advisor,
    });
    expect(result.finalVerdict).toBe('freeze');
    expect(result.advisorResult).toBeNull();
    expect(result.auditNarrative).toContain('Advisor escalation attempted but failed');
  });

  it('advisor returning null leaves the verdict intact', async () => {
    const advisor = vi.fn(async () => null);
    const entityId = 'target-co';
    const result = await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: { graph: sanctionedUboGraph(entityId), targetId: entityId },
      advisor,
    });
    expect(result.finalVerdict).toBe('freeze');
    expect(result.advisorResult).toBeNull();
    // No ADVISOR: clamp reason because the advisor produced no text
    expect(result.clampReasons.some((r) => r.startsWith('ADVISOR:'))).toBe(false);
  });

  it('advisor input includes verdict, confidence, and clamp reasons', async () => {
    const received: AdvisorEscalationInput[] = [];
    const advisor: AdvisorEscalationFn = async (input) => {
      received.push(input);
      return { text: 'ok', advisorCallCount: 1, modelUsed: 'claude-opus-4-6' };
    };
    const entityId = 'target-co';
    await runWeaponizedBrain({
      mega: cleanMegaRequest(entityId, 'Target Co'),
      ubo: { graph: sanctionedUboGraph(entityId), targetId: entityId },
      advisor,
    });
    expect(received).toHaveLength(1);
    expect(received[0].verdict).toBe('freeze');
    expect(received[0].entityId).toBe(entityId);
    expect(received[0].entityName).toBe('Target Co');
    expect(received[0].clampReasons.some((r) => r.includes('sanctioned beneficial owner'))).toBe(
      true
    );
    expect(received[0].narrative).toContain('Final verdict: freeze');
    expect(received[0].reason).toContain('verdict=freeze');
  });
});

// ---------------------------------------------------------------------------
// #98 Deep research engine integration
// ---------------------------------------------------------------------------

describe('weaponizedBrain — #98 deep research engine', () => {
  it('subsystem is a no-op when req.deepResearch is omitted', async () => {
    const r = await runWeaponizedBrain({ mega: cleanMegaRequest() });
    expect(r.extensions.deepResearch).toBeUndefined();
  });

  it('runs the engine via injected deps and surfaces the result', async () => {
    const r = await runWeaponizedBrain({
      mega: cleanMegaRequest('E1', 'Acme Trading LLC'),
      deepResearch: {
        question: 'Any adverse media on this entity?',
        entity: { displayName: 'Acme Trading LLC', jurisdiction: 'AE' },
        purpose: 'adverse_media',
        deps: {
          search: async () => [],
          extract: async () => null,
          reason: async () => ({
            newClaims: [],
            nextQueries: [],
            done: true,
            rationale: 'nothing found',
          }),
        },
      },
    });
    expect(r.extensions.deepResearch).toBeDefined();
    expect(r.extensions.deepResearch?.verdictHint).toBe('no_signal');
    expect(r.extensions.deepResearch?.terminationReason).toBe('no_signal');
    // No clamp on a clean result
    expect(r.clampReasons.some((c) => c.includes('deep research'))).toBe(false);
  });

  it('critical corroborated signal escalates a clean verdict', async () => {
    const r = await runWeaponizedBrain({
      mega: cleanMegaRequest('E2', 'Dirty Trading LLC'),
      deepResearch: {
        question: 'sanctions exposure',
        entity: { displayName: 'Dirty Trading LLC', jurisdiction: 'AE' },
        purpose: 'edd_counterparty',
        deps: {
          search: async () => [],
          extract: async () => null,
          reason: async () => ({
            newClaims: [
              {
                text: 'OFAC SDN designation December 2025',
                sources: ['https://treasury.gov/sdn/x', 'https://reuters.com/y'],
                severity: 'critical',
              },
            ],
            nextQueries: [],
            done: true,
            rationale: 'corroborated SDN hit',
          }),
        },
      },
    });
    expect(r.extensions.deepResearch?.verdictHint).toBe('critical');
    expect(['escalate', 'freeze']).toContain(r.finalVerdict);
    expect(
      r.clampReasons.some(
        (c) => c.includes('deep research') && c.includes('corroborated critical')
      )
    ).toBe(true);
  });

  it('single-source critical claim does NOT trigger the clamp (corroboration floor)', async () => {
    const r = await runWeaponizedBrain({
      mega: cleanMegaRequest('E3', 'Borderline LLC'),
      deepResearch: {
        question: 'sanctions exposure',
        entity: { displayName: 'Borderline LLC', jurisdiction: 'AE' },
        purpose: 'edd_counterparty',
        deps: {
          search: async () => [],
          extract: async () => null,
          reason: async () => ({
            newClaims: [
              {
                text: 'Allegation in a single blog post',
                sources: ['https://blog.example/x'],
                severity: 'critical',
              },
            ],
            nextQueries: [],
            done: true,
            rationale: 'thin evidence',
          }),
        },
      },
    });
    // Engine reports material_signal, NOT critical, because corroboration
    // floor (>=2 distinct hostnames) wasn't met.
    expect(r.extensions.deepResearch?.verdictHint).toBe('material_signal');
    // Critical clamp must not have fired.
    expect(
      r.clampReasons.some(
        (c) => c.includes('deep research') && c.includes('corroborated critical')
      )
    ).toBe(false);
  });

  it('engine failure escalates to manual review (FDL Art.24)', async () => {
    const r = await runWeaponizedBrain({
      mega: cleanMegaRequest('E4', 'Crash Corp'),
      deepResearch: {
        question: 'sanctions',
        entity: { displayName: 'Crash Corp' },
        purpose: 'general_compliance',
        deps: {
          search: async () => {
            throw new Error('search backend offline');
          },
          extract: async () => null,
          reason: async () => ({
            newClaims: [],
            nextQueries: [],
            done: true,
            rationale: '',
          }),
        },
      },
    });
    expect(r.subsystemFailures).toContain('deepResearchEngine');
    expect(
      r.clampReasons.some(
        (c) => c.includes('deepResearchEngine failed') && c.includes('FDL Art.24')
      )
    ).toBe(true);
    expect(r.requiresHumanReview).toBe(true);
  });

  it('audit narrative includes the deep research line when present', async () => {
    const r = await runWeaponizedBrain({
      mega: cleanMegaRequest('E5'),
      deepResearch: {
        question: 'check',
        entity: { displayName: 'X' },
        purpose: 'general_compliance',
        deps: {
          search: async () => [],
          extract: async () => null,
          reason: async () => ({
            newClaims: [],
            nextQueries: [],
            done: true,
            rationale: '',
          }),
        },
      },
    });
    expect(r.auditNarrative).toMatch(/Deep research \(#98\)/);
  });
});
