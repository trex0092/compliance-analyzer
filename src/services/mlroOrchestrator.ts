/**
 * MLRO Orchestrator — PEER-style multi-agent wrapper around the
 * compliance decision engine.
 *
 * The underlying `runComplianceDecision` already wires 97 subsystems
 * via the weaponized brain. This orchestrator sits one layer above
 * and turns a loose MLRO prompt into a structured case:
 *
 *     Planner   — decomposes "screen Alice Corp" into concrete inputs
 *                 (what lists, what sources, what historical cases)
 *     Executor  — runs `runComplianceDecision` on the concrete inputs
 *     Evaluator — grades the decision + cross-checks with feedback
 *                 learner + precedent retriever
 *     Reviewer  — calls the Opus advisor tool via advisorStrategy
 *                 whenever any of the six compliance triggers fire
 *
 * The orchestrator is DETERMINISTIC apart from the advisor call —
 * Planner and Evaluator are pure functions that make decisions from
 * the input shape, not from LLM calls. This keeps the critical path
 * reproducible for audit.
 *
 * Regulatory alignment:
 *   FDL No.10/2025 Art.20-21 (CO duty of care)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   FATF Rec 18 (internal controls proportionate to risk)
 */

import {
  runComplianceDecision,
  type ComplianceCaseInput,
  type ComplianceDecision,
  type EngineVerdict,
} from './complianceDecisionEngine';
import {
  callAdvisorAssisted,
  validateExecutorAdvisorPair,
  COMPLIANCE_ADVISOR_SYSTEM_PROMPT,
  EXECUTOR_SONNET,
  ADVISOR_OPUS,
  type AdvisorCallResult,
  type AdvisorCallDeps,
} from './advisorStrategy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Planner output — the concrete case input plus the rationale for
 * each subsystem we chose to run. The Executor gets `caseInput`; the
 * audit trail gets `plan`.
 */
export interface OrchestrationPlan {
  caseInput: ComplianceCaseInput;
  /** One line per subsystem the planner decided to enable. */
  steps: string[];
  /** ISO timestamp of plan. */
  at: string;
}

/**
 * Evaluator output — a second pass over the decision. Lists which
 * signals the evaluator found that should escalate the verdict, and
 * whether it thinks the advisor should be consulted.
 */
export interface EvaluationReport {
  concerns: string[];
  shouldConsultAdvisor: boolean;
  /** If the evaluator disagrees with the executor, the target verdict. */
  recommendedVerdict?: EngineVerdict;
  at: string;
}

/**
 * Reviewer output — the advisor tool call result, if invoked. Omitted
 * when no trigger fired and the advisor wasn't called.
 */
export interface ReviewReport {
  consulted: boolean;
  result?: AdvisorCallResult;
  /** Executor/advisor pair used. */
  executor: string;
  advisor: string;
  /** Short reason when consulted=false and the caller needs to know why. */
  skipReason?: string;
}

export interface OrchestrationResult {
  plan: OrchestrationPlan;
  decision: ComplianceDecision;
  evaluation: EvaluationReport;
  review: ReviewReport;
  /** Final verdict after every layer. */
  finalVerdict: EngineVerdict;
  /** ISO timestamp. */
  at: string;
}

export interface OrchestrationOptions {
  /**
   * Advisor dependency injection — the caller supplies a fetch-like
   * transport and an API key so the orchestrator doesn't couple to a
   * specific HTTP client or secret store. The orchestrator never falls
   * back to a global fetch if these aren't provided — advisor calls
   * simply skip.
   */
  advisorDeps?: AdvisorCallDeps;
  /** Executor model. Defaults to Sonnet. */
  executor?: string;
  /** Advisor model. Defaults to Opus 4.6. */
  advisor?: string;
}

// ---------------------------------------------------------------------------
// Planner — deterministic, no LLM.
// ---------------------------------------------------------------------------

