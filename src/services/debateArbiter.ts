/**
 * Two-Sided Debate Arbiter.
 *
 * For truly contested compliance decisions (file STR vs. dismiss,
 * freeze vs. monitor, close case vs. escalate) we run a formal
 * adversarial debate between two positions:
 *
 *   PRO  — argues for the stronger regulatory action
 *   CON  — argues for the lighter regulatory action
 *
 * Each side submits weighted arguments with regulatory citations. A
 * deterministic JUDGE then scores the debate and decides who wins.
 * The judge uses:
 *
 *   1. Total argument weight × citation strength
 *   2. A "regulatory conservatism" bias (close calls go to the
 *      stronger action — fail-closed is safer for AML)
 *   3. Explicit penalties for any argument that would tip off the
 *      subject (FDL Art.29)
 *
 * The result is a structured verdict with a winning side, a margin,
 * and a full audit trail of arguments scored. The debate is
 * reproducible — same inputs, same verdict.
 *
 * Regulatory basis:
 *   - FDL Art.19 (internal review)
 *   - Cabinet Res 134/2025 Art.19 (adversarial review requirement)
 *   - FATF Rec 1 (risk-based approach)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Position = 'pro' | 'con';

export interface DebateArgument {
  position: Position;
  claim: string;
  weight: number; // caller-supplied strength in (0, 1]
  /** Regulatory citations raise credibility; ungrounded arguments are penalised. */
  citations: readonly string[];
  /** Optional rebuttal to a prior argument id. */
  rebutsId?: string;
  id?: string;
}

export interface DebateInput {
  topic: string;
  proAction: string;
  conAction: string;
  arguments: readonly DebateArgument[];
  /** Regulator conservatism bias in [0, 0.5]. 0 = neutral, 0.5 = max fail-closed. */
  conservatismBias?: number;
}

export interface ScoredArgument extends DebateArgument {
  id: string;
  score: number;
  penalties: string[];
}

export interface DebateVerdict {
  topic: string;
  proAction: string;
  conAction: string;
  winner: 'pro' | 'con' | 'tie';
  winningAction: string;
  proScore: number;
  conScore: number;
  margin: number;
  arguments: ScoredArgument[];
  judgeNotes: string[];
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

const TIP_OFF_PATTERNS: RegExp[] = [
  /\btell\s+the\s+(subject|customer|client)\b/i,
  /\bnotif(y|ying)\s+the\s+subject\b/i,
  /\bwarn\s+the\s+(customer|client)\b/i,
];

export function runDebate(input: DebateInput): DebateVerdict {
  const bias = clamp01x(input.conservatismBias ?? 0.1, 0, 0.5);
  const scored: ScoredArgument[] = [];
  const notes: string[] = [];

  input.arguments.forEach((arg, idx) => {
    const id = arg.id ?? `arg-${idx + 1}`;
    const penalties: string[] = [];
    let score = clamp01x(arg.weight, 0, 1);

    // Citation strength: up to +0.3 from up to 3 citations.
    score += Math.min(arg.citations.length, 3) * 0.1;

    // Rebuttal bonus if the rebutted argument exists.
    if (arg.rebutsId && input.arguments.some((a, i) => (a.id ?? `arg-${i + 1}`) === arg.rebutsId)) {
      score += 0.1;
    }

    // Tipping-off penalty.
    for (const pattern of TIP_OFF_PATTERNS) {
      if (pattern.test(arg.claim)) {
        score -= 1;
        penalties.push('tipping-off language (FDL Art.29)');
        notes.push(`Argument ${id} penalised for tipping-off.`);
      }
    }

    // Ungrounded penalty.
    if (arg.citations.length === 0) {
      score -= 0.1;
      penalties.push('no regulatory citation');
    }

    scored.push({ ...arg, id, score: round4(score), penalties });
  });

  const proScore = round4(
    scored.filter((a) => a.position === 'pro').reduce((s, a) => s + Math.max(0, a.score), 0),
  );
  const conScore = round4(
    scored.filter((a) => a.position === 'con').reduce((s, a) => s + Math.max(0, a.score), 0),
  );

  // Conservatism bias nudges pro (stronger action) in close calls.
  const adjustedPro = proScore + (proScore + conScore) * bias;
  const adjustedCon = conScore;
  let winner: DebateVerdict['winner'];
  if (Math.abs(adjustedPro - adjustedCon) < 0.05) {
    winner = 'tie';
  } else if (adjustedPro > adjustedCon) {
    winner = 'pro';
  } else {
    winner = 'con';
  }
  // Ties resolved fail-closed.
  const winningAction =
    winner === 'pro' || winner === 'tie' ? input.proAction : input.conAction;
  if (winner === 'tie') {
    notes.push('Tie resolved fail-closed to the stronger action (AML conservatism).');
  }

  return {
    topic: input.topic,
    proAction: input.proAction,
    conAction: input.conAction,
    winner,
    winningAction,
    proScore,
    conScore,
    margin: round4(Math.abs(adjustedPro - adjustedCon)),
    arguments: scored,
    judgeNotes: notes,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clamp01x(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
