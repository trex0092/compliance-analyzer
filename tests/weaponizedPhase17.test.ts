/**
 * Unit tests for Weaponized Phase 17 regulator-surface weapons.
 */
import { describe, it, expect } from 'vitest';
import {
  runAdverseMediaHotIngest,
  anchorToMerkleChain,
  mirrorNarrativeArEn,
  compileRegulatorReadyPdfManifest,
  detectFundFlowPattern,
  type AdverseMediaItem,
  type AdverseMediaWatchEntry,
  type EvidenceRecord,
  type EvidenceHasher,
  type RegulatorArtefactPresence,
  type FundFlowEdge,
} from '@/services/weaponizedPhase17';

// ---------------------------------------------------------------------------
// 1. runAdverseMediaHotIngest
// ---------------------------------------------------------------------------

describe('runAdverseMediaHotIngest', () => {
  const now = new Date('2026-04-16T00:00:00Z');

  it('flags a recent adverse-keyword hit on a watchlist name', () => {
    const items: AdverseMediaItem[] = [
      {
        id: 'art1',
        title: 'ACME CORP indicted on money-laundering charges',
        source: 'reuters.com',
        publishedAtIso: '2026-04-10T00:00:00Z',
        body: 'ACME CORP is accused of laundering funds through a shell network.',
      },
    ];
    const watch: AdverseMediaWatchEntry[] = [{ entityId: 'e1', name: 'ACME CORP' }];
    const out = runAdverseMediaHotIngest({ items, watchlist: watch, asOf: now });
    expect(out.hits).toHaveLength(1);
    expect(out.hits[0].entityId).toBe('e1');
    expect(out.hits[0].relevance).toBeGreaterThanOrEqual(0.8);
    expect(out.highRelevanceCount).toBe(1);
    expect(out.narrative).toMatch(/FATF Rec 10/);
  });

  it('ignores items without a name match', () => {
    const items: AdverseMediaItem[] = [
      {
        id: 'art2',
        title: 'Unrelated story about fraud',
        source: 'reuters.com',
        publishedAtIso: '2026-04-10T00:00:00Z',
        body: 'Somebody else committed fraud.',
      },
    ];
    const out = runAdverseMediaHotIngest({
      items,
      watchlist: [{ entityId: 'e1', name: 'ACME CORP' }],
      asOf: now,
    });
    expect(out.hits).toEqual([]);
  });

  it('dedupes the same (item, entity) combination', () => {
    const items: AdverseMediaItem[] = [
      {
        id: 'art3',
        title: 'ACME CORP and Acme Corp mentioned together',
        source: 'x.com',
        publishedAtIso: '2026-04-15T00:00:00Z',
        body: 'Acme Corp. (also: ACME CORP) sanctioned.',
      },
    ];
    const watch: AdverseMediaWatchEntry[] = [
      { entityId: 'e1', name: 'ACME CORP', aliases: ['Acme Corp'] },
    ];
    const out = runAdverseMediaHotIngest({ items, watchlist: watch, asOf: now });
    // Even though the name appears twice in the body, we dedupe per (item, entity).
    expect(out.hits).toHaveLength(1);
  });

  it('scales relevance down for older items', () => {
    const old: AdverseMediaItem = {
      id: 'art-old',
      title: 'ACME fraud story',
      source: 'x.com',
      publishedAtIso: '2025-01-01T00:00:00Z', // > 90 days
      body: 'fraud at acme',
    };
    const fresh: AdverseMediaItem = {
      id: 'art-fresh',
      title: 'ACME fraud story',
      source: 'x.com',
      publishedAtIso: '2026-04-10T00:00:00Z',
      body: 'fraud at acme',
    };
    const watch: AdverseMediaWatchEntry[] = [{ entityId: 'e1', name: 'acme' }];
    const oldHit = runAdverseMediaHotIngest({ items: [old], watchlist: watch, asOf: now });
    const freshHit = runAdverseMediaHotIngest({ items: [fresh], watchlist: watch, asOf: now });
    expect(freshHit.hits[0].relevance).toBeGreaterThan(oldHit.hits[0].relevance);
  });
});

// ---------------------------------------------------------------------------
// 2. anchorToMerkleChain
// ---------------------------------------------------------------------------