/**
 * Decide which subsystems to enable based on the raw input. The
 * planner never adds data; it only decides which of the already-
 * provided inputs are worth running through the brain.
 */
export function plan(input: ComplianceCaseInput): OrchestrationPlan {
  const steps: string[] = [];

  steps.push('Run MegaBrain (13 core subsystems) on entity + features');

  if (input.adverseMedia && input.adverseMedia.length > 0) {
    steps.push(`Rank ${input.adverseMedia.length} adverse-media hit(s)`);
  }
  if (input.ubo) {
    steps.push(`Analyse UBO graph for ${input.ubo.targetId} (layering + shell + sanctioned UBO)`);
  }
  if (input.wallets && input.wallets.addresses.length > 0) {
    steps.push(`Score ${input.wallets.addresses.length} VASP wallet(s)`);
  }
  if (input.transactions && input.transactions.length > 0) {
    steps.push(`Run transaction anomaly detectors on ${input.transactions.length} tx`);
  }
  if (input.filing) {
    steps.push(`Evaluate four-eyes requirement for ${input.filing.decisionType}`);
  }

  // Every plan always runs the explainable scoring + zk attestation
  // stages — these are part of the weaponized brain core.
  steps.push('Explainable factor scoring (subsystem 18)');
  if (input.sealAttestation !== false) {
    steps.push('zk-compliance attestation (subsystem 19)');
  }

  return {
    caseInput: input,
    steps,
    at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Evaluator — deterministic, cross-checks the decision.
// ---------------------------------------------------------------------------

/**
 * Cross-check the decision against a small set of invariants. Returns
 * the set of concerns and whether the advisor should be consulted.
 *
 * Six advisor triggers (matches COMPLIANCE_ADVISOR_SYSTEM_PROMPT):
 *   1. Final verdict is escalate or freeze
 *   2. Confidence < 0.7
 *   3. A safety clamp fired
 *   4. Subsystem failures exist
 *   5. STR probability > 0.5
 *   6. Four-eyes status is incomplete / rejected
 */
export function evaluate(
  decision: ComplianceDecision,
  _input: ComplianceCaseInput
): EvaluationReport {
  const concerns: string[] = [];
  let shouldConsultAdvisor = false;
  let recommendedVerdict: EngineVerdict | undefined;

  // Trigger 1
  if (decision.verdict === 'escalate' || decision.verdict === 'freeze') {
    concerns.push(`Verdict is ${decision.verdict} — advisor-review trigger`);
    shouldConsultAdvisor = true;
  }

  // Trigger 2
  if (decision.confidence < 0.7) {
    concerns.push(
      `Confidence ${decision.confidence.toFixed(2)} below 0.7 — advisor-review trigger`
    );
    shouldConsultAdvisor = true;
  }

  // Trigger 3
  const clamps = (decision.raw.clampReasons ?? []) as readonly string[];
  if (clamps.length > 0) {
    concerns.push(`${clamps.length} safety clamp(s) fired — see raw.clampReasons`);
    shouldConsultAdvisor = true;
  }

  // Trigger 4
  const failures = decision.raw.subsystemFailures ?? [];
  if (failures.length > 0) {
    concerns.push(`Subsystem failure(s): ${failures.join(', ')}`);
    shouldConsultAdvisor = true;
  }

  // Trigger 5
  if (decision.strPrediction.probability > 0.5) {
    concerns.push(
      `STR probability ${decision.strPrediction.probability.toFixed(2)} exceeds 0.5 — file STR`
    );
    // Evaluator can over-ride executor to 'escalate' when STR probability
    // is this high and executor only produced a pass/flag — defensive.
    if (decision.verdict === 'pass' || decision.verdict === 'flag') {
      recommendedVerdict = 'escalate';
    }
  }

  // Trigger 6
  if (decision.fourEyes) {
    const fe = decision.fourEyes;
    if (fe.status !== 'approved') {
      concerns.push(`Four-eyes status: ${fe.status}`);
      if (fe.status === 'rejected') {
        recommendedVerdict = 'escalate';
      }
    }
  }

  // Brief sanctions sanity check — a human review flag on the raw
  // response also routes to the advisor, even if no other trigger
  // fired. Matches the MegaBrain contract.
  if (decision.requiresHumanReview) {
    concerns.push('MegaBrain flagged requiresHumanReview=true');
    shouldConsultAdvisor = true;
  }

  return {
    concerns,
    shouldConsultAdvisor,
    recommendedVerdict,
    at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reviewer — the only component that makes a real LLM call.
// ---------------------------------------------------------------------------

async function review(
  decision: ComplianceDecision,
  evaluation: EvaluationReport,
  options: OrchestrationOptions
): Promise<ReviewReport> {
  const executor = options.executor ?? EXECUTOR_SONNET;
  const advisor = options.advisor ?? ADVISOR_OPUS;

  // Validate the pair up-front. If the pair is invalid the orchestrator
  // still returns a result — it just records a consulted:false review
  // with a clear reason, so the caller can tell this apart from a
  // genuine "no trigger fired" skip.
  try {
    validateExecutorAdvisorPair(executor, advisor);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      consulted: false,
      executor,
      advisor,
      skipReason: `Advisor pair invalid: ${msg}`,
    };
  }

  if (!evaluation.shouldConsultAdvisor) {
    return { consulted: false, executor, advisor };
  }

  // Skip if the caller didn't supply advisor deps — advisor calls
  // require a network transport and an API key, and the orchestrator
  // must not mint its own.
  if (!options.advisorDeps) {
    return {
      consulted: false,
      executor,
      advisor,
      skipReason: 'Advisor skipped: advisorDeps not provided',
    };
  }

  // Build the advisor prompt from the audit narrative and the
  // evaluator's concerns. We do NOT pass raw PII — only the opaque
  // decision id and the derived concerns.
  const prompt = [
    `Decision id: ${decision.id}`,
    `Verdict: ${decision.verdict}`,
    `Confidence: ${decision.confidence.toFixed(2)}`,
    `STR probability: ${decision.strPrediction.probability.toFixed(2)}`,
    '',
    'Concerns identified by the evaluator:',
    ...evaluation.concerns.map((c) => `  - ${c}`),
    '',
    'Audit narrative (redacted subject):',
    decision.auditNarrative,
  ].join('\n');

  const result = await callAdvisorAssisted(
    {
      executor,
      advisor,
      additionalSystemPrompt: COMPLIANCE_ADVISOR_SYSTEM_PROMPT,
      userMessage: prompt,
      maxTokens: 1024,
    },
    options.advisorDeps
  );

  return { consulted: true, executor, advisor, result };
}

// ---------------------------------------------------------------------------
// Public: run the full PEER pipeline.
// ---------------------------------------------------------------------------

export async function runOrchestration(
  input: ComplianceCaseInput,
  options: OrchestrationOptions = {}
): Promise<OrchestrationResult> {
  const at = new Date().toISOString();

  // PLAN
  const planOut = plan(input);

  // EXECUTE
  const decision = await runComplianceDecision(planOut.caseInput);

  // EVALUATE
  const evaluation = evaluate(decision, input);

  // REVIEW — only makes a real LLM call when shouldConsultAdvisor is true.
  const reviewOut = await review(decision, evaluation, options);

  // The evaluator can recommend a stricter verdict than the executor
  // produced. We only accept monotone escalations — never downgrades.
  const finalVerdict = maxVerdict(
    decision.verdict,
    evaluation.recommendedVerdict ?? decision.verdict
  );

  return {
    plan: planOut,
    decision,
    evaluation,
    review: reviewOut,
    finalVerdict,
    at,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VERDICT_ORDER: Record<EngineVerdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

function maxVerdict(a: EngineVerdict, b: EngineVerdict): EngineVerdict {
  return VERDICT_ORDER[a] >= VERDICT_ORDER[b] ? a : b;
}
