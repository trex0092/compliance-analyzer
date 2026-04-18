/**
 * Layer 3 — Orchestration.
 *
 * HRM-inspired slow-planner / fast-executor pattern + PEER cycle
 * (Plan → Execute → Evaluate → Reflect). Coordinates Layer 1
 * (Investigator) and Layer 2 (Reasoner) into a single auditable flow,
 * emits a four-eyes gate when posterior confidence is low, and writes
 * reflection notes to a pluggable memory sink.
 *
 * References:
 *   - vendor/HRM (Sapient Inc. hierarchical reasoning model)
 *   - vendor/agentUniverse (PEER + DOE patterns)
 *   - vendor/open-multi-agent (DAG task decomposition)
 */

import { runInvestigation, type InvestigationTranscript, type SearchFn, type SubjectProfile } from './investigator';
import { runReasoning, type ReasoningResult, type Hypothesis } from './reasoner';

export type TaskKind = 'investigate' | 'reason' | 'evaluate' | 'reflect';

export interface Task {
  id: string;
  kind: TaskKind;
  deps: string[];
  label: string;
}

export interface TaskResult {
  id: string;
  ok: boolean;
  output: unknown;
  ms: number;
  error?: string;
}

export type Verdict = 'clear' | 'false_positive' | 'escalate' | 'freeze';

export interface OrchestrationResult {
  plan: Task[];
  results: TaskResult[];
  investigation: InvestigationTranscript;
  reasoning: ReasoningResult;
  verdict: Verdict;
  requiresFourEyes: boolean;
  confidence: number;
  narrative: string;
  lessons: string[];
}

export interface OrchestratorConfig {
  searchFn: SearchFn;
  hypotheses?: Hypothesis[];
  /** Four-eyes threshold on top-hypothesis posterior. Default 0.85. */
  fourEyesThreshold?: number;
  /** Called for every lesson learned (bug, surprise, failure). */
  memorySink?: (lesson: string) => void;
  /** Upper bound on total orchestration wallclock (ms). Default 15000. */
  deadlineMs?: number;
}

const DEFAULT_PLAN: Task[] = [
  { id: 't-investigate', kind: 'investigate', deps: [], label: 'Gather evidence atoms' },
  { id: 't-reason', kind: 'reason', deps: ['t-investigate'], label: 'Adjudicate hypotheses' },
  { id: 't-evaluate', kind: 'evaluate', deps: ['t-reason'], label: 'Derive verdict + gate' },
  { id: 't-reflect', kind: 'reflect', deps: ['t-evaluate'], label: 'Record lessons' },
];

/**
 * Run the full three-layer brain for a subject. Returns a fully
 * audit-trail-ready orchestration record.
 */
export async function runDeepBrain(
  subject: SubjectProfile,
  config: OrchestratorConfig
): Promise<OrchestrationResult> {
  const plan = DEFAULT_PLAN;
  const results: TaskResult[] = [];
  const deadlineMs = config.deadlineMs ?? 15000;
  const t0 = Date.now();

  const remaining = (): number => Math.max(0, deadlineMs - (Date.now() - t0));
  const overBudget = (): boolean => remaining() === 0;

  // --- Task 1: investigate ---
  const investigateStart = Date.now();
  let investigation: InvestigationTranscript;
  try {
    investigation = await runInvestigation(subject, config.searchFn, {
      maxIterations: 4,
      maxCost: 20,
    });
    results.push({
      id: 't-investigate',
      ok: true,
      output: investigation,
      ms: Date.now() - investigateStart,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 't-investigate',
      ok: false,
      output: null,
      ms: Date.now() - investigateStart,
      error: msg,
    });
    return buildFailureResult(plan, results, subject, 'investigation_failed', msg);
  }

  if (overBudget()) {
    return buildFailureResult(
      plan,
      results,
      subject,
      'deadline_exceeded',
      'Orchestrator exceeded deadline after investigation phase.',
      investigation
    );
  }

  // --- Task 2: reason ---
  const reasonStart = Date.now();
  let reasoning: ReasoningResult;
  try {
    reasoning = runReasoning(investigation.atoms, {
      defaultHypotheses: config.hypotheses,
    });
    results.push({
      id: 't-reason',
      ok: true,
      output: reasoning,
      ms: Date.now() - reasonStart,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      id: 't-reason',
      ok: false,
      output: null,
      ms: Date.now() - reasonStart,
      error: msg,
    });
    return buildFailureResult(plan, results, subject, 'reasoning_failed', msg, investigation);
  }

  // --- Task 3: evaluate ---
  const evalStart = Date.now();
  const fourEyesThreshold = config.fourEyesThreshold ?? 0.85;
  const verdict = deriveVerdict(reasoning);
  const requiresFourEyes =
    reasoning.top.confidence < fourEyesThreshold || verdict === 'escalate' || verdict === 'freeze';
  results.push({
    id: 't-evaluate',
    ok: true,
    output: { verdict, requiresFourEyes },
    ms: Date.now() - evalStart,
  });

  // --- Task 4: reflect ---
  const reflectStart = Date.now();
  const lessons = buildLessons(investigation, reasoning, verdict, requiresFourEyes);
  if (config.memorySink) {
    for (const l of lessons) {
      try {
        config.memorySink(l);
      } catch {
        // Never let a memory-sink failure break the verdict.
      }
    }
  }
  results.push({
    id: 't-reflect',
    ok: true,
    output: { lessons },
    ms: Date.now() - reflectStart,
  });

  const narrative = buildNarrative(subject, investigation, reasoning, verdict, requiresFourEyes);

  return {
    plan,
    results,
    investigation,
    reasoning,
    verdict,
    requiresFourEyes,
    confidence: reasoning.top.confidence,
    narrative,
    lessons,
  };
}

