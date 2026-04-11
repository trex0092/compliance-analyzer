/**
 * Tests for Phase 7 Cluster L — multi-agent coordination.
 * (L89 gossip skipped — requires multi-region infra.)
 */
import { describe, it, expect } from 'vitest';
import { runRaftElection } from '@/services/raftSubsystemVoter';
import { computeBftConsensus } from '@/services/byzantineFaultTolerant';

// ---------------------------------------------------------------------------
// #87 raftSubsystemVoter
// ---------------------------------------------------------------------------

describe('raftSubsystemVoter', () => {
  it('elects the highest-confidence voter as leader', () => {
    const report = runRaftElection([
      { name: 'sysA', verdict: 'pass', confidence: 0.6 },
      { name: 'sysB', verdict: 'escalate', confidence: 0.9 },
      { name: 'sysC', verdict: 'flag', confidence: 0.7 },
    ]);
    expect(report.leader.name).toBe('sysB');
    expect(report.electedVerdict).toBe('escalate');
    expect(report.dissenting.length).toBe(2);
  });

  it('single voter elects itself', () => {
    const report = runRaftElection([
      { name: 'solo', verdict: 'freeze', confidence: 0.95 },
    ]);
    expect(report.leader.name).toBe('solo');
    expect(report.electionRatio).toBe(1);
  });

  it('ties break on insertion order', () => {
    const report = runRaftElection([
      { name: 'first', verdict: 'pass', confidence: 0.8 },
      { name: 'second', verdict: 'freeze', confidence: 0.8 },
    ]);
    expect(report.leader.name).toBe('first');
  });

  it('empty voter list throws', () => {
    expect(() => runRaftElection([])).toThrow(/requires at least one voter/);
  });
});

// ---------------------------------------------------------------------------
// #88 byzantineFaultTolerant
// ---------------------------------------------------------------------------

describe('byzantineFaultTolerant', () => {
  it('reaches consensus when 3 of 4 sources agree', () => {
    const r = computeBftConsensus([
      { source: 'UN', value: 'freeze' },
      { source: 'OFAC', value: 'freeze' },
      { source: 'EU', value: 'freeze' },
      { source: 'COMPROMISED', value: 'pass' },
    ]);
    expect(r.sufficientConsensus).toBe(true);
    expect(r.winner).toBe('freeze');
    expect(r.quorum).toBe(3);
  });

  it('insufficient consensus when no value has 2f+1', () => {
    const r = computeBftConsensus([
      { source: 'A', value: 'freeze' },
      { source: 'B', value: 'escalate' },
      { source: 'C', value: 'flag' },
      { source: 'D', value: 'pass' },
    ]);
    expect(r.sufficientConsensus).toBe(false);
    expect(r.winner).toBeNull();
  });

  it('unanimous vote is always sufficient', () => {
    const r = computeBftConsensus([
      { source: 'A', value: 'pass' },
      { source: 'B', value: 'pass' },
      { source: 'C', value: 'pass' },
      { source: 'D', value: 'pass' },
    ]);
    expect(r.sufficientConsensus).toBe(true);
    expect(r.winner).toBe('pass');
  });

  it('supports custom equality via compare', () => {
    const r = computeBftConsensus<{ score: number }>(
      [
        { source: 'A', value: { score: 5 } },
        { source: 'B', value: { score: 5 } },
        { source: 'C', value: { score: 5 } },
        { source: 'D', value: { score: 99 } },
      ],
      (a, b) => a.score === b.score
    );
    expect(r.sufficientConsensus).toBe(true);
    expect(r.winner?.score).toBe(5);
  });

  it('empty votes returns no consensus', () => {
    const r = computeBftConsensus([]);
    expect(r.sufficientConsensus).toBe(false);
    expect(r.winner).toBeNull();
  });
});
