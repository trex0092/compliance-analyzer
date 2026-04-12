/**
 * Point-in-Time Compliance State Machine.
 *
 * Reconstructs the compliance state of an entity AT ANY PAST TIMESTAMP
 * by replaying an append-only event log. Essential for regulator
 * questions like "was this customer high-risk on 15 March 2025 at
 * 09:17 when the transaction was initiated?"
 *
 * Design:
 *   1. A ComplianceEvent is immutable and tagged with an ISO timestamp.
 *   2. The state is derived by folding events in order up to a target time.
 *   3. A "snapshot at T" is the state after all events with timestamp ≤ T.
 *   4. The state machine is PURE — same events → same state, always.
 *   5. Supports both forward-only reconstruction and "diff between T1
 *      and T2" queries for change detection.
 *
 * Event kinds cover the full lifecycle:
 *   - onboarding, kyc_refreshed, risk_rerated, pep_flagged, pep_cleared
 *   - sanctions_hit, sanctions_cleared, freeze_applied, freeze_released
 *   - str_filed, case_opened, case_closed, ubo_changed, cdd_renewed
 *   - regulatory_note, adverse_media_hit, adverse_media_cleared
 *
 * Regulatory basis:
 *   - FDL Art.24 (10-year record retention + reconstructable state)
 *   - Cabinet Res 134/2025 Art.19 (internal review must be able to
 *     reconstruct past state)
 *   - EOCN Inspection Manual v4 §9 (audit trail replay)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceEventKind =
  | 'onboarding'
  | 'kyc_refreshed'
  | 'risk_rerated'
  | 'pep_flagged'
  | 'pep_cleared'
  | 'sanctions_hit'
  | 'sanctions_cleared'
  | 'freeze_applied'
  | 'freeze_released'
  | 'str_filed'
  | 'case_opened'
  | 'case_closed'
  | 'ubo_changed'
  | 'cdd_renewed'
  | 'regulatory_note'
  | 'adverse_media_hit'
  | 'adverse_media_cleared';

export interface ComplianceEvent {
  id: string;
  at: string; // ISO
  kind: ComplianceEventKind;
  entityId: string;
  data?: Record<string, unknown>;
}

export interface EntityComplianceState {
  entityId: string;
  asOfIso: string;
  exists: boolean;
  riskBand: 'unknown' | 'low' | 'medium' | 'high';
  isPep: boolean;
  hasSanctionsHit: boolean;
  isFrozen: boolean;
  hasAdverseMedia: boolean;
  openCaseCount: number;
  strsFiledCount: number;
  uboVersion: number;
  lastKycRefreshIso?: string;
  lastCddRenewalIso?: string;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Event log store
// ---------------------------------------------------------------------------

export class TemporalComplianceLog {
  private events: ComplianceEvent[] = [];

  append(event: ComplianceEvent): void {
    // Maintain sorted order by timestamp for efficient snapshots.
    this.events.push(event);
    this.events.sort((a, b) => a.at.localeCompare(b.at));
  }

  appendMany(events: readonly ComplianceEvent[]): void {
    for (const e of events) this.append(e);
  }

  /** All events for an entity, in chronological order. */
  forEntity(entityId: string): ComplianceEvent[] {
    return this.events.filter((e) => e.entityId === entityId);
  }

  /**
   * State of the entity at a point in time. Replays all events with
   * timestamp ≤ asOfIso.
   */
  stateAt(entityId: string, asOfIso: string): EntityComplianceState {
    const initial: EntityComplianceState = {
      entityId,
      asOfIso,
      exists: false,
      riskBand: 'unknown',
      isPep: false,
      hasSanctionsHit: false,
      isFrozen: false,
      hasAdverseMedia: false,
      openCaseCount: 0,
      strsFiledCount: 0,
      uboVersion: 0,
      notes: [],
    };
    let state = initial;
    for (const event of this.events) {
      if (event.entityId !== entityId) continue;
      if (event.at > asOfIso) break;
      state = applyEvent(state, event);
    }
    return state;
  }

  /**
   * Diff between states at two timestamps. Returns the set of fields
   * that changed along with before/after values.
   */
  diff(
    entityId: string,
    fromIso: string,
    toIso: string
  ): Array<{ field: keyof EntityComplianceState; from: unknown; to: unknown }> {
    const before = this.stateAt(entityId, fromIso);
    const after = this.stateAt(entityId, toIso);
    const changes: Array<{ field: keyof EntityComplianceState; from: unknown; to: unknown }> = [];
    for (const key of Object.keys(before) as (keyof EntityComplianceState)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes.push({ field: key, from: before[key], to: after[key] });
      }
    }
    return changes;
  }

  /** All events between two timestamps for the entity. */
  eventsBetween(entityId: string, fromIso: string, toIso: string): ComplianceEvent[] {
    return this.events.filter((e) => e.entityId === entityId && e.at >= fromIso && e.at <= toIso);
  }

  size(): number {
    return this.events.length;
  }
}

// ---------------------------------------------------------------------------
// Event application (pure)
// ---------------------------------------------------------------------------

function applyEvent(state: EntityComplianceState, event: ComplianceEvent): EntityComplianceState {
  const next: EntityComplianceState = { ...state, asOfIso: event.at };
  switch (event.kind) {
    case 'onboarding':
      next.exists = true;
      next.riskBand = (event.data?.riskBand as EntityComplianceState['riskBand']) ?? 'low';
      break;
    case 'kyc_refreshed':
      next.lastKycRefreshIso = event.at;
      break;
    case 'cdd_renewed':
      next.lastCddRenewalIso = event.at;
      break;
    case 'risk_rerated':
      next.riskBand = (event.data?.riskBand as EntityComplianceState['riskBand']) ?? next.riskBand;
      break;
    case 'pep_flagged':
      next.isPep = true;
      break;
    case 'pep_cleared':
      next.isPep = false;
      break;
    case 'sanctions_hit':
      next.hasSanctionsHit = true;
      break;
    case 'sanctions_cleared':
      next.hasSanctionsHit = false;
      break;
    case 'freeze_applied':
      next.isFrozen = true;
      break;
    case 'freeze_released':
      next.isFrozen = false;
      break;
    case 'str_filed':
      next.strsFiledCount += 1;
      break;
    case 'case_opened':
      next.openCaseCount += 1;
      break;
    case 'case_closed':
      next.openCaseCount = Math.max(0, next.openCaseCount - 1);
      break;
    case 'ubo_changed':
      next.uboVersion += 1;
      break;
    case 'adverse_media_hit':
      next.hasAdverseMedia = true;
      break;
    case 'adverse_media_cleared':
      next.hasAdverseMedia = false;
      break;
    case 'regulatory_note':
      if (typeof event.data?.note === 'string') {
        next.notes = [...next.notes, event.data.note];
      }
      break;
  }
  return next;
}
