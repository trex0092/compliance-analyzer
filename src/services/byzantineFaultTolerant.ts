/**
 * Byzantine Fault Tolerant Voter — subsystem #88 (Phase 7 Cluster L).
 *
 * Byzantine fault tolerance for subsystems that depend on EXTERNAL
 * data sources (sanctions API, PEP DB, Companies House). Any single
 * source can be compromised — the API could be served by an attacker,
 * the data could be stale, or a feed could silently drop entries.
 * BFT voting tolerates up to f faulty sources out of 3f+1 total, so
 * one compromised source cannot flip the verdict.
 *
 * Minimal in-process implementation: takes N independent source
 * results for the same query, counts how many agree with each
 * possible outcome, and declares a winner if >= 2f+1 sources agree.
 * If no outcome has >= 2f+1 votes, the report is "insufficient
 * consensus" and the brain falls back to human review.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review — multi-source)
 *   - NIST AI RMF GV-1.6 (security — tolerating compromised sources)
 *   - FATF Rec 6 (UN primacy + cross-list validation)
 *   - EU AI Act Art.15 (robustness against adversarial inputs)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BftVote<T> {
  source: string;
  value: T;
}

export interface BftConsensusReport<T> {
  winner: T | null;
  votes: number;
  totalVotes: number;
  quorum: number;
  maxFaults: number;
  sufficientConsensus: boolean;
  distribution: ReadonlyArray<{ value: T; sources: readonly string[] }>;
  narrative: string;
}

// ---------------------------------------------------------------------------
// BFT consensus
// ---------------------------------------------------------------------------

export function computeBftConsensus<T>(
  votes: readonly BftVote<T>[],
  compare: (a: T, b: T) => boolean = (a, b) => a === b
): BftConsensusReport<T> {
  if (votes.length === 0) {
    return {
      winner: null,
      votes: 0,
      totalVotes: 0,
      quorum: 0,
      maxFaults: 0,
      sufficientConsensus: false,
      distribution: [],
      narrative: 'BFT consensus: no votes submitted.',
    };
  }

  // For N total sources, max tolerable faults f = floor((N-1)/3).
  // Quorum is 2f+1.
  const n = votes.length;
  const maxFaults = Math.floor((n - 1) / 3);
  const quorum = 2 * maxFaults + 1;

  // Group by value.
  const groups: Array<{ value: T; sources: string[] }> = [];
  for (const vote of votes) {
    let group = groups.find((g) => compare(g.value, vote.value));
    if (!group) {
      group = { value: vote.value, sources: [] };
      groups.push(group);
    }
    group.sources.push(vote.source);
  }
  groups.sort((a, b) => b.sources.length - a.sources.length);

  const top = groups[0];
  const sufficient = top.sources.length >= quorum;

  const narrative = sufficient
    ? `BFT consensus reached: ${top.sources.length}/${n} sources agree on winner, ` +
      `quorum ${quorum} (max faults tolerated ${maxFaults}).`
    : `BFT consensus INSUFFICIENT: top value has ${top.sources.length}/${n} votes, ` +
      `quorum requires ${quorum}. Falling back to human review per Cabinet Res 134/2025 Art.19.`;

  return {
    winner: sufficient ? top.value : null,
    votes: top.sources.length,
    totalVotes: n,
    quorum,
    maxFaults,
    sufficientConsensus: sufficient,
    distribution: groups.map((g) => ({ value: g.value, sources: g.sources })),
    narrative,
  };
}