describe('anchorToMerkleChain', () => {
  // Simple deterministic hasher for tests. NOT for production.
  const testHasher: EvidenceHasher = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  };

  it('produces a deterministic root for the same input', () => {
    const records: EvidenceRecord[] = [
      { id: 'r1', payload: '{"v":1}' },
      { id: 'r2', payload: '{"v":2}' },
    ];
    const a = anchorToMerkleChain({ records, hasher: testHasher });
    const b = anchorToMerkleChain({ records, hasher: testHasher });
    expect(a.root).toBe(b.root);
    expect(a.leaves).toEqual(b.leaves);
    expect(a.leafCount).toBe(2);
  });

  it('changes the root when any record changes', () => {
    const r1: EvidenceRecord[] = [
      { id: 'r1', payload: '{"v":1}' },
      { id: 'r2', payload: '{"v":2}' },
    ];
    const r2: EvidenceRecord[] = [
      { id: 'r1', payload: '{"v":1}' },
      { id: 'r2', payload: '{"v":3}' }, // tampered
    ];
    const a = anchorToMerkleChain({ records: r1, hasher: testHasher });
    const b = anchorToMerkleChain({ records: r2, hasher: testHasher });
    expect(a.root).not.toBe(b.root);
  });

  it('handles an odd leaf count by duplicating the last leaf', () => {
    const records: EvidenceRecord[] = [
      { id: 'r1', payload: 'a' },
      { id: 'r2', payload: 'b' },
      { id: 'r3', payload: 'c' },
    ];
    const out = anchorToMerkleChain({ records, hasher: testHasher });
    expect(out.leafCount).toBe(3);
    expect(out.leaves).toHaveLength(3);
    expect(out.root.length).toBeGreaterThan(0);
  });

  it('returns a sentinel root for empty record set', () => {
    const out = anchorToMerkleChain({ records: [], hasher: testHasher });
    expect(out.leafCount).toBe(0);
    expect(out.leaves).toEqual([]);
    expect(out.root).toBe(testHasher('EMPTY_EVIDENCE_SET'));
  });
});

// ---------------------------------------------------------------------------
// 3. mirrorNarrativeArEn
// ---------------------------------------------------------------------------

