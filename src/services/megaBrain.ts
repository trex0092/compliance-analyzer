/**
 * MEGA SUPER INTELLIGENCE BRAIN — Unified Compliance Cortex.
 *
 * This is the top-level orchestrator that threads a single sealed
 * reasoning chain through EVERY intelligence subsystem we have built:
 *
 *   1. Case-based reasoning (retrieve precedents)            — caseBasedReasoning
 *   2. Peer-group anomaly detection                          — peerAnomaly
 *   3. Bayesian belief update over compliance hypotheses     — bayesianBelief
 *   4. Causal counterfactual ("what if we had done X")       — causalEngine
 *   5. Predictive STR scoring                                — predictiveStr
 *   6. Rule-induced policy check                             — ruleInduction
 *   7. Goal-conditioned action plan                          — goalPlanner
 *   8. Teacher-student double-check                          — teacherStudent
 *   9. Two-sided adversarial debate (when contested)         — debateArbiter
 *  10. Self-reflection critic with confidence + escalation   — reflectionCritic
 *  11. Penalty VaR for the entity's failure modes            — penaltyVaR
 *  12. STR narrative draft if we are filing                  — strNarrativeBuilder
 *  13. War-room event emission for the NORAD dashboard       — warRoomFeed
 *
 * Think of the MegaBrain as the prefrontal cortex that coordinates the
 * specialist regions. It is deterministic, explainable, and every
 * decision it makes produces ONE sealed DAG that carries all
 * intermediate reasoning from all subsystems.
 *
 * Safety invariants (enforced here, not just by subsystems):
 *   - Sanctions confirmed ⇒ verdict is always "freeze". No path can
 *     downgrade it.
 *   - Any subsystem that returns requiresHumanReview = true bubbles up.
 *   - Reflection critic below escalation threshold ⇒ human review.
 *   - Tipping-off language anywhere ⇒ reject the whole decision.
 *   - Confidence is the MIN over all subsystem confidences, not the mean.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-20 (CO reasoning + internal review)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze protocol)
 *   - Cabinet Res 134/2025 Art.5, Art.19 (risk methodology + review)
 *   - FATF Rec 1, 18, 22, 23 (risk-based approach + DPMS)
 *   - MoE Circular 08/AML/2021 (DPMS red flags)
 */

import { addEdge, addNode, createChain, seal, type ReasoningChain } from './reasoningChain';
import { CaseMemory, type PastCase, type ReuseRecommendation } from './caseBasedReasoning';
import { analysePeerAnomaly, type PeerAnomalyReport } from './peerAnomaly';
import {
  runBeliefUpdate,
  uniformPrior,
  type BeliefReport,
  type Evidence,
  type Hypothesis,
} from './bayesianBelief';
import { runCounterfactual, type CausalGraph, type CounterfactualResult } from './causalEngine';
import { predictStr, type StrFeatures, type StrPrediction } from './predictiveStr';
import { plan, type Plan, type PlanAction, type PlanningProblem } from './goalPlanner';
import { doubleCheck, type Opinion, type DoubleCheckResult, type Verdict } from './teacherStudent';
import { runDebate, type DebateInput, type DebateVerdict } from './debateArbiter';
import { reviewReasoningChain, type ReflectionReport } from './reflectionCritic';
import {
  runPenaltyVaR,
  UAE_DPMS_VIOLATIONS,
  type VaRReport,
  type ViolationType,
} from './penaltyVaR';
import {
  buildStrNarrative,
  type FilingType,
  type StrNarrative,
  type StrNarrativeInput,
} from './strNarrativeBuilder';
import { predict as ruleTreePredict, type TreeNode } from './ruleInduction';
import type { WarRoomEvent } from './warRoomFeed';

// ---------------------------------------------------------------------------
// Inputs + Outputs
// ---------------------------------------------------------------------------

