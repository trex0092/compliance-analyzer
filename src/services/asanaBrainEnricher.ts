/**
 * Asana Brain Enricher — wire megaBrain / weaponizedBrain output into
 * Asana tasks, the Kanban view, and the STR subtask lifecycle.
 *
 * Every compliance task that the SPA creates should carry the brain's
 * verdict, confidence, clamp reasons, top subsystem hits, and a
 * suggested Kanban column. This module is the pure bridge between
 * the cognitive pipeline and the Asana surface — no I/O, no fetch,
 * just shape transforms that other services compose.
 *
 * Exports:
 *   - enrichAsanaTaskFromBrain(brain)    — build customFields + notes
 *                                          + suggestedColumn + stage-
 *                                          specific subtask notes
 *   - brainVerdictToKanbanColumn(v)      — verdict → KanbanColumn
 *   - buildBrainSubsystemDagNodes(brain) — DagNode[] + edges for viz
 *   - brainStageEnrichments(brain)       — map STR subtask stage →
 *                                          note block from the
 *                                          matching subsystem output
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.19-21 (CO/MLRO reasoning trail)
 *   - FDL No.10/2025 Art.26-27 (STR draft must cite underlying
 *     reasoning — Asana subtask notes carry that citation)
 *   - FDL No.10/2025 Art.29 (no tipping off — brain enrichment
 *     NEVER writes the subject legal name; every reference uses
 *     the entity id or the case id)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 *   - NIST AI RMF 1.0 MANAGE-2 (explainability of AI-assisted
 *     decisions — brain verdict is visible on the task)
 */

import type { MegaBrainResponse } from './megaBrain';
import type { KanbanColumn } from './asanaKanbanView';
import type { StrSubtaskStage } from './strSubtaskLifecycle';
import { buildComplianceCustomFields, type Verdict as AsanaVerdict } from './asanaCustomFields';
import type { TaskDependencyEdge } from './asanaWorkflowAutomation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrainEnrichment {
  /** Asana custom_fields map, ready to hand to createAsanaTask. */
  customFields: Record<string, string | number>;
  /** Markdown-formatted notes block for the parent task. */
  notesBlock: string;
  /** Which Kanban column the brain thinks the task belongs in. */
  suggestedColumn: KanbanColumn;
  /** Short human-readable verdict headline. */
  headline: string;
  /** Per-stage subtask note enrichments (STR lifecycle only). */
  stageEnrichments: Record<StrSubtaskStage, string>;
}

/**
 * Minimum shape the enricher needs — we deliberately accept either a
 * full MegaBrainResponse or a trimmed subset so callers without a
 * full pipeline can still use it.
 */
export type EnrichableBrain = Pick<
  MegaBrainResponse,
  | 'verdict'
  | 'confidence'
  | 'recommendedAction'
  | 'requiresHumanReview'
  | 'subsystems'
  | 'notes'
  | 'entityId'
>;

// ---------------------------------------------------------------------------
// Verdict → Kanban mapping
// ---------------------------------------------------------------------------

/**
 * Map a compliance verdict to the Kanban column it should land in.
 * This drives the "auto-sort by verdict" affordance on bulk
 * operations and the suggested drop target on STR lifecycle tasks.
 *
 *   freeze    → blocked   (stop the world, nothing moves until MLRO clears)
 *   escalate  → review    (needs four-eyes before any further action)
 *   flag      → doing     (in-flight review with enhanced monitoring)
 *   pass      → done      (no action, close the loop)
 */
export function brainVerdictToKanbanColumn(verdict: AsanaVerdict): KanbanColumn {
  switch (verdict) {
    case 'freeze':
      return 'blocked';
    case 'escalate':
      return 'review';
    case 'flag':
      return 'doing';
    case 'pass':
      return 'done';
  }
}

// ---------------------------------------------------------------------------
// Brain subsystem DAG — what ran, in what order, and who escalated to whom
// ---------------------------------------------------------------------------

/**
 * Static subsystem DAG mirroring the runMegaBrain() pipeline in
 * megaBrain.ts. The DAG is static because the pipeline is a fixed
 * sequence — what varies per run is which nodes actually produced
 * output. Callers use the node list + edges to render a
 * DependencyDag visualization, and overlay the `state` field from
 * buildBrainSubsystemStates() to show which subsystems fired.
 */