function deriveVerdict(reasoning: ReasoningResult): Verdict {
  const id = reasoning.top.hypothesisId;
  const p = reasoning.top.posterior;
  if (id === 'h-confirmed' && p >= 0.75) return 'freeze';
  if (id === 'h-association' && p >= 0.6) return 'escalate';
  if (id === 'h-pep' && p >= 0.6) return 'escalate';
  if (id === 'h-confirmed' && p >= 0.4) return 'escalate';
  if (id === 'h-false-positive' && p >= 0.7) return 'false_positive';
  return 'clear';
}

function buildLessons(
  inv: InvestigationTranscript,
  reasoning: ReasoningResult,
  verdict: Verdict,
  requiresFourEyes: boolean
): string[] {
  const out: string[] = [];
  if (inv.budgetExhausted) {
    out.push(
      `Cost budget exhausted after ${inv.iterations} iteration(s); coverage only ${(inv.coverage * 100).toFixed(0)}%. Consider raising maxCost for this risk tier.`
    );
  }
  if (reasoning.top.confidence < 0.5) {
    out.push(
      `Low reasoning confidence (${(reasoning.top.confidence * 100).toFixed(0)}%). Add more evidence sources or escalate to a specialist.`
    );
  }
  if (verdict === 'freeze' && !requiresFourEyes) {
    out.push('Freeze verdict without four-eyes gate — this should never happen; check thresholds.');
  }
  return out;
}

function buildNarrative(
  subject: SubjectProfile,
  inv: InvestigationTranscript,
  reasoning: ReasoningResult,
  verdict: Verdict,
  requiresFourEyes: boolean
): string {
  const parts: string[] = [];
  parts.push(`# Deep brain report — ${subject.name}`);
  parts.push('');
  parts.push('## Investigation');
  parts.push(inv.summary);
  parts.push('');
  parts.push('## Reasoning');
  parts.push(reasoning.top.rationale);
  parts.push('');
  parts.push('## Verdict');
  parts.push(`- verdict: ${verdict}`);
  parts.push(`- four-eyes required: ${requiresFourEyes ? 'YES' : 'no'}`);
  parts.push(`- confidence: ${(reasoning.top.confidence * 100).toFixed(0)}%`);
  parts.push('');
  parts.push('## Full reasoning chain');
  parts.push(reasoning.auditChain);
  return parts.join('\n');
}

function buildFailureResult(
  plan: Task[],
  results: TaskResult[],
  subject: SubjectProfile,
  reason: string,
  detail: string,
  investigation?: InvestigationTranscript
): OrchestrationResult {
  return {
    plan,
    results,
    investigation:
      investigation ?? {
        subject,
        questions: [],
        atoms: [],
        iterations: 0,
        costSpent: 0,
        budgetExhausted: false,
        coverage: 0,
        summary: `Investigation not completed: ${reason}`,
      },
    reasoning: {
      hypotheses: [],
      branches: [],
      top: {
        hypothesisId: 'h-unknown',
        posterior: 0,
        confidence: 0,
        rationale: `Reasoning not completed: ${reason}`,
      },
      auditChain: detail,
    },
    verdict: 'escalate',
    requiresFourEyes: true,
    confidence: 0,
    narrative: `Deep brain FAILED for ${subject.name}: ${reason} — ${detail}. Manual review required per FDL Art.24.`,
    lessons: [`orchestrator_failure: ${reason}`],
  };
}
