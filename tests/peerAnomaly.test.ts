import { describe, it, expect } from 'vitest';
import { analysePeerAnomaly } from '@/services/peerAnomaly';

describe('peerAnomaly — basic', () => {
  it('flags features more than 2σ from peer mean', () => {
    const peers = [
      { cashRatio: 0.1, txCount: 10 },
      { cashRatio: 0.15, txCount: 12 },
      { cashRatio: 0.12, txCount: 11 },
      { cashRatio: 0.11, txCount: 13 },
    ];
    const target = { cashRatio: 0.9, txCount: 12 };
    const report = analysePeerAnomaly({ target, peers });
    expect(report.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(report.anomalies[0].feature).toBe('cashRatio');
    expect(report.anomalies[0].zScore).toBeGreaterThan(2);
    expect(report.anomalies[0].direction).toBe('higher');
  });

  it('does not flag features within threshold', () => {
    const peers = [
      { cashRatio: 0.1 },
      { cashRatio: 0.11 },
      { cashRatio: 0.12 },
    ];
    const target = { cashRatio: 0.115 };
    const report = analysePeerAnomaly({ target, peers });
    expect(report.anomalies).toHaveLength(0);
  });

  it('includes regulatory anchor when provided', () => {
    const peers = [
      { cashRatio: 0.1 },
      { cashRatio: 0.1 },
      { cashRatio: 0.11 },
    ];
    const report = analysePeerAnomaly({
      target: { cashRatio: 0.9 },
      peers,
      anchors: { cashRatio: 'MoE Circular 08/AML/2021' },
    });
    expect(report.anomalies[0].regulatoryAnchor).toBe('MoE Circular 08/AML/2021');
    expect(report.anomalies[0].explanation).toContain('MoE');
  });

  it('computes anomaly rank within peer group', () => {
    const peers = [
      { cash: 0.1 },
      { cash: 0.11 },
      { cash: 0.12 },
      { cash: 0.13 },
    ];
    const report = analysePeerAnomaly({ target: { cash: 0.9 }, peers });
    expect(report.anomalyRank).toBe(1);
    expect(report.numPeers).toBe(4);
  });

  it('target near peer centroid ranks last', () => {
    const peers = [
      { cash: 0.05 },
      { cash: 0.3 },
      { cash: 0.25 },
      { cash: 0.4 },
    ];
    const report = analysePeerAnomaly({ target: { cash: 0.25 }, peers });
    // target is roughly at the mean, should have low overall score
    expect(report.overallScore).toBeLessThan(1);
  });

  it('explanation composes top-3 drivers', () => {
    const peers = [
      { a: 0.1, b: 0.1, c: 0.1 },
      { a: 0.11, b: 0.1, c: 0.1 },
      { a: 0.12, b: 0.11, c: 0.1 },
      { a: 0.13, b: 0.1, c: 0.1 },
    ];
    const report = analysePeerAnomaly({
      target: { a: 0.9, b: 0.9, c: 0.9 },
      peers,
    });
    expect(report.explanation).toMatch(/Primary drivers/);
  });
});
