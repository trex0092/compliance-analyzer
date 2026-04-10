/**
 * Teacher-Student Double-Check Agent.
 *
 * The "student" (fast/cheap model) produces a first-pass compliance
 * verdict. The "teacher" (slow/expensive model) reviews the student's
 * reasoning chain and either ratifies it, corrects it, or escalates.
 *
 * This is how we get 4-eyes-within-the-brain: a single human inspector
 * only sees the teacher's ratified output, but can drill into the full
 * DAG of student + teacher deliberations for audit.
 *
 * Disagreement matrix:
 *
 *   student  |  teacher  |  outcome
 *   ---------+-----------+-------------------------------------------
 *   pass     |  pass     |  ratified (pass)
 *   pass     |  flag     |  corrected (teacher wins, audit event)
 *   flag     |  pass     |  contested (escalate to human — 4-eyes)
 *   flag     |  flag     |  ratified (flag)
 *   flag     |  freeze   |  corrected upward (teacher wins, emit freeze)
 *   freeze   |  pass     |  contested (escalate, NEVER auto-unfreeze)
 *
 * Safety invariant: the teacher may only ESCALATE a freeze; it can
 * never DOWNGRADE a freeze autonomously. Downgrading a freeze always
 * requires a human with the freeze-release role.
 *
 * Regulatory basis:
 *   - Cabinet Res 74/2020 Art.7 (freeze release requires CO decision)
 *   - FDL Art.20 (CO must document review)
 *   - Cabinet Res 134/2025 Art.19 (independent internal review)
 */

import { createChain, addNode, addEdge, seal, type ReasoningChain } from './reasoningChain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface Opinion {
  verdict: Verdict;
  confidence: number; // [0, 1]
  rationale: string;
  model: string;
  citations?: string[];
}

export interface DoubleCheckInput {
  topic: string;
  student: Opinion;
  teacher: Opinion;
}

export type Outcome =
  | 'ratified'
  | 'corrected-upward'
  | 'corrected-downward'
  | 'contested'
  | 'locked-freeze';

export interface DoubleCheckResult {
  topic: string;
  finalVerdict: Verdict;
  outcome: Outcome;
  requiresHumanReview: boolean;
  student: Opinion;
  teacher: Opinion;
  chain: ReasoningChain;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Verdict ordering
// ---------------------------------------------------------------------------

const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

function isUpgrade(from: Verdict, to: Verdict): boolean {
  return VERDICT_RANK[to] > VERDICT_RANK[from];
}

function isDowngrade(from: Verdict, to: Verdict): boolean {
  return VERDICT_RANK[to] < VERDICT_RANK[from];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export function doubleCheck(input: DoubleCheckInput): DoubleCheckResult {
  const { topic, student, teacher } = input;
  const chain = createChain(`double-check: ${topic}`);

  addNode(chain, { id: 'topic', type: 'event', label: topic, weight: 1 });
  addNode(chain, {
    id: 'student',
    type: 'hypothesis',
    label: `${student.model}: ${student.verdict}`,
    weight: student.confidence,
    data: { rationale: student.rationale, citations: student.citations ?? [] },
  });
  addNode(chain, {
    id: 'teacher',
    type: 'hypothesis',
    label: `${teacher.model}: ${teacher.verdict}`,
    weight: teacher.confidence,
    data: { rationale: teacher.rationale, citations: teacher.citations ?? [] },
  });
  addEdge(chain, { fromId: 'topic', toId: 'student', relation: 'triggers', weight: 1 });
  addEdge(chain, { fromId: 'topic', toId: 'teacher', relation: 'triggers', weight: 1 });

  const notes: string[] = [];
  let finalVerdict: Verdict;
  let outcome: Outcome;
  let requiresHumanReview = false;

  // Safety: freeze is sticky. Student freeze + teacher pass = contested,
  // NEVER auto-unfreeze.
  if (student.verdict === 'freeze' && teacher.verdict !== 'freeze') {
    finalVerdict = 'freeze';
    outcome = 'locked-freeze';
    requiresHumanReview = true;
    notes.push(
      'SAFETY: student asserted freeze — teacher downgrade blocked. Human freeze-release required (Cabinet Res 74/2020 Art.7).'
    );
  } else if (student.verdict === teacher.verdict) {
    finalVerdict = student.verdict;
    outcome = 'ratified';
    notes.push(`Both models agree on ${finalVerdict}.`);
  } else if (isUpgrade(student.verdict, teacher.verdict)) {
    finalVerdict = teacher.verdict;
    outcome = 'corrected-upward';
    notes.push(
      `Teacher escalated from ${student.verdict} → ${teacher.verdict} (${teacher.rationale}).`
    );
    // Upgrades to freeze auto-execute (sanctioned entity must be frozen per FDL Art.22).
    requiresHumanReview = finalVerdict !== 'freeze' || teacher.confidence < 0.8;
  } else if (isDowngrade(student.verdict, teacher.verdict)) {
    // Student said flag, teacher said pass — escalate to human.
    finalVerdict = student.verdict; // keep the stronger verdict pending human review
    outcome = 'contested';
    requiresHumanReview = true;
    notes.push(
      `CONTESTED: student said ${student.verdict}, teacher said ${teacher.verdict}. Holding at stronger verdict pending human review.`
    );
  } else {
    // Shouldn't happen — equal verdicts caught above.
    finalVerdict = teacher.verdict;
    outcome = 'ratified';
  }

  addNode(chain, {
    id: 'final',
    type: 'decision',
    label: `final: ${finalVerdict}`,
    weight: 1,
    data: { outcome, requiresHumanReview },
  });
  addEdge(chain, {
    fromId: 'student',
    toId: 'final',
    relation: outcome === 'contested' ? 'contradicts' : 'supports',
    weight: student.confidence,
  });
  addEdge(chain, {
    fromId: 'teacher',
    toId: 'final',
    relation: outcome === 'contested' ? 'contradicts' : 'supports',
    weight: teacher.confidence,
  });

  seal(chain);

  return {
    topic,
    finalVerdict,
    outcome,
    requiresHumanReview,
    student,
    teacher,
    chain,
    notes,
  };
}
