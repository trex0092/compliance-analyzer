/**
 * Deep Brain — the three-layer investigation + reasoning + orchestration
 * stack. Entry points:
 *
 *   - runDeepBrain(subject, config)     — full PEER cycle
 *   - runInvestigation(subject, fn)     — Layer 1 only
 *   - runReasoning(atoms)               — Layer 2 only
 *
 * All layers are deterministic, network-free by default, and fully
 * typed. Compliance-safe: no subject data leaves the process unless
 * the caller supplies a `searchFn` that reaches out — that is the
 * caller's responsibility under FDL Art.29.
 */

export { buildDefaultQuestions, nullSearchFn, runInvestigation } from './investigator';
export type {
  InvestigationConfig,
  InvestigationTranscript,
  ResearchAtom,
  ResearchQuestion,
  SearchFn,
  SearchHit,
  SubjectProfile,
} from './investigator';

export { DEFAULT_HYPOTHESES, runReasoning } from './reasoner';
export type {
  BranchStep,
  Hypothesis,
  ReasoningBranch,
  ReasoningConfig,
  ReasoningResult,
} from './reasoner';

export { runDeepBrain } from './orchestrator';
export type {
  OrchestrationResult,
  OrchestratorConfig,
  Task,
  TaskKind,
  TaskResult,
  Verdict,
} from './orchestrator';
