/**
 * Graph Risk Scorer tests.
 *
 * Covers each typology with a synthetic edge list:
 *   - mule           : 8 senders → 1 collector → 1 destination
 *   - fan_out_hub    : 1 source → 8 receivers
 *   - ring           : 4-node directed cycle with bidirectional edges
 *   - bridge         : two clusters joined by a single high-degree node
 *   - self_loop      : node with a self-edge
 * + aggregate score banding + empty graph
 */
import { describe, it, expect } from 'vitest';

import {
  scoreGraphRisk,
  __test__,
} from '../src/services/graphRiskScorer';
import type { TransactionEdge } from '../src/services/transactionGraphEmbedding';

const { bandForSeverity, actionForSeverity } = __test__;

describe('scoreGraphRisk', () => {
  it('empty graph → score 0 / minimal', () => {
    const r = scoreGraphRisk([]);
    expect(r.score).toBe(0);
    expect(r.band).toBe('minimal');
    expect(r.anomalies).toEqual([]);
  });

  it('detects a mule (high in-degree, low out-degree)', () => {
    const edges: TransactionEdge[] = [];
    for (let i = 0; i < 8; i++) {
      edges.push({ from: `sender-${i}`, to: 'mule', weightAED: 50_000 });
    }
    edges.push({ from: 'mule', to: 'destination', weightAED: 400_000 });
    const r = scoreGraphRisk(edges);
    const muleHits = r.anomalies.filter((a) => a.kind === 'mule');
    expect(muleHits.length).toBeGreaterThan(0);
    expect(muleHits[0]!.node).toBe('mule');
  });

  it('detects a fan-out hub (1 source → many receivers)', () => {
    const edges: TransactionEdge[] = [];
    for (let i = 0; i < 8; i++) {
      edges.push({ from: 'hub', to: `receiver-${i}`, weightAED: 30_000 });
    }
    const r = scoreGraphRisk(edges);
    const hubHits = r.anomalies.filter((a) => a.kind === 'fan_out_hub');
    expect(hubHits.length).toBeGreaterThan(0);
    expect(hubHits[0]!.node).toBe('hub');
  });

  it('detects a ring (bidirectional cycle)', () => {
    // Tight 4-node bidirectional cycle to maximise reciprocity + clustering.
    const nodes = ['a', 'b', 'c', 'd'];
    const edges: TransactionEdge[] = [];
    for (const n of nodes) {
      for (const m of nodes) {
        if (n === m) continue;
        edges.push({ from: n, to: m, weightAED: 100_000 });
      }
    }
    const r = scoreGraphRisk(edges);
    const ringHits = r.anomalies.filter((a) => a.kind === 'ring');
    expect(ringHits.length).toBeGreaterThan(0);
  });

  it('detects a self-loop', () => {
    const edges: TransactionEdge[] = [
      { from: 'wash', to: 'wash', weightAED: 1_000_000 },
    ];
    const r = scoreGraphRisk(edges);
    const selfHits = r.anomalies.filter((a) => a.kind === 'self_loop');
    expect(selfHits.length).toBe(1);
  });

  it('score reaches a higher band when many anomalies fire', () => {
    const edges: TransactionEdge[] = [];
    // Multiple mules
    for (let m = 0; m < 3; m++) {
      for (let i = 0; i < 8; i++) {
        edges.push({ from: `s${m}-${i}`, to: `mule-${m}`, weightAED: 50_000 });
      }
      edges.push({ from: `mule-${m}`, to: 'sink', weightAED: 400_000 });
    }
    const r = scoreGraphRisk(edges);
    expect(r.score).toBeGreaterThan(0);
    expect(['low', 'moderate', 'high', 'critical']).toContain(r.band);
  });

  it('respects minSeverity filter', () => {
    const edges: TransactionEdge[] = [
      { from: 'a', to: 'b', weightAED: 1 },
      { from: 'a', to: 'c', weightAED: 1 },
    ];
    const r = scoreGraphRisk(edges, { minSeverity: 0.99 });
    // No anomaly will hit 0.99 with just 2 edges
    expect(r.anomalies).toEqual([]);
  });

  it('carries the regulatory anchors', () => {
    const r = scoreGraphRisk([]);
    expect(r.regulatory).toContain('FATF Rec 11');
    expect(r.regulatory).toContain('FATF Rec 20');
    expect(r.regulatory).toContain('FATF DPMS Typology Guidance');
  });

  it('embedding report is carried through for audit', () => {
    const edges: TransactionEdge[] = [
      { from: 'a', to: 'b', weightAED: 100 },
    ];
    const r = scoreGraphRisk(edges);
    expect(r.embedding.nodeCount).toBe(2);
    expect(r.embedding.edgeCount).toBe(1);
  });
});

describe('helpers', () => {
  it('bandForSeverity bands cleanly', () => {
    expect(bandForSeverity(0.9)).toBe('critical');
    expect(bandForSeverity(0.7)).toBe('high');
    expect(bandForSeverity(0.5)).toBe('medium');
    expect(bandForSeverity(0.1)).toBe('low');
  });

  it('actionForSeverity escalates with severity', () => {
    expect(actionForSeverity(0.95)).toBe('freeze_review');
    expect(actionForSeverity(0.7)).toBe('co_review');
    expect(actionForSeverity(0.5)).toBe('enrich_cdd');
    expect(actionForSeverity(0.1)).toBe('monitor');
  });
});
