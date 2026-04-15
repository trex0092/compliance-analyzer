/**
 * Asana Scorecard — parallel self-report for the Asana brain
 * (orchestration layer), scored on the same three axes as the
 * tool brain: intelligent / smart / autonomous.
 *
 * Each axis is normalized to 100 points across 10 equally-weighted
 * legal capabilities, so a fully-active orchestrator legitimately
 * reports 100/100/100. Tier C violation zeroes the autonomy axis.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22, Art.24, Art.29
 *   Cabinet Res 74/2020 Art.4-7
 *   Cabinet Res 134/2025 Art.12-14, Art.19
 *   EU AI Act Art.13, Art.15
 *   NIST AI RMF 1.0 MEASURE-2, GOVERN-3, MANAGE-2/3
 *   ISO/IEC 42001
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AsanaIntelligenceInput {
  /** Orchestrator façade fired. */
  orchestratorInvoked: boolean;
  /** Idempotency contract applied. */
  idempotencyApplied: boolean;
  /** Retry queue with exponential backoff wired. */
  retryQueueActive: boolean;
  /** Skill runner registry consulted. */
  skillRegistryConsulted: boolean;
  /** Webhook router matched event to handler. */
  webhookRouted: boolean;
  /** SLA enforcer clock ticking on section entry. */
  slaEnforcerActive: boolean;
  /** CO load balancer picked a workload-aware assignee. */
  coLoadBalancerApplied: boolean;
  /** Meta-Asana router produced a minimal handler plan. */
  metaRouterApplied: boolean;
  /** Learned priority model ranked pending tasks. */
  learnedPriorityApplied: boolean;
  /** Incident burst forecaster produced an upcoming-hour prediction. */
  burstForecastProduced: boolean;
}

export interface AsanaSmartInput {
  /** SHA3-512 idempotency keys in use. */
  sha3IdempotencyKeys: boolean;
  /** Audit mirror writes every state change. */
  auditMirrorActive: boolean;
  /** Self-approval rejection enforced at all layers. */
  selfApprovalRejected: boolean;
  /** Comment mirror running. */
  commentMirrorActive: boolean;
  /** Section write-back wired. */
  sectionWriteBackActive: boolean;
  /** Schema migrator confirmed workspace schema matches expected. */
  schemaMigrationVerified: boolean;
  /** Four-eyes pair materialised as tasks A+B. */
  fourEyesAsTasks: boolean;
  /** Workload-aware load balancing active. */
  workloadLoadBalancing: boolean;
  /** Bidirectional sync health green. */
  bidirectionalSyncHealthy: boolean;
  /** Self-healing webhook reconciler emitted a plan (clean or corrective). */
  selfHealingReconcilerRun: boolean;
}

export interface AsanaAutonomousInput {
  /** Auto-dispatch on brain verdict without manual click. */
  autoDispatched: boolean;
  /** Retry queue auto-retried a failed call. */
  autoRetried: boolean;
  /** Dead-letter drain cron drained pending entries. */
  autoDeadLetterDrained: boolean;
  /** SLA auto-escalated a breached task. */
  autoEscalated: boolean;
  /** Section write-back moved the task without manual intervention. */
  autoSectionMoved: boolean;
  /** Tenant provisioner auto-stood-up a new tenant. */
  autoTenantProvisioned: boolean;
  /** Schema migrator auto-applied workspace schema. */
  autoSchemaMigrated: boolean;
  /** Weekly digest cron auto-emitted the digest. */
  autoWeeklyDigest: boolean;
  /** SLA breach predictor ran unattended. */
  autoBreachPredicted: boolean;
  /** Self-healing reconciler auto-executed its plan. */
  autoReconcilerExecuted: boolean;
  /**
   * Tier C violations: four-eyes bypass, customer-facing auto-send,
   * idempotency-key collision not logged. Non-zero → 0.
   */
  tierCViolations: number;
}

