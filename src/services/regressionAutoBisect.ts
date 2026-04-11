/**
 * Regression Auto-Bisect — subsystem #69 (Phase 7 Cluster H).
 *
 * Pure-function bisection over a sequence of commits + a deterministic
 * test outcome. Given the last-known-good commit, the first-bad
 * commit, and a predicate `isBad(commit)`, returns the exact commit
 * that introduced the regression.
 *
 * This is the same algorithm `git bisect` uses but plugged into the
 * brain so CI can report "golden case X started failing at commit Y"
 * without a human running the bisect manually.
 *
 * The predicate is injected — tests use a deterministic map, CI uses
 * a shell callback that runs the test suite at each commit.
 *
 * Regulatory basis:
 *   - NIST AI RMF MS-1.1 (regression testing)
 *   - Cabinet Res 134/2025 Art.19 (auditable change tracking)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BadnessPredicate = (commit: string) => Promise<boolean> | boolean;

export interface BisectReport {
  goodCommit: string;
  badCommit: string;
  culprit: string | null;
  iterations: number;
  checked: readonly string[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Bisector
// ---------------------------------------------------------------------------

export async function bisectRegression(
  commits: readonly string[],
  goodCommit: string,
  badCommit: string,
  isBad: BadnessPredicate
): Promise<BisectReport> {
  const goodIdx = commits.indexOf(goodCommit);
  const badIdx = commits.indexOf(badCommit);

  if (goodIdx === -1 || badIdx === -1) {
    return {
      goodCommit,
      badCommit,
      culprit: null,
      iterations: 0,
      checked: [],
      narrative: 'Bisect failed: good or bad commit not in commit range.',
    };
  }
  if (goodIdx >= badIdx) {
    return {
      goodCommit,
      badCommit,
      culprit: null,
      iterations: 0,
      checked: [],
      narrative: 'Bisect failed: good commit must precede bad commit in the range.',
    };
  }

  let low = goodIdx;
  let high = badIdx;
  let iterations = 0;
  const checked: string[] = [];

  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const midCommit = commits[mid];
    iterations += 1;
    checked.push(midCommit);
    const bad = await isBad(midCommit);
    if (bad) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const culprit = commits[high];
  return {
    goodCommit,
    badCommit,
    culprit,
    iterations,
    checked,
    narrative:
      `Bisect found ${culprit} as the first-bad commit in ${iterations} iteration(s). ` +
      `Checked ${checked.length} commit(s).`,
  };
}