describe('mirrorNarrativeArEn', () => {
  it('returns complete mirror when both sides are populated', () => {
    const out = mirrorNarrativeArEn({
      en: {
        title: 'Freeze notification',
        subject: 'ACME CORP',
        action: 'Asset freeze executed',
        regulatory_basis: 'Cabinet Res 74/2020 Art.4-7',
        summary: 'Subject frozen pending CNMR.',
      },
      ar: {
        title: 'إشعار تجميد',
        subject: 'شركة أكمي',
        action: 'تم تنفيذ تجميد الأصول',
        regulatory_basis: 'قرار مجلس الوزراء 74/2020 المادة 4-7',
        summary: 'تم تجميد الموضوع بانتظار التقرير.',
      },
    });
    expect(out.complete).toBe(true);
    expect(out.missingFields).toEqual([]);
    expect(out.rows).toHaveLength(5);
  });

  it('reports missing fields when one side has gaps', () => {
    const out = mirrorNarrativeArEn({
      en: { title: 'x', subject: 'y', action: 'z', regulatory_basis: 'r', summary: 's' },
      ar: { title: 'عنوان', subject: '', action: 'فعل', regulatory_basis: 'r', summary: '' },
    });
    expect(out.complete).toBe(false);
    expect(out.missingFields).toContain('subject');
    expect(out.missingFields).toContain('summary');
    expect(out.narrative).toMatch(/INCOMPLETE/);
  });

  it('preserves the canonical field ordering', () => {
    const out = mirrorNarrativeArEn({
      en: { summary: 's', title: 't' },
      ar: { summary: 'ص', title: 'ع' },
    });
    expect(out.rows.map((r) => r.field)).toEqual([
      'title',
      'subject',
      'action',
      'regulatory_basis',
      'summary',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. compileRegulatorReadyPdfManifest
// ---------------------------------------------------------------------------

describe('compileRegulatorReadyPdfManifest', () => {
  const now = new Date('2026-04-16T00:00:00Z');

  it('marks inspection-ready when every artefact is present and fresh', () => {
    const presence: RegulatorArtefactPresence[] = [
      'str-register',
      'screening-log',
      'ubo-register',
      'training-records',
      'policy-signatures',
      'evidence-seals',
      'four-eyes-audit-chain',
      'sanctions-list-snapshot',
    ].map((a) => ({
      artefact: a as RegulatorArtefactPresence['artefact'],
      present: true,
      lastUpdatedIso: '2026-04-10T00:00:00Z',
    }));
    const out = compileRegulatorReadyPdfManifest({ presence, asOf: now });
    expect(out.inspectionReady).toBe(true);
    expect(out.missing).toEqual([]);
    expect(out.stale).toEqual([]);
    expect(out.citation).toMatch(/MoE Circular/);
    expect(out.citation).toMatch(/LBMA RGG/);
  });

  it('flags missing artefacts', () => {
    const presence: RegulatorArtefactPresence[] = [
      { artefact: 'str-register', present: true, lastUpdatedIso: '2026-04-10T00:00:00Z' },
    ];
    const out = compileRegulatorReadyPdfManifest({ presence, asOf: now });
    expect(out.inspectionReady).toBe(false);
    expect(out.missing.length).toBeGreaterThan(0);
    expect(out.missing).toContain('screening-log');
  });

  it('flags stale artefacts older than the freshness threshold', () => {
    const presence: RegulatorArtefactPresence[] = [
      'str-register',
      'screening-log',
      'ubo-register',
      'training-records',
      'policy-signatures',
      'evidence-seals',
      'four-eyes-audit-chain',
      'sanctions-list-snapshot',
    ].map((a) => ({
      artefact: a as RegulatorArtefactPresence['artefact'],
      present: true,
      lastUpdatedIso: '2025-01-01T00:00:00Z', // > 90 days
    }));
    const out = compileRegulatorReadyPdfManifest({ presence, asOf: now });
    expect(out.inspectionReady).toBe(false);
    expect(out.stale.length).toBeGreaterThan(0);
  });

  it('honours a custom freshness window', () => {
    const presence: RegulatorArtefactPresence[] = [
      'str-register',
      'screening-log',
      'ubo-register',
      'training-records',
      'policy-signatures',
      'evidence-seals',
      'four-eyes-audit-chain',
      'sanctions-list-snapshot',
    ].map((a) => ({
      artefact: a as RegulatorArtefactPresence['artefact'],
      present: true,
      lastUpdatedIso: '2026-02-16T00:00:00Z', // ~60 days
    }));
    const tight = compileRegulatorReadyPdfManifest({ presence, asOf: now, freshnessDays: 30 });
    const loose = compileRegulatorReadyPdfManifest({ presence, asOf: now, freshnessDays: 120 });
    expect(tight.stale.length).toBeGreaterThan(0);
    expect(loose.stale).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. detectFundFlowPattern
// ---------------------------------------------------------------------------

describe('detectFundFlowPattern', () => {
  it('detects a round-trip within 7 days', () => {
    const edges: FundFlowEdge[] = [
      { from: 'A', to: 'B', amountAed: 100_000, atIso: '2026-04-10T00:00:00Z', isCash: false },
      { from: 'B', to: 'A', amountAed: 99_000, atIso: '2026-04-13T00:00:00Z', isCash: false },
    ];
    const out = detectFundFlowPattern({ edges });
    const rt = out.findings.find((f) => f.kind === 'round-trip');
    expect(rt).toBeDefined();
    expect(rt!.entities).toEqual(expect.arrayContaining(['A', 'B']));
    expect(out.hasStructuralRisk).toBe(true);
  });

  it('detects a length-3 circular flow', () => {
    const edges: FundFlowEdge[] = [
      { from: 'A', to: 'B', amountAed: 50_000, atIso: '2026-04-10T00:00:00Z', isCash: false },
      { from: 'B', to: 'C', amountAed: 50_000, atIso: '2026-04-11T00:00:00Z', isCash: false },
      { from: 'C', to: 'A', amountAed: 50_000, atIso: '2026-04-12T00:00:00Z', isCash: false },
    ];
    const out = detectFundFlowPattern({ edges });
    const circ = out.findings.find((f) => f.kind === 'circular-flow');
    expect(circ).toBeDefined();
    expect(circ!.entities).toEqual(['A', 'B', 'C']);
    expect(out.hasStructuralRisk).toBe(true);
  });

  it('flags cash-heavy inflection when cash > 60% of inflow', () => {
    const edges: FundFlowEdge[] = [
      { from: 'X', to: 'Y', amountAed: 80_000, atIso: '2026-04-10T00:00:00Z', isCash: true },
      { from: 'Z', to: 'Y', amountAed: 20_000, atIso: '2026-04-10T00:00:00Z', isCash: false },
    ];
    const out = detectFundFlowPattern({ edges });
    const cashInflection = out.findings.find((f) => f.kind === 'cash-inflection');
    expect(cashInflection).toBeDefined();
    expect(cashInflection!.entities).toEqual(['Y']);
    // cash-inflection alone does not escalate to structural risk.
    expect(out.hasStructuralRisk).toBe(false);
  });

  it('returns an empty finding list for a plain A→B edge', () => {
    const edges: FundFlowEdge[] = [
      { from: 'A', to: 'B', amountAed: 1000, atIso: '2026-04-10T00:00:00Z', isCash: false },
    ];
    const out = detectFundFlowPattern({ edges });
    expect(out.findings).toEqual([]);
    expect(out.hasStructuralRisk).toBe(false);
    expect(out.inspected).toBe(1);
  });
});