export interface AsanaScorecard {
  schemaVersion: 1;
  intelligent: number;
  smart: number;
  autonomous: number;
  composite: number;
  breakdown: {
    intelligent: ReadonlyArray<{ label: string; points: number; max: number }>;
    smart: ReadonlyArray<{ label: string; points: number; max: number }>;
    autonomous: ReadonlyArray<{ label: string; points: number; max: number }>;
  };
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const POINTS_PER_LAYER = 10;

function scoreLayers(layers: ReadonlyArray<{ label: string; active: boolean }>): {
  score: number;
  breakdown: ReadonlyArray<{ label: string; points: number; max: number }>;
} {
  const breakdown = layers.map((l) => ({
    label: l.label,
    points: l.active ? POINTS_PER_LAYER : 0,
    max: POINTS_PER_LAYER,
  }));
  return { score: breakdown.reduce((a, b) => a + b.points, 0), breakdown };
}

function scoreAsanaIntelligence(input: AsanaIntelligenceInput) {
  return scoreLayers([
    { label: 'Orchestrator façade invoked', active: input.orchestratorInvoked },
    { label: 'Idempotency contract applied', active: input.idempotencyApplied },
    { label: 'Retry queue w/ exponential backoff', active: input.retryQueueActive },
    { label: 'Skill runner registry consulted', active: input.skillRegistryConsulted },
    { label: 'Webhook router matched event', active: input.webhookRouted },
    { label: 'SLA enforcer active on section', active: input.slaEnforcerActive },
    { label: 'CO load balancer applied', active: input.coLoadBalancerApplied },
    { label: 'Meta-Asana router applied', active: input.metaRouterApplied },
    { label: 'Learned priority model applied', active: input.learnedPriorityApplied },
    { label: 'Incident burst forecast produced', active: input.burstForecastProduced },
  ]);
}

function scoreAsanaSmart(input: AsanaSmartInput) {
  return scoreLayers([
    { label: 'SHA3-512 idempotency keys', active: input.sha3IdempotencyKeys },
    { label: 'Audit mirror writes state changes', active: input.auditMirrorActive },
    { label: 'Self-approval rejection enforced', active: input.selfApprovalRejected },
    { label: 'Comment mirror active', active: input.commentMirrorActive },
    { label: 'Section write-back active', active: input.sectionWriteBackActive },
    { label: 'Schema migration verified', active: input.schemaMigrationVerified },
    { label: 'Four-eyes materialised as paired tasks', active: input.fourEyesAsTasks },
    { label: 'Workload-aware load balancing', active: input.workloadLoadBalancing },
    { label: 'Bidirectional sync healthy', active: input.bidirectionalSyncHealthy },
    { label: 'Self-healing webhook reconciler run', active: input.selfHealingReconcilerRun },
  ]);
}

function scoreAsanaAutonomous(input: AsanaAutonomousInput) {
  if (input.tierCViolations > 0) {
    return {
      score: 0,
      breakdown: [
        {
          label: `Tier C violation detected (${input.tierCViolations}) — autonomy zeroed`,
          points: 0,
          max: 100,
        },
      ],
    };
  }
  return scoreLayers([
    { label: 'Auto-dispatched on verdict', active: input.autoDispatched },
    { label: 'Auto-retry on transient failure', active: input.autoRetried },
    { label: 'Dead-letter auto-drained', active: input.autoDeadLetterDrained },
    { label: 'SLA auto-escalated', active: input.autoEscalated },
    { label: 'Section write-back automatic', active: input.autoSectionMoved },
    { label: 'Tenant auto-provisioned', active: input.autoTenantProvisioned },
    { label: 'Schema auto-migrated', active: input.autoSchemaMigrated },
    { label: 'Weekly digest auto-emitted', active: input.autoWeeklyDigest },
    { label: 'SLA breach auto-predicted', active: input.autoBreachPredicted },
    { label: 'Reconciler auto-executed', active: input.autoReconcilerExecuted },
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildAsanaScorecard(
  intelligence: AsanaIntelligenceInput,
  smart: AsanaSmartInput,
  autonomous: AsanaAutonomousInput
): AsanaScorecard {
  const i = scoreAsanaIntelligence(intelligence);
  const s = scoreAsanaSmart(smart);
  const a = scoreAsanaAutonomous(autonomous);
  const composite = Math.round((i.score + s.score + a.score) / 3);
  return {
    schemaVersion: 1,
    intelligent: i.score,
    smart: s.score,
    autonomous: a.score,
    composite,
    breakdown: {
      intelligent: i.breakdown,
      smart: s.breakdown,
      autonomous: a.breakdown,
    },
    summary:
      `Asana brain scorecard: ${i.score}% intelligent / ${s.score}% smart / ` +
      `${a.score}% autonomous (composite ${composite}%). Tier C kill switch ` +
      `${autonomous.tierCViolations === 0 ? 'clean' : 'FIRED'}.`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'FDL No.10/2025 Art.29',
      'Cabinet Res 74/2020 Art.4-7',
      'Cabinet Res 134/2025 Art.12-14',
      'Cabinet Res 134/2025 Art.19',
      'EU AI Act Art.13',
      'EU AI Act Art.15',
      'NIST AI RMF 1.0 MEASURE-2',
      'NIST AI RMF 1.0 GOVERN-3',
      'NIST AI RMF 1.0 MANAGE-2',
      'NIST AI RMF 1.0 MANAGE-3',
      'ISO/IEC 42001',
    ],
  };
}

export function buildMaxActiveAsanaInputs(): {
  intelligence: AsanaIntelligenceInput;
  smart: AsanaSmartInput;
  autonomous: AsanaAutonomousInput;
} {
  return {
    intelligence: {
      orchestratorInvoked: true,
      idempotencyApplied: true,
      retryQueueActive: true,
      skillRegistryConsulted: true,
      webhookRouted: true,
      slaEnforcerActive: true,
      coLoadBalancerApplied: true,
      metaRouterApplied: true,
      learnedPriorityApplied: true,
      burstForecastProduced: true,
    },
    smart: {
      sha3IdempotencyKeys: true,
      auditMirrorActive: true,
      selfApprovalRejected: true,
      commentMirrorActive: true,
      sectionWriteBackActive: true,
      schemaMigrationVerified: true,
      fourEyesAsTasks: true,
      workloadLoadBalancing: true,
      bidirectionalSyncHealthy: true,
      selfHealingReconcilerRun: true,
    },
    autonomous: {
      autoDispatched: true,
      autoRetried: true,
      autoDeadLetterDrained: true,
      autoEscalated: true,
      autoSectionMoved: true,
      autoTenantProvisioned: true,
      autoSchemaMigrated: true,
      autoWeeklyDigest: true,
      autoBreachPredicted: true,
      autoReconcilerExecuted: true,
      tierCViolations: 0,
    },
  };
}

// Exports for tests.
export const __test__ = { scoreAsanaIntelligence, scoreAsanaSmart, scoreAsanaAutonomous };
