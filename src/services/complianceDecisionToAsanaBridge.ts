/**
 * Compliance Decision → Asana bridge (W6).
 *
 * Pure helper that maps a `ComplianceDecision` onto the
 * `OrchestrationEvent` shape consumed by
 * `asanaComplianceOrchestrator.orchestrateAsanaForEvent`, and then
 * onto an `OrchestratedAsanaPlan` the caller can POST to
 * `/api/asana/dispatch` (or feed directly into `asanaClient`).
 *
 * Why a bridge module and not an inline call inside the decision
 * engine: keeping the engine pure (no network I/O, no cross-cutting
 * dependency on Asana) lets the test suite pin both sides
 * independently, and lets server-side callers choose whether to
 * spawn Asana tasks per-decision.
 *
 * The bridge is PURE — it produces the plan; the caller decides how
 * to persist + execute it.
 *
 * Regulatory basis:
 *   FDL Art.20-21 (CO duty of care — every decision traceable to a
 *                  concrete action list in the case-management tool)
 *   Cabinet Res 134/2025 Art.19 (auditable workflow + state)
 */

import type { ComplianceDecision } from './complianceDecisionEngine';
import {
  orchestrateAsanaForEvent,
  type OrchestrationEvent,
  type OrchestrationEventKind,
  type OrchestratedAsanaPlan,
} from './asanaComplianceOrchestrator';

export interface BridgeOptions {
  /**
   * Override which event kind the decision maps to. Default routing:
   *   - verdict === 'freeze'   → freeze_initiated
   *   - verdict === 'escalate' → sanctions_match (escalate verdicts
   *                             almost always come from a sanctions
   *                             clamp in the weaponized brain)
   *   - otherwise              → str_drafted
   */
  kindOverride?: OrchestrationEventKind;
  /**
   * When set, the confirmed flag is passed through on the payload so
   * the orchestrator's breakglass channel fires for confirmed
   * sanctions matches. Default false.
   */
  confirmedSanctionsMatch?: boolean;
}

/**
 * Decide which event kind a decision should spawn. Pure function —
 * no regex on free-text fields. Callers can override via
 * `options.kindOverride`.
 */
export function mapVerdictToEventKind(decision: ComplianceDecision): OrchestrationEventKind {
  switch (decision.verdict) {
    case 'freeze':
      return 'freeze_initiated';
    case 'escalate':
      return 'sanctions_match';
    case 'flag':
      return 'str_drafted';
    case 'pass':
    default:
      // Pass verdicts never spawn Asana tasks — the bridge returns
      // null in that case (see `bridgeDecisionToAsana` below).
      return 'decision_landed';
  }
}

/**
 * Build the `OrchestrationEvent` from a decision.
 *
 * The decision's full context (id, tenant, verdict, confidence,
 * clampReasons, subsystemFailures, auditNarrative, fourEyes,
 * attestation) is carried across so the orchestrator's replay poster
 * + custom-field router + breakglass channel see the same data the
 * brain saw.
 */
export function buildAsanaOrchestrationEvent(
  decision: ComplianceDecision,
  options: BridgeOptions = {}
): OrchestrationEvent {
  const kind = options.kindOverride ?? mapVerdictToEventKind(decision);
  return {
    kind,
    tenantId: decision.tenantId,
    occurredAtIso: decision.at,
    refId: decision.id,
    decision: {
      id: decision.id,
      tenantId: decision.tenantId,
      verdict: decision.verdict,
      confidence: decision.confidence,
      recommendedAction: decision.recommendedAction,
      clampReasons: decision.raw?.clampReasons ?? [],
      subsystemFailures: decision.raw?.subsystemFailures ?? [],
      auditNarrative: decision.auditNarrative,
      fourEyesStatus: decision.fourEyes?.status,
      attestation: decision.attestation
        ? {
            commitHash: decision.attestation.commitHash,
            listName: decision.attestation.listName,
            screenedAtIso: decision.attestation.screenedAtIso,
          }
        : undefined,
    },
    payload: options.confirmedSanctionsMatch ? { confirmed: true } : undefined,
  };
}

/**
 * Produce an `OrchestratedAsanaPlan` for a decision. Returns `null`
 * when the decision is a clean pass (no Asana side-effects needed).
 *
 * The caller is responsible for sending the plan to Asana (via
 * `/api/asana/dispatch` from the client or `asanaClient` direct on
 * the server). The bridge itself does no I/O.
 */
export function bridgeDecisionToAsana(
  decision: ComplianceDecision,
  options: BridgeOptions = {}
): OrchestratedAsanaPlan | null {
  // Clean pass — no Asana tasks to spawn.
  if (decision.verdict === 'pass' && !options.kindOverride) {
    return null;
  }
  const event = buildAsanaOrchestrationEvent(decision, options);
  return orchestrateAsanaForEvent(event);
}