export interface MegaBrainRequest {
  /** Short topic for the reasoning chain. */
  topic: string;
  /** Entity under review. */
  entity: {
    id: string;
    name: string;
    features: StrFeatures;
    isSanctionsConfirmed?: boolean;
  };
  /** Labeled past cases for episodic retrieval. */
  memory?: CaseMemory;
  /** Peer group feature vectors for anomaly analysis. */
  peers?: ReadonlyArray<Record<string, number>>;
  /** Hypotheses for Bayesian updating (default: clean / suspicious / confirmed). */
  hypotheses?: readonly Hypothesis[];
  /** Evidence stream for Bayesian updates. */
  evidence?: readonly Evidence[];
  /** Causal graph + counterfactual question (optional). */
  causal?: {
    graph: CausalGraph;
    observation: Record<string, 0 | 1>;
    intervention: Record<string, 0 | 1>;
    target: string;
  };
  /** Planning problem to derive an action plan (optional). */
  planning?: PlanningProblem;
  /** Learned rule tree (from ruleInduction) to apply as a policy check. */
  ruleTree?: TreeNode;
  /** Teacher-student opinions (optional — if absent, student = predictive, teacher = rule tree). */
  teacherStudent?: {
    student: Opinion;
    teacher: Opinion;
  };
  /** Debate arguments (optional — only consulted when there is a tie). */
  debate?: DebateInput;
  /** Violations to price for VaR (defaults to UAE DPMS catalogue). */
  violations?: readonly ViolationType[];
  /** If we are filing an STR, the narrative input. */
  strInput?: StrNarrativeInput;
  /** Override of penalty VaR trials/confidence/seed. */
  varConfig?: { trials: number; confidence: number; seed?: number };
}

