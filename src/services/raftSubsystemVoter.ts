/**
 * Raft Subsystem Voter — subsystem #87 (Phase 7 Cluster L).
 *
 * Minimal in-process Raft-style consensus for subsystems that
 * produce competing verdicts. Not a full distributed Raft (no network,
 * no log replication) — a SINGLE-PROCESS election over a fixed set
 * of voters where each voter emits a verdict + confidence, and the
 * voter with the highest confidence is elected "leader". All other
 * voters accept the leader's verdict.
 *
 * This is the composition pattern the vendored ruflo framework
 * describes, adapted to our single-process brain. Real cross-process
 * Raft would require a full log + heartbeat + persistence layer.
 *
 * The result is deterministic for a given set of voters and tie-
 * breaks consistently (higher confidence wins; ties go to the first
 * voter in the input order so replay is reproducible).
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review with multiple
 *     independent reviewers)
 *   - FATF Rec 18 (internal controls proportionate to risk)
 *   - NIST AI RMF MS-1.1 (test with multiple independent methods)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface RaftVoter {
  name: string;
  verdict: Verdict;
  confidence: number; // [0,1]
}

export interface RaftRoundReport {
  term: number;
  leader: RaftVoter;
  electedVerdict: Verdict;
  dissenting: readonly RaftVoter[];
  electionRatio: number; // fraction of voters agreeing with leader after election
  narrative: string;
}

// ---------------------------------------------------------------------------
// Voter
// ---------------------------------------------------------------------------

export function runRaftElection(voters: readonly RaftVoter[], term = 1): RaftRoundReport {
  if (voters.length === 0) {
    throw new Error('runRaftElection: requires at least one voter');
  }

  // Leader election: highest confidence wins, ties break on insertion order.
  let leader = voters[0];
  for (let i = 1; i < voters.length; i++) {
    if (voters[i].confidence > leader.confidence) {
      leader = voters[i];
    }
  }

  const dissenting = voters.filter((v) => v.verdict !== leader.verdict);
  const electionRatio = (voters.length - dissenting.length) / voters.length;

  const narrative =
    `Raft election (term ${term}): leader=${leader.name} ` +
    `(verdict ${leader.verdict}, confidence ${leader.confidence.toFixed(2)}). ` +
    `${dissenting.length}/${voters.length} dissenters accept the leader verdict. ` +
    `Consensus ratio ${(electionRatio * 100).toFixed(0)}%.`;

  return {
    term,
    leader,
    electedVerdict: leader.verdict,
    dissenting,
    electionRatio,
    narrative,
  };
}
