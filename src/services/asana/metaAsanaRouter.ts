/**
 * Meta-Asana Router — minimal dispatch-adapter + skill-runner
 * selector for the Asana orchestrator.
 *
 * Why this exists:
 *   The Asana orchestrator today runs the full dispatcher pipeline
 *   (productionDispatchAdapter + tierCAsanaDispatch + fourEyesSubtaskCreator
 *   + skillRunnerRegistry) on every inbound event. For 80% of
 *   events only a small subset is actually relevant. The meta
 *   router classifies the event and returns the minimal set of
 *   handlers that should fire.
 *
 *   Mirror of `metaBrainRouter.ts` on the Asana side.
 *
 *   Pure function — same event → same plan.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility — routing is auditable)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   EU AI Act Art.13         (transparent routing)
 *   NIST AI RMF 1.0 MANAGE-2 (resource allocation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AsanaEventKind =
  | 'brain-verdict'
  | 'tierc-clamp-accepted'
  | 'tierc-outbound-release'
  | 'tierc-break-glass-approved'
  | 'tierc-zk-collision'
  | 'sla-escalation'
  | 'comment-added'
  | 'webhook-delivered'
  | 'cron-sync';

export type HandlerId =
  | 'orchestrator.dispatch'
  | 'productionDispatchAdapter'
  | 'tierCAsanaDispatch'
  | 'fourEyesSubtaskCreator'
  | 'asanaCustomFieldRouter'
  | 'asanaSectionWriteBack'
  | 'asanaCommentMirror'
  | 'asanaSlaEnforcer'
  | 'asanaSlaAutoEscalation'
  | 'asanaWebhookRouter'
  | 'skillRunnerRegistry'
  | 'asanaBulkOperations'
  | 'asanaSchemaMigrator'
  | 'coLoadBalancer'
  | 'orchestrator.idempotencyCheck';

export interface AsanaEvent {
  kind: AsanaEventKind;
  tenantId: string;
  /** Verdict level when applicable. */
  verdict?: 'pass' | 'flag' | 'escalate' | 'freeze';
  /** Whether the event requires four-eyes handling. */
  requiresFourEyes?: boolean;
  /** Whether the event is a write (vs read-only). */
  isWrite?: boolean;
  /** Has the event been idempotency-checked already? */
  idempotencyChecked?: boolean;
}

export interface RoutingRule {
  handler: HandlerId;
  reason: string;
  predicate?: (event: AsanaEvent) => boolean;
  regulatory: string;
}

export interface AsanaRoutingDecision {
  handler: HandlerId;
  fire: boolean;
  reason: string;
  regulatory: string;
}

