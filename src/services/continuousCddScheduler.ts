/**
 * Continuous CDD Refresh Scheduler — subsystem #63 (Phase 7 Cluster G).
 *
 * Replaces the fixed "every 90/180/365 days" approach with event-driven
 * re-screening. The scheduler watches for four kinds of events and
 * enqueues a re-screen when any fire:
 *
 *   1. Risk score crossed a tier boundary (SDD ↔ CDD ↔ EDD)
 *   2. New adverse media hit
 *   3. New sanctions-list entry matching the customer
 *   4. UBO change detected (disclosed percentage delta > 10%)
 *   5. Cabinet Res 134/2025 Art.7-10 max interval (90/180/365 days) reached
 *
 * Pure function: takes the current state + inbound events and returns
 * a re-screen queue. The caller (cron, webhook handler) dispatches the
 * actual re-screening.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.7-10 (CDD tier intervals)
 *   - Cabinet Decision 109/2023 (UBO re-verification within 15 working days)
 *   - FATF Rec 10 (ongoing CDD)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CddTier = 'SDD' | 'CDD' | 'EDD';

export interface CustomerState {
  customerId: string;
  currentTier: CddTier;
  riskScore: number;
  lastScreenedAt: string;
  uboDisclosedPct: number;
}

export type TriggerEvent =
  | { kind: 'adverse_media'; customerId: string; at: string }
  | { kind: 'new_sanction'; customerId: string; at: string }
  | { kind: 'ubo_change'; customerId: string; at: string; newDisclosedPct: number }
  | { kind: 'risk_score'; customerId: string; at: string; newScore: number };

export interface RescreenTask {
  customerId: string;
  reason:
    | 'adverse_media'
    | 'new_sanction'
    | 'ubo_change'
    | 'tier_boundary'
    | 'interval_expired';
  priority: 'critical' | 'high' | 'medium' | 'low';
  dueBy: string;
  citation: string;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

// Max intervals per CDD tier (Cabinet Res 134/2025 Art.7-10).
const MAX_INTERVAL_DAYS: Record<CddTier, number> = {
  SDD: 365,
  CDD: 180,
  EDD: 90,
};

function scoreToTier(score: number): CddTier {
  if (score >= 16) return 'EDD';
  if (score >= 6) return 'CDD';
  return 'SDD';
}

function addDays(from: Date, days: number): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function scheduleRescreens(
  states: readonly CustomerState[],
  events: readonly TriggerEvent[],
  now: Date = new Date()
): RescreenTask[] {
  const tasks: RescreenTask[] = [];
  const byCustomer = new Map<string, CustomerState>();
  for (const s of states) byCustomer.set(s.customerId, s);

  // Event-driven triggers
  for (const event of events) {
    const state = byCustomer.get(event.customerId);
    if (!state) continue;

    if (event.kind === 'adverse_media') {
      tasks.push({
        customerId: event.customerId,
        reason: 'adverse_media',
        priority: 'high',
        dueBy: addDays(now, 3),
        citation: 'Cabinet Res 134/2025 Art.14 (EDD triggers on new adverse media)',
      });
    } else if (event.kind === 'new_sanction') {
      tasks.push({
        customerId: event.customerId,
        reason: 'new_sanction',
        priority: 'critical',
        dueBy: addDays(now, 1),
        citation: 'Cabinet Res 74/2020 Art.4-7 (24h freeze window)',
      });
    } else if (event.kind === 'ubo_change') {
      const delta = Math.abs(event.newDisclosedPct - state.uboDisclosedPct);
      if (delta >= 10) {
        tasks.push({
          customerId: event.customerId,
          reason: 'ubo_change',
          priority: 'high',
          dueBy: addDays(now, 15),
          citation: 'Cabinet Decision 109/2023 (UBO re-verification within 15 working days)',
        });
      }
    } else if (event.kind === 'risk_score') {
      const newTier = scoreToTier(event.newScore);
      if (newTier !== state.currentTier) {
        tasks.push({
          customerId: event.customerId,
          reason: 'tier_boundary',
          priority: newTier === 'EDD' ? 'high' : 'medium',
          dueBy: addDays(now, MAX_INTERVAL_DAYS[newTier]),
          citation: 'Cabinet Res 134/2025 Art.7-10 (CDD tier change)',
        });
      }
    }
  }

  // Interval-expired triggers
  for (const state of states) {
    const maxDays = MAX_INTERVAL_DAYS[state.currentTier];
    const last = Date.parse(state.lastScreenedAt);
    if (!Number.isFinite(last)) continue;
    const ageDays = (now.getTime() - last) / 86_400_000;
    if (ageDays >= maxDays) {
      tasks.push({
        customerId: state.customerId,
        reason: 'interval_expired',
        priority: state.currentTier === 'EDD' ? 'high' : 'medium',
        dueBy: addDays(now, 7),
        citation: `Cabinet Res 134/2025 Art.7-10 (${state.currentTier} max interval ${maxDays}d reached)`,
      });
    }
  }

  return tasks;
}
