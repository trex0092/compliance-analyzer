/**
 * Asana SLA Breach Auto-Escalation.
 *
 * asanaSlaEnforcer.ts computes a deadline and reports whether a task
 * is on-time / in the reminder window / breached. It does NOT take
 * action. This module turns a breach into an escalation: it selects
 * the next tier (CO → MLRO → Board), builds an escalation task
 * payload, and optionally dispatches it as a follow-up Asana task
 * linked to the breached parent.
 *
 * Pure tier selector + escalation payload builder + thin dispatcher.
 *
 * Regulatory basis:
 *   - Cabinet Res 74/2020 Art.4-7 (24h EOCN freeze — hard deadline)
 *   - FDL No.10/2025 Art.20-21 (CO + MLRO duty of care)
 *   - Cabinet Res 134/2025 Art.19 (internal review)
 *   - MoE Circular 08/AML/2021 (DPMS deadlines)
 */

import { asanaRequestWithRetry, isAsanaConfigured, type AsanaTaskPayload } from './asanaClient';
import { type SlaPlan, type RegulatoryDeadlineKind, evaluateSlaStatus } from './asanaSlaEnforcer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscalationTier = 'CO' | 'MLRO' | 'BOARD' | 'REGULATOR';

export interface EscalationContext {
  /** Asana task that breached the SLA. */
  breachedTaskGid: string;
  /** Short human-readable task title, used in the escalation notes. */
  breachedTaskTitle: string;
  /** Asana project to dispatch the escalation task into. */
  projectGid: string;
  /** Minutes past the deadline (positive integer). */
  minutesOverdue: number;
  /** Which SLA was breached. */
  slaPlan: SlaPlan;
  /** Optional linked case or filing id for audit trail. */
  linkedLocalId?: string;
  /** The previous escalation tier, if any. Used to promote by one step. */
  previousTier?: EscalationTier;
}