export interface AsanaRoutingReport {
  schemaVersion: 1;
  eventKind: AsanaEventKind;
  totalHandlers: number;
  firedHandlers: number;
  skippedHandlers: number;
  firingRatio: number;
  decisions: readonly AsanaRoutingDecision[];
  firingPlan: readonly HandlerId[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Default rule set
// ---------------------------------------------------------------------------

export const DEFAULT_ASANA_ROUTING: readonly RoutingRule[] = [
  // Baselines — always fire on write events
  {
    handler: 'orchestrator.dispatch',
    reason: 'Orchestrator entry point — always fires on writes',
    predicate: (e) => e.isWrite !== false,
    regulatory: 'Cabinet Res 134/2025 Art.19',
  },
  {
    handler: 'orchestrator.idempotencyCheck',
    reason: 'Idempotency check — always fires on writes',
    predicate: (e) => e.isWrite !== false && !e.idempotencyChecked,
    regulatory: 'FDL Art.24',
  },

  // Conditional dispatchers
  {
    handler: 'productionDispatchAdapter',
    reason: 'Fires for Tier A/B brain verdicts',
    predicate: (e) => e.kind === 'brain-verdict',
    regulatory: 'FDL Art.20-22',
  },
  {
    handler: 'tierCAsanaDispatch',
    reason: 'Fires for Tier C events',
    predicate: (e) => e.kind.startsWith('tierc-'),
    regulatory: 'Cabinet Res 134/2025 Art.12-14',
  },
  {
    handler: 'fourEyesSubtaskCreator',
    reason: 'Fires for high-risk verdicts requiring four-eyes',
    predicate: (e) => e.requiresFourEyes === true,
    regulatory: 'Cabinet Res 134/2025 Art.12-14',
  },
  {
    handler: 'coLoadBalancer',
    reason: 'Fires to select approver B for four-eyes pairs',
    predicate: (e) => e.requiresFourEyes === true,
    regulatory: 'Cabinet Res 74/2020 Art.4-7',
  },
  {
    handler: 'asanaCustomFieldRouter',
    reason: 'Fires for any write that sets custom fields',
    predicate: (e) => e.isWrite !== false && e.kind !== 'webhook-delivered',
    regulatory: 'Cabinet Res 134/2025 Art.19',
  },
  {
    handler: 'asanaSectionWriteBack',
    reason: 'Fires when a verdict requires a section move',
    predicate: (e) => e.kind === 'brain-verdict' && e.verdict !== 'pass',
    regulatory: 'FDL Art.20',
  },
  {
    handler: 'asanaCommentMirror',
    reason: 'Fires on comment events for audit mirror',
    predicate: (e) => e.kind === 'comment-added',
    regulatory: 'FDL Art.20',
  },
  {
    handler: 'asanaSlaEnforcer',
    reason: 'Fires on verdicts that start a regulatory clock',
    predicate: (e) => e.verdict === 'escalate' || e.verdict === 'freeze',
    regulatory: 'Cabinet Res 74/2020 Art.4',
  },
  {
    handler: 'asanaSlaAutoEscalation',
    reason: 'Fires on explicit escalation events',
    predicate: (e) => e.kind === 'sla-escalation',
    regulatory: 'Cabinet Res 74/2020 Art.6',
  },
  {
    handler: 'asanaWebhookRouter',
    reason: 'Fires on inbound webhook deliveries',
    predicate: (e) => e.kind === 'webhook-delivered',
    regulatory: '(operational)',
  },
  {
    handler: 'skillRunnerRegistry',
    reason: 'Fires on comments to dispatch /skill invocations',
    predicate: (e) => e.kind === 'comment-added',
    regulatory: '(operational)',
  },
  {
    handler: 'asanaBulkOperations',
    reason: 'Fires on cron syncs that batch create/update tasks',
    predicate: (e) => e.kind === 'cron-sync',
    regulatory: '(operational)',
  },
  {
    handler: 'asanaSchemaMigrator',
    reason: 'Fires on the daily schema migration check',
    predicate: (e) => e.kind === 'cron-sync',
    regulatory: '(versioning)',
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function routeAsanaEvent(
  event: AsanaEvent,
  rules: readonly RoutingRule[] = DEFAULT_ASANA_ROUTING
): AsanaRoutingReport {
  const decisions: AsanaRoutingDecision[] = [];
  const firingPlan: HandlerId[] = [];
  for (const rule of rules) {
    const fire = rule.predicate ? rule.predicate(event) : true;
    decisions.push({
      handler: rule.handler,
      fire,
      reason: rule.reason,
      regulatory: rule.regulatory,
    });
    if (fire) firingPlan.push(rule.handler);
  }
  const firingRatio = decisions.length > 0 ? firingPlan.length / decisions.length : 0;
  return {
    schemaVersion: 1,
    eventKind: event.kind,
    totalHandlers: decisions.length,
    firedHandlers: firingPlan.length,
    skippedHandlers: decisions.length - firingPlan.length,
    firingRatio,
    decisions,
    firingPlan,
    summary:
      `Meta-Asana router fired ${firingPlan.length}/${decisions.length} handlers ` +
      `(${(firingRatio * 100).toFixed(0)}%) for event "${event.kind}".`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'EU AI Act Art.13',
      'NIST AI RMF 1.0 MANAGE-2',
    ],
  };
}