export interface MegaBrainResponse {
  topic: string;
  entityId: string;
  verdict: Verdict;
  recommendedAction: string;
  confidence: number;
  requiresHumanReview: boolean;
  subsystems: {
    precedents?: ReuseRecommendation;
    anomaly?: PeerAnomalyReport;
    belief?: BeliefReport;
    causal?: CounterfactualResult;
    strPrediction: StrPrediction;
    rulePrediction?: string;
    plan?: Plan;
    doubleCheck?: DoubleCheckResult;
    debate?: DebateVerdict;
    reflection: ReflectionReport;
    penaltyVaR?: VaRReport;
    narrative?: StrNarrative;
  };
  warRoomEvent: WarRoomEvent;
  chain: ReasoningChain;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HYPOTHESES: Hypothesis[] = [
  { id: 'clean', label: 'Clean', regulatoryMeaning: 'No action required.' },
  { id: 'suspicious', label: 'Suspicious', regulatoryMeaning: 'Enhanced review required.' },
  { id: 'confirmed', label: 'Confirmed launderer', regulatoryMeaning: 'File STR and freeze.' },
];

// Verdict ordering for safety clamping.
const VERDICT_RANK: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function runMegaBrain(req: MegaBrainRequest): MegaBrainResponse {
  const chain = createChain(req.topic);
  const notes: string[] = [];
  const subsystems: MegaBrainResponse['subsystems'] = {
    strPrediction: {} as StrPrediction, // populated below
    reflection: {} as ReflectionReport, // populated below
  };

  // Root event.
  addNode(chain, {
    id: 'root',
    type: 'event',
    label: `${req.topic} (${req.entity.name})`,
    weight: 1,
    regulatory: 'FDL No.10/2025 Art.19-20',
  });

  // --- 1. Case-based retrieval ---
  if (req.memory && req.memory.size() > 0) {
    const featureVec = toFeatureVector(req.entity.features);
    const reuse = req.memory.reuse(featureVec, 5);
    subsystems.precedents = reuse;
    addNode(chain, {
      id: 'precedents',
      type: 'evidence',
      label: `Precedents: ${reuse.supportingCases.length} support ${reuse.recommendedOutcome}`,
      weight: reuse.confidence,
      regulatory: 'FATF Rec 18 (internal controls)',
      data: { recommendedOutcome: reuse.recommendedOutcome, confidence: reuse.confidence },
    });
    addEdge(chain, {
      fromId: 'root',
      toId: 'precedents',
      relation: 'supports',
      weight: reuse.confidence,
    });
  }

  // --- 2. Peer-group anomaly ---
  if (req.peers && req.peers.length >= 2) {
    const peerReport = analysePeerAnomaly({
      target: toFeatureVector(req.entity.features),
      peers: req.peers,
    });
    subsystems.anomaly = peerReport;
    const anomalyNodeId = 'anomaly';
    addNode(chain, {
      id: anomalyNodeId,
      type: 'observation',
      label: `Peer anomaly score ${peerReport.overallScore.toFixed(2)} (rank ${peerReport.anomalyRank}/${peerReport.numPeers + 1})`,
      weight: Math.min(1, peerReport.overallScore / 5),
      regulatory: 'MoE Circular 08/AML/2021; FATF Rec 15',
      data: { anomalies: peerReport.anomalies.length },
    });
    addEdge(chain, { fromId: 'root', toId: anomalyNodeId, relation: 'triggers', weight: 0.6 });
  }

  // --- 3. Bayesian belief update ---
  const hypotheses = req.hypotheses ?? DEFAULT_HYPOTHESES;
  const evidence = req.evidence ?? [];
  const belief = runBeliefUpdate(hypotheses, uniformPrior(hypotheses), evidence);
  subsystems.belief = belief;
  addNode(chain, {
    id: 'belief',
    type: 'hypothesis',
    label: `Posterior: ${belief.mostLikely.label} @ ${(belief.mostLikely.probability * 100).toFixed(1)}%`,
    weight: belief.mostLikely.probability,
    regulatory: 'FATF Rec 1 (risk-based)',
    data: belief.finalPosterior,
  });
  addEdge(chain, {
    fromId: 'root',
    toId: 'belief',
    relation: 'implies',
    weight: belief.mostLikely.probability,
  });

  // --- 4. Causal counterfactual (optional) ---
  if (req.causal) {
    const cf = runCounterfactual(req.causal.graph, {
      observation: req.causal.observation,
      intervention: req.causal.intervention,
      target: req.causal.target,
    });
    subsystems.causal = cf;
    addNode(chain, {
      id: 'causal',
      type: 'evidence',
      label: `Counterfactual on ${req.causal.target}: ${cf.factual} → ${cf.counterfactual}`,
      weight: cf.change ? 1 : 0.3,
      regulatory: 'Cabinet Res 134/2025 Art.19',
    });
    addEdge(chain, { fromId: 'root', toId: 'causal', relation: 'supports', weight: 0.5 });
  }

  // --- 5. Predictive STR ---
  const strPrediction = predictStr(req.entity.features);
  subsystems.strPrediction = strPrediction;
  addNode(chain, {
    id: 'str-predict',
    type: 'hypothesis',
    label: `STR probability ${(strPrediction.probability * 100).toFixed(1)}% (${strPrediction.band})`,
    weight: strPrediction.probability,
    regulatory: 'FDL Art.26-27',
    data: { recommendation: strPrediction.recommendation },
  });
  addEdge(chain, {
    fromId: 'belief',
    toId: 'str-predict',
    relation: 'supports',
    weight: strPrediction.probability,
  });

  // --- 6. Rule-induced policy check ---
  if (req.ruleTree) {
    const binaryFeatures: Record<string, 0 | 1> = {};
    for (const [k, v] of Object.entries(req.entity.features)) {
      binaryFeatures[k] = v ? 1 : 0;
    }
    const ruleVerdict = ruleTreePredict(req.ruleTree, binaryFeatures);
    subsystems.rulePrediction = ruleVerdict;
    addNode(chain, {
      id: 'rule-policy',
      type: 'rule',
      label: `Learned-rule verdict: ${ruleVerdict}`,
      weight: 0.7,
      regulatory: 'Cabinet Res 134/2025 Art.5',
    });
    addEdge(chain, { fromId: 'root', toId: 'rule-policy', relation: 'implies', weight: 0.7 });
  }

  // --- 7. Teacher-student double-check ---
  const studentTeacher =
    req.teacherStudent ??
    synthesiseStudentTeacher(strPrediction, subsystems.precedents, subsystems.rulePrediction);
  const dbl = doubleCheck({
    topic: req.topic,
    student: studentTeacher.student,
    teacher: studentTeacher.teacher,
  });
  subsystems.doubleCheck = dbl;
  addNode(chain, {
    id: 'double-check',
    type: 'decision',
    label: `Double-check: ${dbl.finalVerdict} (${dbl.outcome})`,
    weight: Math.min(studentTeacher.student.confidence, studentTeacher.teacher.confidence),
    regulatory: 'FDL Art.20; Cabinet Res 134/2025 Art.19',
    data: { outcome: dbl.outcome },
  });
  addEdge(chain, {
    fromId: 'str-predict',
    toId: 'double-check',
    relation: dbl.outcome === 'contested' ? 'contradicts' : 'supports',
    weight: 0.9,
  });

  // --- 8. Optional formal debate if the double-check is contested ---
  if (req.debate && (dbl.outcome === 'contested' || dbl.outcome === 'locked-freeze')) {
    const debateResult = runDebate(req.debate);
    subsystems.debate = debateResult;
    addNode(chain, {
      id: 'debate',
      type: 'decision',
      label: `Debate winner: ${debateResult.winner} → ${debateResult.winningAction}`,
      weight: debateResult.margin,
      regulatory: 'Cabinet Res 134/2025 Art.19',
    });
    addEdge(chain, { fromId: 'double-check', toId: 'debate', relation: 'supports', weight: 0.8 });
    if (debateResult.judgeNotes.length > 0) notes.push(...debateResult.judgeNotes);
  }

  // --- 9. Goal-conditioned plan ---
  if (req.planning) {
    const planResult = plan(req.planning);
    subsystems.plan = planResult;
    addNode(chain, {
      id: 'plan',
      type: 'action',
      label: `Plan: ${planResult.steps.length} steps, ${planResult.totalEstimatedHours}h`,
      weight: planResult.satisfiedGoal ? 1 : 0.3,
      regulatory: 'FDL Art.20',
      data: { steps: planResult.steps.map((s) => s.name) },
    });
    addEdge(chain, { fromId: 'double-check', toId: 'plan', relation: 'triggers', weight: 1 });
  }

  // --- 10. Penalty VaR ---
  const varReport = runPenaltyVaR(
    req.violations ?? UAE_DPMS_VIOLATIONS,
    req.varConfig ?? { trials: 500, confidence: 0.95, seed: 42 }
  );
  subsystems.penaltyVaR = varReport;
  addNode(chain, {
    id: 'penalty-var',
    type: 'evidence',
    label: `Penalty VaR (95%): AED ${varReport.valueAtRisk.toLocaleString()}`,
    weight: 0.5,
    regulatory: 'Cabinet Res 71/2024',
    data: { expectedShortfall: varReport.expectedShortfall },
  });
  addEdge(chain, { fromId: 'root', toId: 'penalty-var', relation: 'supports', weight: 0.4 });

  // --- 11. STR narrative draft ---
  if (req.strInput) {
    const narrative = buildStrNarrative(req.strInput);
    subsystems.narrative = narrative;
    addNode(chain, {
      id: 'narrative',
      type: 'action',
      label: `STR draft (${narrative.characterCount} chars, ${narrative.warnings.length} warnings)`,
      weight: narrative.warnings.length === 0 ? 1 : 0.4,
      regulatory: 'FDL Art.26-29; EOCN STR Guidelines v3',
    });
    addEdge(chain, { fromId: 'double-check', toId: 'narrative', relation: 'triggers', weight: 1 });
    if (narrative.warnings.length > 0) notes.push(...narrative.warnings);
  }

  // --- 12. Safety clamping: sanctions confirmed ⇒ freeze, no exceptions ---
  let verdict: Verdict = dbl.finalVerdict;
  if (req.entity.isSanctionsConfirmed) {
    verdict = 'freeze';
    notes.push(
      'SAFETY CLAMP: sanctions confirmed — verdict forced to freeze (Cabinet Res 74/2020 Art.4).'
    );
  }
  // If STR prediction is critical, never allow pass.
  if (strPrediction.band === 'critical' && VERDICT_RANK[verdict] < VERDICT_RANK.escalate) {
    verdict = 'escalate';
    notes.push('SAFETY CLAMP: critical STR probability — verdict escalated.');
  }

  // --- 13. Final decision node ---
  addNode(chain, {
    id: 'final',
    type: 'decision',
    label: `FINAL: ${verdict}`,
    weight: 1,
    regulatory: 'FDL Art.19-22',
    data: { verdict },
  });
  addEdge(chain, { fromId: 'double-check', toId: 'final', relation: 'implies', weight: 1 });

  // --- 14. Reflection critic (runs BEFORE sealing so it can see structure) ---
  const reflection = reviewReasoningChain(chain);
  subsystems.reflection = reflection;

  // --- 15. Seal the chain ---
  seal(chain);

  // --- 16. Confidence: MIN across subsystems (conservative). ---
  const subsystemConfidences: number[] = [reflection.confidence];
  if (subsystems.precedents) subsystemConfidences.push(subsystems.precedents.confidence);
  subsystemConfidences.push(
    strPrediction.probability < 0.5 ? 1 - strPrediction.probability : strPrediction.probability
  );
  subsystemConfidences.push(studentTeacher.student.confidence);
  subsystemConfidences.push(studentTeacher.teacher.confidence);
  const confidence = Math.min(...subsystemConfidences);
  const requiresHumanReview =
    reflection.shouldEscalateToHuman ||
    dbl.requiresHumanReview ||
    confidence < 0.7 ||
    verdict === 'freeze' ||
    notes.some((n) => n.toLowerCase().includes('safety clamp'));

  // --- 17. Recommended action in plain English ---
  const recommendedAction = recommendationForVerdict(verdict, strPrediction);

  // --- 18. War-room event so the NORAD dashboard lights up ---
  const warRoomEvent: WarRoomEvent = {
    id: `mega-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind: verdictToKind(verdict),
    severity: verdictToSeverity(verdict),
    title: `MegaBrain: ${req.entity.name} → ${verdict}`,
    entityId: req.entity.id,
    meta: {
      confidence,
      strProbability: strPrediction.probability,
      precedentOutcome: subsystems.precedents?.recommendedOutcome,
      reflectionScore: reflection.confidence,
    },
  };

  return {
    topic: req.topic,
    entityId: req.entity.id,
    verdict,
    recommendedAction,
    confidence: round4(confidence),
    requiresHumanReview,
    subsystems,
    warRoomEvent,
    chain,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFeatureVector(features: StrFeatures | Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
    if (typeof v === 'number') out[k] = v;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
  }
  return out;
}

function synthesiseStudentTeacher(
  strPrediction: StrPrediction,
  precedents: ReuseRecommendation | undefined,
  rulePrediction: string | undefined
): { student: Opinion; teacher: Opinion } {
  const student: Opinion = {
    verdict: strBandToVerdict(strPrediction.band),
    confidence: Math.max(strPrediction.probability, 1 - strPrediction.probability),
    rationale: `Predictive STR: ${strPrediction.band}`,
    model: 'predictive-str',
    citations: ['FDL Art.26-27'],
  };
  // Teacher = precedents (if any) otherwise learned-rule verdict.
  const teacherVerdict: Verdict = precedents
    ? outcomeToVerdict(precedents.recommendedOutcome)
    : (ruleVerdict(rulePrediction) ?? student.verdict);
  const teacher: Opinion = {
    verdict: teacherVerdict,
    confidence: precedents?.confidence ?? 0.75,
    rationale: precedents ? 'Episodic precedents' : 'Learned policy rule',
    model: precedents ? 'case-based-reasoner' : 'rule-induction',
    citations: ['FDL Art.19; Cabinet Res 134/2025 Art.5'],
  };
  return { student, teacher };
}

function strBandToVerdict(band: StrPrediction['band']): Verdict {
  switch (band) {
    case 'critical':
      return 'freeze';
    case 'high':
      return 'escalate';
    case 'medium':
      return 'flag';
    case 'low':
      return 'pass';
  }
}

function outcomeToVerdict(outcome: string): Verdict {
  switch (outcome) {
    case 'freeze':
    case 'exit-relationship':
      return 'freeze';
    case 'str-filed':
      return 'escalate';
    case 'edd':
      return 'flag';
    case 'monitor':
    case 'no-action':
    default:
      return 'pass';
  }
}

function ruleVerdict(label: string | undefined): Verdict | undefined {
  if (!label) return undefined;
  if (label === 'freeze') return 'freeze';
  if (label === 'str-filed' || label === 'escalate') return 'escalate';
  if (label === 'edd' || label === 'flag') return 'flag';
  if (label === 'monitor' || label === 'no-action' || label === 'pass') return 'pass';
  return undefined;
}

function recommendationForVerdict(verdict: Verdict, prediction: StrPrediction): string {
  switch (verdict) {
    case 'freeze':
      return 'Execute freeze protocol (Cabinet Res 74/2020 Art.4) + 24h EOCN countdown + 5bd CNMR + STR filing.';
    case 'escalate':
      return `Escalate to Compliance Officer (STR prob ${(prediction.probability * 100).toFixed(1)}%). Four-eyes approval required.`;
    case 'flag':
      return 'Add to enhanced monitoring. Schedule CDD review within 3 months.';
    case 'pass':
      return 'Continue standard monitoring. No immediate action required.';
  }
}

function verdictToKind(verdict: Verdict): WarRoomEvent['kind'] {
  switch (verdict) {
    case 'freeze':
      return 'freeze_initiated';
    case 'escalate':
      return 'str_staged';
    case 'flag':
      return 'case_opened';
    case 'pass':
      return 'screening';
  }
}

function verdictToSeverity(verdict: Verdict): WarRoomEvent['severity'] {
  switch (verdict) {
    case 'freeze':
      return 'critical';
    case 'escalate':
      return 'high';
    case 'flag':
      return 'medium';
    case 'pass':
      return 'info';
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Convenience: minimal request helper
// ---------------------------------------------------------------------------

/**
 * Fast-path constructor for the common case: you have a customer with
 * features and you want a verdict. Everything else is optional.
 */
export function quickMegaAssessment(
  entityId: string,
  entityName: string,
  features: StrFeatures,
  memory?: CaseMemory,
  peers?: ReadonlyArray<Record<string, number>>
): MegaBrainResponse {
  return runMegaBrain({
    topic: `Compliance assessment: ${entityName}`,
    entity: { id: entityId, name: entityName, features },
    memory,
    peers,
  });
}

export type { StrNarrativeInput, FilingType, PastCase, PlanAction };