export interface EscalationDecision {
  tier: EscalationTier;
  /** How many hours the new escalation owner has to respond. */
  dueHours: number;
  /** Whether this breach also requires a breakglass notification. */
  breakglass: boolean;
  /** Rationale for the tier selection — logged into task notes. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Pure tier selector
// ---------------------------------------------------------------------------

/**
 * Choose the next escalation tier based on the breached SLA kind,
 * overdue magnitude, and previous tier. The goal: promote by one step
 * but skip straight to BOARD for critical 24h freezes that are already
 * more than 60 minutes overdue, and skip to REGULATOR only when the
 * breach is >24h past due.
 */
export function chooseEscalationTier(ctx: EscalationContext): EscalationDecision {
  const kind: RegulatoryDeadlineKind = ctx.slaPlan.kind;
  const hoursOverdue = ctx.minutesOverdue / 60;

  // EOCN freeze is the hardest deadline in the regime — any breach is
  // already a regulatory incident. Always escalate at least to MLRO.
  if (kind === 'eocn_freeze_24h') {
    if (hoursOverdue >= 24) {
      return {
        tier: 'REGULATOR',
        dueHours: 2,
        breakglass: true,
        rationale:
          'EOCN freeze is >24h overdue — Cabinet Res 74/2020 Art.4 breach. Notify regulator and Board simultaneously.',
      };
    }
    if (hoursOverdue >= 1 || ctx.previousTier === 'MLRO') {
      return {
        tier: 'BOARD',
        dueHours: 4,
        breakglass: true,
        rationale: 'EOCN freeze breached — Cabinet Res 74/2020 Art.4. Board notification required.',
      };
    }
    return {
      tier: 'MLRO',
      dueHours: 1,
      breakglass: true,
      rationale: 'EOCN freeze breach window — escalate to MLRO for immediate intervention.',
    };
  }

  // STR / CNMR are critical filings but not clock-hours.
  if (kind === 'str_without_delay' || kind === 'cnmr_5_business_days') {
    if (ctx.previousTier === 'MLRO' || hoursOverdue >= 48) {
      return {
        tier: 'BOARD',
        dueHours: 8,
        breakglass: true,
        rationale: `${kind} is ${Math.round(hoursOverdue)}h overdue — Board escalation (FDL Art.26-27 / Cabinet Res 74/2020 Art.6).`,
      };
    }
    return {
      tier: 'MLRO',
      dueHours: 4,
      breakglass: false,
      rationale: `${kind} breached — MLRO must file without further delay.`,
    };
  }

  // Everything else: promote by one step, default to MLRO.
  const promotionMap: Record<EscalationTier, EscalationTier> = {
    CO: 'MLRO',
    MLRO: 'BOARD',
    BOARD: 'REGULATOR',
    REGULATOR: 'REGULATOR',
  };
  const tier: EscalationTier = ctx.previousTier ? promotionMap[ctx.previousTier] : 'MLRO';

  return {
    tier,
    dueHours: tier === 'CO' ? 24 : tier === 'MLRO' ? 12 : 8,
    breakglass: tier === 'BOARD' || tier === 'REGULATOR',
    rationale: `${kind} breach — escalating from ${ctx.previousTier ?? 'CO'} to ${tier}.`,
  };
}

// ---------------------------------------------------------------------------
// Escalation payload builder
// ---------------------------------------------------------------------------

export function buildEscalationTaskPayload(
  ctx: EscalationContext,
  decision: EscalationDecision
): AsanaTaskPayload {
  const dueOn = new Date(Date.now() + decision.dueHours * 3600_000).toISOString().slice(0, 10);

  const notes = [
    `ESCALATION — ${decision.tier} action required.`,
    '',
    `Breached task: ${ctx.breachedTaskTitle}`,
    `Parent GID: ${ctx.breachedTaskGid}`,
    `Overdue by: ${ctx.minutesOverdue} minutes (${(ctx.minutesOverdue / 60).toFixed(1)}h)`,
    `Due in: ${decision.dueHours}h`,
    `SLA: ${ctx.slaPlan.regulatory}`,
    '',
    'Rationale:',
    decision.rationale,
    '',
    decision.breakglass
      ? '*** BREAKGLASS ACTIVATED — notify on-call MLRO immediately ***'
      : 'Normal escalation — no breakglass trigger.',
    '',
    'FDL Art.29 — no tipping off. Do not contact the subject.',
  ].join('\n');

  const name = `[ESCALATE-${decision.tier}] ${ctx.breachedTaskTitle}`.slice(0, 250);

  return {
    name,
    notes,
    projects: [ctx.projectGid],
    due_on: dueOn,
    tags: ['sla-breach', `escalation:${decision.tier.toLowerCase()}`],
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface EscalationDispatchResult {
  ok: boolean;
  decision: EscalationDecision;
  escalationGid?: string;
  error?: string;
  /** True when the SLA is not actually breached and no task was created. */
  skipped?: boolean;
}

/**
 * Evaluate a task's SLA and, if breached, create an escalation task.
 * Idempotency is the caller's responsibility — pass a unique
 * `breachedTaskGid` and the downstream Asana queue will de-dupe.
 */
export async function dispatchSlaBreachEscalation(
  ctx: EscalationContext
): Promise<EscalationDispatchResult> {
  const status = evaluateSlaStatus(ctx.slaPlan);
  if (status.status !== 'breached') {
    return {
      ok: true,
      skipped: true,
      decision: {
        tier: 'CO',
        dueHours: 24,
        breakglass: false,
        rationale: `SLA not breached (${status.status}); no escalation.`,
      },
    };
  }

  const decision = chooseEscalationTier({
    ...ctx,
    minutesOverdue: Math.max(1, -status.minutesUntilDue),
  });

  if (!isAsanaConfigured()) {
    return {
      ok: false,
      decision,
      error: 'Asana not configured — cannot dispatch escalation task',
    };
  }

  const payload = buildEscalationTaskPayload(
    { ...ctx, minutesOverdue: Math.max(1, -status.minutesUntilDue) },
    decision
  );

  const result = await asanaRequestWithRetry<{ gid: string }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ data: payload }),
  });

  if (result.ok && result.data?.gid) {
    return {
      ok: true,
      decision,
      escalationGid: result.data.gid,
    };
  }

  return {
    ok: false,
    decision,
    error: result.error ?? 'Escalation dispatch failed with no error message',
  };
}
