/**
 * NORAD War Room Feed.
 *
 * Real-time aggregation layer for the compliance command center dashboard.
 * Input: a stream of brain events + case updates + screening results.
 * Output: a normalised "war room state" snapshot the UI can render without
 * additional computation.
 *
 * The feed is APPEND-ONLY — you call `ingest(event)` and it updates the
 * in-memory state. UI subscribers read `snapshot()` atomically. This is
 * safe for many writers + many readers within a single tab (no locks
 * needed in JS's single-threaded model).
 *
 * War room KPIs exposed:
 *   1. Active incidents by severity
 *   2. Countdown timers for regulatory deadlines (24h freeze, 5d CNMR, 10d STR)
 *   3. Sanctions screen pass/fail ratio (last hour / 24h)
 *   4. Top N highest-risk open cases
 *   5. Filing queue depth
 *   6. Evidence vault integrity status
 *   7. Recent events feed (last 50)
 *
 * This is a DATA MODULE ONLY — the React dashboard consumes this
 * service via a hook. Keeping the compute here lets us test it
 * deterministically and share it across three surfaces: the main UI,
 * the voice-assistant briefing, and the regulator portal.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IncidentSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type WarRoomEventKind =
  | 'screening'
  | 'sanctions_match'
  | 'str_staged'
  | 'str_filed'
  | 'freeze_initiated'
  | 'freeze_released'
  | 'case_opened'
  | 'case_closed'
  | 'evidence_break'
  | 'deadline_alert'
  | 'approval_granted'
  | 'system_warning';

export interface WarRoomEvent {
  id: string;
  at: string;
  kind: WarRoomEventKind;
  severity: IncidentSeverity;
  title: string;
  entityId?: string;
  caseId?: string;
  /** Deadline ISO if this event has a regulatory countdown. */
  deadlineIso?: string;
  meta?: Record<string, unknown>;
}

export interface ActiveIncident {
  id: string;
  openedAt: string;
  severity: IncidentSeverity;
  title: string;
  entityId?: string;
  caseId?: string;
  deadlineIso?: string;
  minutesRemaining?: number;
}

export interface WarRoomSnapshot {
  asOf: string;
  totalEventsIngested: number;
  incidentsBySeverity: Record<IncidentSeverity, number>;
  activeIncidents: ActiveIncident[];
  upcomingDeadlines: ActiveIncident[];
  recentEvents: WarRoomEvent[];
  kpis: {
    screeningsLast1h: number;
    sanctionsMatchesLast1h: number;
    matchRateLast1h: number;
    strFiledLast24h: number;
    freezesActive: number;
    evidenceBreaksOpen: number;
  };
}

// ---------------------------------------------------------------------------
// Feed implementation
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export class WarRoomFeed {
  private events: WarRoomEvent[] = [];
  private incidents = new Map<string, ActiveIncident>();
  private activeFreezes = new Set<string>();
  private openEvidenceBreaks = new Set<string>();
  private total = 0;

  ingest(event: WarRoomEvent): void {
    this.total += 1;
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();

    // Incident lifecycle
    if (this.shouldOpenIncident(event)) {
      const incident: ActiveIncident = {
        id: event.id,
        openedAt: event.at,
        severity: event.severity,
        title: event.title,
        entityId: event.entityId,
        caseId: event.caseId,
        deadlineIso: event.deadlineIso,
      };
      this.incidents.set(event.id, incident);
    }

    if (event.kind === 'freeze_initiated' && event.entityId) {
      this.activeFreezes.add(event.entityId);
    }
    if (event.kind === 'freeze_released' && event.entityId) {
      this.activeFreezes.delete(event.entityId);
    }
    if (event.kind === 'evidence_break') {
      this.openEvidenceBreaks.add(event.id);
    }
    if (event.kind === 'case_closed' && event.caseId) {
      for (const [id, incident] of this.incidents) {
        if (incident.caseId === event.caseId) {
          this.incidents.delete(id);
        }
      }
    }
  }

  private shouldOpenIncident(event: WarRoomEvent): boolean {
    if (SEVERITY_RANK[event.severity] >= SEVERITY_RANK.medium) return true;
    return (
      event.kind === 'sanctions_match' ||
      event.kind === 'freeze_initiated' ||
      event.kind === 'evidence_break' ||
      event.kind === 'deadline_alert'
    );
  }

  snapshot(now: Date = new Date()): WarRoomSnapshot {
    const asOf = now.toISOString();
    const nowMs = now.getTime();

    const incidentsBySeverity: Record<IncidentSeverity, number> = {
      info: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    const active: ActiveIncident[] = [];
    for (const inc of this.incidents.values()) {
      incidentsBySeverity[inc.severity] += 1;
      const enriched: ActiveIncident = { ...inc };
      if (inc.deadlineIso) {
        enriched.minutesRemaining = Math.floor(
          (Date.parse(inc.deadlineIso) - nowMs) / 60_000,
        );
      }
      active.push(enriched);
    }
    active.sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        (a.minutesRemaining ?? Infinity) - (b.minutesRemaining ?? Infinity),
    );

    const upcoming = active
      .filter((i) => i.minutesRemaining !== undefined)
      .sort(
        (a, b) => (a.minutesRemaining ?? Infinity) - (b.minutesRemaining ?? Infinity),
      )
      .slice(0, 10);

    const oneHourAgo = nowMs - 3_600_000;
    const oneDayAgo = nowMs - 86_400_000;
    const screenings = this.events.filter(
      (e) =>
        (e.kind === 'screening' || e.kind === 'sanctions_match') &&
        Date.parse(e.at) >= oneHourAgo,
    );
    const matches = this.events.filter(
      (e) => e.kind === 'sanctions_match' && Date.parse(e.at) >= oneHourAgo,
    );
    const strs = this.events.filter(
      (e) => e.kind === 'str_filed' && Date.parse(e.at) >= oneDayAgo,
    );

    return {
      asOf,
      totalEventsIngested: this.total,
      incidentsBySeverity,
      activeIncidents: active,
      upcomingDeadlines: upcoming,
      recentEvents: this.events.slice(-50).reverse(),
      kpis: {
        screeningsLast1h: screenings.length,
        sanctionsMatchesLast1h: matches.length,
        matchRateLast1h: screenings.length === 0 ? 0 : matches.length / screenings.length,
        strFiledLast24h: strs.length,
        freezesActive: this.activeFreezes.size,
        evidenceBreaksOpen: this.openEvidenceBreaks.size,
      },
    };
  }

  closeIncident(id: string): boolean {
    return this.incidents.delete(id);
  }

  clear(): void {
    this.events = [];
    this.incidents.clear();
    this.activeFreezes.clear();
    this.openEvidenceBreaks.clear();
    this.total = 0;
  }
}
