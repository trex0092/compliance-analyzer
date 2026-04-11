/**
 * Decision Replay Engine — subsystem #76 (Phase 7 Cluster J).
 *
 * Re-runs every historical decision with a proposed new policy and
 * reports the diff: "policy X would flip 42 cases, of which 5 go
 * from pass → freeze". Mandatory before any clampPolicy change
 * per the Phase 2 safety line.
 *
 * Pure function: takes historical decisions + a replay function
 * (bound to the candidate policy) and returns a structured diff.
 * The replay function is injected so tests don't need the whole
 * weaponizedBrain pipeline.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review before policy change)
 *   - EU AI Act Art.72 (post-market monitoring + impact assessment)
 *   - NIST AI RMF MG-1.1 (risk treatment plan)
 *   - FDL No.10/2025 Art.20 (documented reasoning)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface HistoricalDecision {
  caseId: string;
  at: string;
  /** The verdict under the OLD policy (what actually happened). */
  originalVerdict: Verdict;
  /** Any data the replay function needs to recompute the new verdict. */
  inputs: Record<string, unknown>;
}

export type ReplayFn = (inputs: Record<string, unknown>) => Verdict;

export interface ReplayDiff {
  caseId: string;
  originalVerdict: Verdict;
  newVerdict: Verdict;
  movedToStricter: boolean;
  movedToLooser: boolean;
}

export interface ReplayReport {
  total: number;
  unchanged: number;
  stricter: number;
  looser: number;
  transitions: Record<string, number>; // e.g. "pass->escalate": 42
  diffs: readonly ReplayDiff[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const RANK: Record<Verdict, number> = { pass: 0, flag: 1, escalate: 2, freeze: 3 };

export function replayDecisions(
  history: readonly HistoricalDecision[],
  replay: ReplayFn
): ReplayReport {
  const diffs: ReplayDiff[] = [];
  const transitions: Record<string, number> = {};
  let unchanged = 0;
  let stricter = 0;
  let looser = 0;

  for (const dec of history) {
    const newVerdict = replay(dec.inputs);
    const movedToStricter = RANK[newVerdict] > RANK[dec.originalVerdict];
    const movedToLooser = RANK[newVerdict] < RANK[dec.originalVerdict];

    if (newVerdict !== dec.originalVerdict) {
      const key = `${dec.originalVerdict}->${newVerdict}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
    }

    if (newVerdict === dec.originalVerdict) unchanged += 1;
    else if (movedToStricter) stricter += 1;
    else looser += 1;

    diffs.push({
      caseId: dec.caseId,
      originalVerdict: dec.originalVerdict,
      newVerdict,
      movedToStricter,
      movedToLooser,
    });
  }

  const narrative =
    `Decision replay: ${history.length} case(s) replayed. ` +
    `${unchanged} unchanged, ${stricter} moved stricter, ${looser} moved looser. ` +
    (Object.keys(transitions).length > 0
      ? `Transitions: ${Object.entries(transitions)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}.`
      : 'No transitions.');

  return { total: history.length, unchanged, stricter, looser, transitions, diffs, narrative };
}
