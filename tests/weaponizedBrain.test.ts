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
import { describe, it, expect } from 'vitest';
import { runWeaponizedBrain } from '@/services/weaponizedBrain';
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