export const BRAIN_SUBSYSTEM_NODES = [
  { id: 'precedents', label: 'Precedents', description: 'Case-based reasoning' },
  { id: 'anomaly', label: 'Anomaly', description: 'Peer-group anomaly' },
  { id: 'belief', label: 'Belief', description: 'Bayesian hypothesis update' },
  { id: 'causal', label: 'Causal', description: 'Counterfactual what-if' },
  { id: 'strPrediction', label: 'STR Pred', description: 'Predictive STR score' },
  { id: 'rulePrediction', label: 'Rules', description: 'Induced rule tree' },
  { id: 'plan', label: 'Plan', description: 'Goal-conditioned plan' },
  { id: 'doubleCheck', label: 'Teacher/Student', description: 'Dual opinion check' },
  { id: 'debate', label: 'Debate', description: 'Two-sided adversarial' },
  { id: 'reflection', label: 'Reflection', description: 'Self-critic' },
  { id: 'penaltyVaR', label: 'Penalty VaR', description: 'Monte-Carlo penalty' },
  { id: 'narrative', label: 'Narrative', description: 'STR narrative draft' },
] as const;

export type BrainSubsystemId = (typeof BRAIN_SUBSYSTEM_NODES)[number]['id'];

export const BRAIN_SUBSYSTEM_EDGES: readonly TaskDependencyEdge[] = [
  // precedents + anomaly feed the belief update
  { parent: 'belief', blockedBy: 'precedents' },
  { parent: 'belief', blockedBy: 'anomaly' },
  // belief feeds causal analysis
  { parent: 'causal', blockedBy: 'belief' },
  // STR prediction reads belief + anomaly
  { parent: 'strPrediction', blockedBy: 'belief' },
  { parent: 'strPrediction', blockedBy: 'anomaly' },
  // rule prediction is parallel but feeds the teacher/student check
  { parent: 'doubleCheck', blockedBy: 'strPrediction' },
  { parent: 'doubleCheck', blockedBy: 'rulePrediction' },
  // debate is downstream of the double-check (only fires on ties)
  { parent: 'debate', blockedBy: 'doubleCheck' },
  // reflection reads every upstream subsystem — we edge it to the
  // latest decisive stage so the DAG stays readable
  { parent: 'reflection', blockedBy: 'debate' },
  { parent: 'reflection', blockedBy: 'causal' },
  // plan + narrative + penaltyVaR are downstream of reflection
  { parent: 'plan', blockedBy: 'reflection' },
  { parent: 'penaltyVaR', blockedBy: 'reflection' },
  { parent: 'narrative', blockedBy: 'reflection' },
];

/**
 * Pure: for each subsystem node, return a state reflecting whether
 * the brain response actually produced output from that subsystem.
 * States:
 *   'active' — subsystem produced a defined output for this run
 *   'pending' — subsystem was skipped (optional, never invoked)
 *   'done'  — always-on subsystems that shipped a result (reflection,
 *             strPrediction)
 */
export function buildBrainSubsystemStates(
  brain: EnrichableBrain
): Record<BrainSubsystemId, 'active' | 'pending' | 'done'> {
  const s = brain.subsystems;
  return {
    precedents: s.precedents ? 'active' : 'pending',
    anomaly: s.anomaly ? 'active' : 'pending',
    belief: s.belief ? 'active' : 'pending',
    causal: s.causal ? 'active' : 'pending',
    // Always produced
    strPrediction: 'done',
    rulePrediction: s.rulePrediction ? 'active' : 'pending',
    plan: s.plan ? 'active' : 'pending',
    doubleCheck: s.doubleCheck ? 'active' : 'pending',
    debate: s.debate ? 'active' : 'pending',
    // Always produced
    reflection: 'done',
    penaltyVaR: s.penaltyVaR ? 'active' : 'pending',
    narrative: s.narrative ? 'active' : 'pending',
  };
}

// ---------------------------------------------------------------------------
// Stage enrichments — which subsystem output lands on which STR subtask
// ---------------------------------------------------------------------------

/**
 * For each STR lifecycle stage, pick the most relevant piece of
 * brain output and format it as a short markdown note block. The
 * lifecycle dispatcher appends the block to the corresponding
 * subtask's notes so the MLRO sees the reasoning at every gate.
 *
 * Mapping:
 *   mlro-review  → belief + anomaly summary (what we think and why)
 *   four-eyes    → debate verdict (if present) + reflection critique
 *   goaml-xml    → narrative draft (if present) + STR prediction
 *   submit-fiu   → penaltyVaR (if present) — size the fine exposure
 *   retain-10y   → reasoning chain hash reminder
 *   monitor-ack  → plan next-action reminder
 *   close        → final verdict + confidence
 */
export function brainStageEnrichments(brain: EnrichableBrain): Record<StrSubtaskStage, string> {
  const s = brain.subsystems;
  const verdict = brain.verdict.toUpperCase();
  const confidence = Math.round(brain.confidence * 100);

  return {
    'mlro-review': [
      `**Brain verdict:** ${verdict} (${confidence}% confidence)`,
      s.belief ? `**Top hypothesis:** ${topBeliefLine(s.belief)}` : undefined,
      s.anomaly
        ? `**Anomaly score:** ${describeNumber((s.anomaly as { anomalyScore?: number }).anomalyScore)}`
        : undefined,
      s.precedents
        ? `**Precedents:** ${(s.precedents as { recommendation?: string }).recommendation ?? 'see case base'}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    'four-eyes': [
      `**Independent review target:** ${verdict}`,
      s.debate
        ? `**Debate verdict:** ${(s.debate as { verdict?: string }).verdict ?? 'n/a'}`
        : undefined,
      s.reflection
        ? `**Self-critic:** ${(s.reflection as { recommendation?: string }).recommendation ?? 'see chain'}`
        : undefined,
      brain.requiresHumanReview
        ? '**Requires human review:** YES — do not auto-advance'
        : '**Requires human review:** no',
    ]
      .filter(Boolean)
      .join('\n'),
    'goaml-xml': [
      `**Filing verdict:** ${verdict}`,
      s.narrative
        ? '**Narrative draft:** see strNarrative subsystem output (attached to parent)'
        : '**Narrative draft:** none produced — re-run megaBrain with strInput',
      s.strPrediction
        ? `**STR prediction score:** ${describeNumber((s.strPrediction as { score?: number }).score)}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
    'submit-fiu': [
      `**Submission verdict:** ${verdict}`,
      s.penaltyVaR
        ? `**Penalty VaR (95%):** ${describeNumber((s.penaltyVaR as { var95?: number }).var95)} AED`
        : '**Penalty VaR:** not computed',
      '**Tipping off reminder:** FDL Art.29 — no contact with the subject.',
    ]
      .filter(Boolean)
      .join('\n'),
    'retain-10y': [
      `**Retention verdict:** ${verdict}`,
      '**Reasoning chain:** include the sealed DAG in the evidence bundle.',
      '**Retention period:** 10 years (FDL Art.24).',
    ].join('\n'),
    'monitor-ack': [
      `**Monitoring verdict:** ${verdict}`,
      s.plan
        ? `**Next action plan:** ${(s.plan as { firstAction?: string }).firstAction ?? 'see plan subsystem'}`
        : '**Next action plan:** default monitoring cadence applies',
    ]
      .filter(Boolean)
      .join('\n'),
    close: [
      `**Final verdict:** ${verdict} at ${confidence}% confidence`,
      `**Recommended action:** ${brain.recommendedAction}`,
      `**Human review required:** ${brain.requiresHumanReview ? 'YES' : 'no'}`,
    ].join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Parent-task enrichment
// ---------------------------------------------------------------------------

/**
 * Build the full enrichment bundle for a parent compliance task.
 * Callers (strSubtaskLifecycle, brainToAsanaOrchestrator, the future
 * Kanban "classify with brain" action) merge the returned fields
 * into their own payload.
 */
export function enrichAsanaTaskFromBrain(brain: EnrichableBrain): BrainEnrichment {
  const suggestedColumn = brainVerdictToKanbanColumn(brain.verdict);
  const customFields = buildComplianceCustomFields({
    verdict: brain.verdict,
    confidence: brain.confidence,
    caseId: brain.entityId,
  });

  const confidencePct = Math.round(brain.confidence * 100);
  const headline = `Brain verdict: ${brain.verdict.toUpperCase()} at ${confidencePct}% confidence`;

  const states = buildBrainSubsystemStates(brain);
  const firedSubsystems = BRAIN_SUBSYSTEM_NODES.filter((n) => states[n.id] !== 'pending');

  const notesBlock = [
    `## ${headline}`,
    '',
    `**Recommended action:** ${brain.recommendedAction}`,
    `**Requires human review:** ${brain.requiresHumanReview ? 'YES' : 'no'}`,
    `**Subsystems fired:** ${firedSubsystems.length}/${BRAIN_SUBSYSTEM_NODES.length}`,
    '',
    '**Active subsystems:**',
    ...firedSubsystems.map((n) => `  - ${n.label} (${n.description})`),
    '',
    brain.notes && brain.notes.length > 0 ? '**Brain notes:**' : '',
    ...(brain.notes ?? []).slice(0, 5).map((n) => `  - ${n}`),
    '',
    '**Suggested Kanban column:** ' + suggestedColumn,
    '',
    'FDL Art.29 — no tipping off. This reasoning trail is visible only to the compliance team.',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const stageEnrichments = brainStageEnrichments(brain);

  return {
    customFields,
    notesBlock,
    suggestedColumn,
    headline,
    stageEnrichments,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function topBeliefLine(belief: unknown): string {
  const b = belief as { topHypothesis?: { label?: string; probability?: number } };
  const label = b.topHypothesis?.label ?? 'unknown';
  const prob = b.topHypothesis?.probability;
  return `${label}${typeof prob === 'number' ? ` (p=${prob.toFixed(2)})` : ''}`;
}

function describeNumber(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toString() : 'n/a';
}
