/**
 * MLRO Dashboard Real-Time Streaming Service
 *
 * Event streaming pipeline for the MLRO operations dashboard, inspired by
 * multica's WebSocket streaming architecture and the existing
 * streaming-pipeline-tools.ts foundation.
 *
 * Provides:
 * - MLRO-specific event types (screening progress, filing status, freeze countdown)
 * - Dashboard state aggregation (live KPIs, active cases, pending approvals)
 * - Priority-based alert routing (critical -> toast, high -> banner, etc.)
 * - Real-time SLA monitoring with countdown timers
 * - Connection management for multiple dashboard clients
 * - Event deduplication and throttling
 *
 * This service sits between the compliance engine and the UI layer,
 * transforming raw compliance events into dashboard-ready state updates.
 *
 * Regulatory refs:
 * - Cabinet Res 74/2020 Art.4-7 (freeze countdown — 24h)
 * - FDL No.10/2025 Art.26-27 (STR filing countdown)
 * - FDL No.10/2025 Art.29 (no tipping off — dashboard access restricted to CO/MLRO)
 *
 * Patterns adopted:
 * - multica: WebSocket streaming + daemon event architecture
 * - hermes-agent: smart_model_routing.py (priority-based event routing)
 * - streaming-pipeline-tools.ts (existing event bus, extended)
 */

import type { EventType, Priority, ComplianceEvent } from '../agents/tools/streaming-pipeline-tools';

// ─── Dashboard Event Types ──────────────────────────────────────────────────

export type DashboardEventType =
  | 'screening-started'
  | 'screening-progress'
  | 'screening-completed'
  | 'consensus-reached'
  | 'consensus-failed'
  | 'approval-requested'
  | 'approval-submitted'
  | 'approval-completed'
  | 'approval-sla-warning'
  | 'approval-sla-critical'
  | 'approval-sla-breached'
  | 'freeze-initiated'
  | 'freeze-countdown-tick'
  | 'freeze-executed'
  | 'filing-started'
  | 'filing-submitted'
  | 'filing-deadline-warning'
  | 'case-opened'
  | 'case-updated'
  | 'case-escalated'
  | 'case-closed'
  | 'kpi-update'
  | 'alert-new'
  | 'alert-acknowledged'
  | 'system-health';

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'emergency';

export type DashboardPanel =
  | 'active-screenings'
  | 'pending-approvals'
  | 'freeze-countdowns'
  | 'filing-deadlines'
  | 'open-cases'
  | 'kpi-metrics'
  | 'alert-feed'
  | 'system-status';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DashboardEvent {
  eventId: string;
  type: DashboardEventType;
  timestamp: string;
  severity: AlertSeverity;

  /** Which dashboard panel(s) this event targets */
  targetPanels: DashboardPanel[];

  /** Display configuration */
  display: {
    title: string;
    message: string;
    /** How to show the alert in the UI */
    presentation: 'toast' | 'banner' | 'inline' | 'modal' | 'silent';
    /** Auto-dismiss after N seconds (0 = manual dismiss only) */
    autoDismissSeconds: number;
    /** Icon hint for the UI */
    icon: 'shield' | 'clock' | 'alert' | 'check' | 'freeze' | 'file' | 'user' | 'chart';
  };

  /** Structured payload for the target panel */
  payload: Record<string, unknown>;

  /** Entity context */
  entityId?: string;
  entityName?: string;

  /** Linked IDs for cross-referencing */
  linkedTrajectoryId?: string;
  linkedConsensusId?: string;
  linkedApprovalGateId?: string;

  /** Access control: only these roles can see this event (FDL Art.29) */
  visibleToRoles: string[];
}

export interface DashboardState {
  /** Live KPI metrics */
  kpis: DashboardKPIs;

  /** Active countdowns */
  countdowns: CountdownTimer[];

  /** Pending items by panel */
  activeScreenings: number;
  pendingApprovals: number;
  openCases: number;
  filingsDueThisWeek: number;

  /** Alert summary */
  unresolvedAlerts: { critical: number; warning: number; info: number };

  /** System health */
  systemStatus: 'healthy' | 'degraded' | 'down';
  lastEventAt: string;
  eventsPerMinute: number;
}

export interface DashboardKPIs {
  /** Screening metrics */
  screeningsToday: number;
  screeningsThisMonth: number;
  averageScreeningTimeMs: number;
  screeningMatchRate: number;

  /** Filing metrics */
  strFiledThisMonth: number;
  ctrFiledThisMonth: number;
  filingComplianceRate: number;

  /** Approval metrics */
  averageApprovalTimeHours: number;
  slaComplianceRate: number;
  escalationRate: number;

  /** Risk metrics */
  highRiskEntities: number;
  pendingEddReviews: number;
  overdueReviews: number;
}

export interface CountdownTimer {
  timerId: string;
  type: 'freeze' | 'str-filing' | 'ctr-filing' | 'cnmr-filing' | 'eocn' | 'approval-sla' | 'cdd-review';
  entityId: string;
  entityName: string;
  startedAt: string;
  deadlineAt: string;
  remainingMs: number;
  percentElapsed: number;
  status: 'on-track' | 'warning' | 'critical' | 'breached';
  regulatoryRef: string;
}

export interface DashboardClient {
  clientId: string;
  userId: string;
  userRole: string;
  connectedAt: string;
  lastPingAt: string;
  subscribedPanels: DashboardPanel[];
}

// ─── Event Router ───────────────────────────────────────────────────────────

/** Map compliance events to dashboard events with appropriate severity and presentation */
const EVENT_ROUTING: Record<DashboardEventType, {
  severity: AlertSeverity;
  presentation: DashboardEvent['display']['presentation'];
  autoDismissSeconds: number;
  targetPanels: DashboardPanel[];
  icon: DashboardEvent['display']['icon'];
  visibleToRoles: string[];
}> = {
  'screening-started': {
    severity: 'info', presentation: 'inline', autoDismissSeconds: 0,
    targetPanels: ['active-screenings'], icon: 'shield',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_analyst'],
  },
  'screening-progress': {
    severity: 'info', presentation: 'silent', autoDismissSeconds: 0,
    targetPanels: ['active-screenings'], icon: 'shield',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_analyst'],
  },
  'screening-completed': {
    severity: 'info', presentation: 'inline', autoDismissSeconds: 10,
    targetPanels: ['active-screenings', 'kpi-metrics'], icon: 'check',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_analyst'],
  },
  'consensus-reached': {
    severity: 'info', presentation: 'toast', autoDismissSeconds: 15,
    targetPanels: ['active-screenings'], icon: 'check',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'consensus-failed': {
    severity: 'warning', presentation: 'banner', autoDismissSeconds: 0,
    targetPanels: ['active-screenings', 'alert-feed'], icon: 'alert',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'approval-requested': {
    severity: 'info', presentation: 'toast', autoDismissSeconds: 0,
    targetPanels: ['pending-approvals'], icon: 'user',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management', 'board'],
  },
  'approval-submitted': {
    severity: 'info', presentation: 'inline', autoDismissSeconds: 5,
    targetPanels: ['pending-approvals'], icon: 'check',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'approval-completed': {
    severity: 'info', presentation: 'toast', autoDismissSeconds: 10,
    targetPanels: ['pending-approvals', 'kpi-metrics'], icon: 'check',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'approval-sla-warning': {
    severity: 'warning', presentation: 'banner', autoDismissSeconds: 0,
    targetPanels: ['pending-approvals', 'alert-feed'], icon: 'clock',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'approval-sla-critical': {
    severity: 'critical', presentation: 'banner', autoDismissSeconds: 0,
    targetPanels: ['pending-approvals', 'alert-feed'], icon: 'clock',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'approval-sla-breached': {
    severity: 'emergency', presentation: 'modal', autoDismissSeconds: 0,
    targetPanels: ['pending-approvals', 'alert-feed'], icon: 'alert',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management', 'board'],
  },
  'freeze-initiated': {
    severity: 'emergency', presentation: 'modal', autoDismissSeconds: 0,
    targetPanels: ['freeze-countdowns', 'alert-feed'], icon: 'freeze',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'freeze-countdown-tick': {
    severity: 'critical', presentation: 'silent', autoDismissSeconds: 0,
    targetPanels: ['freeze-countdowns'], icon: 'clock',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'freeze-executed': {
    severity: 'critical', presentation: 'toast', autoDismissSeconds: 0,
    targetPanels: ['freeze-countdowns', 'alert-feed', 'kpi-metrics'], icon: 'freeze',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'filing-started': {
    severity: 'info', presentation: 'inline', autoDismissSeconds: 5,
    targetPanels: ['filing-deadlines'], icon: 'file',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'filing-submitted': {
    severity: 'info', presentation: 'toast', autoDismissSeconds: 10,
    targetPanels: ['filing-deadlines', 'kpi-metrics'], icon: 'check',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'filing-deadline-warning': {
    severity: 'warning', presentation: 'banner', autoDismissSeconds: 0,
    targetPanels: ['filing-deadlines', 'alert-feed'], icon: 'clock',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'case-opened': {
    severity: 'info', presentation: 'inline', autoDismissSeconds: 10,
    targetPanels: ['open-cases'], icon: 'user',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_analyst'],
  },
  'case-updated': {
    severity: 'info', presentation: 'silent', autoDismissSeconds: 0,
    targetPanels: ['open-cases'], icon: 'user',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_analyst'],
  },
  'case-escalated': {
    severity: 'warning', presentation: 'toast', autoDismissSeconds: 0,
    targetPanels: ['open-cases', 'alert-feed'], icon: 'alert',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'case-closed': {
    severity: 'info', presentation: 'inline', autoDismissSeconds: 10,
    targetPanels: ['open-cases', 'kpi-metrics'], icon: 'check',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_analyst'],
  },
  'kpi-update': {
    severity: 'info', presentation: 'silent', autoDismissSeconds: 0,
    targetPanels: ['kpi-metrics'], icon: 'chart',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
  'alert-new': {
    severity: 'warning', presentation: 'toast', autoDismissSeconds: 0,
    targetPanels: ['alert-feed'], icon: 'alert',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'alert-acknowledged': {
    severity: 'info', presentation: 'silent', autoDismissSeconds: 0,
    targetPanels: ['alert-feed'], icon: 'check',
    visibleToRoles: ['compliance_officer', 'mlro'],
  },
  'system-health': {
    severity: 'info', presentation: 'silent', autoDismissSeconds: 0,
    targetPanels: ['system-status'], icon: 'chart',
    visibleToRoles: ['compliance_officer', 'mlro', 'senior_management'],
  },
};

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Create a dashboard event from a raw compliance event type.
 * Automatically applies routing rules, severity, and access control.
 */
export function createDashboardEvent(
  type: DashboardEventType,
  title: string,
  message: string,
  payload: Record<string, unknown>,
  entityContext?: { entityId: string; entityName: string },
  linkedIds?: { trajectoryId?: string; consensusId?: string; approvalGateId?: string },
): DashboardEvent {
  const routing = EVENT_ROUTING[type];

  return {
    eventId: `de-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: new Date().toISOString(),
    severity: routing.severity,
    targetPanels: routing.targetPanels,
    display: {
      title,
      message,
      presentation: routing.presentation,
      autoDismissSeconds: routing.autoDismissSeconds,
      icon: routing.icon,
    },
    payload,
    entityId: entityContext?.entityId,
    entityName: entityContext?.entityName,
    linkedTrajectoryId: linkedIds?.trajectoryId,
    linkedConsensusId: linkedIds?.consensusId,
    linkedApprovalGateId: linkedIds?.approvalGateId,
    visibleToRoles: routing.visibleToRoles,
  };
}

/**
 * Create a countdown timer for a regulatory deadline.
 * Updates are emitted as freeze-countdown-tick or filing-deadline-warning events.
 */
export function createCountdownTimer(
  type: CountdownTimer['type'],
  entityId: string,
  entityName: string,
  deadlineAt: string,
  regulatoryRef: string,
): CountdownTimer {
  const now = Date.now();
  const deadline = new Date(deadlineAt).getTime();
  const remainingMs = Math.max(0, deadline - now);

  return {
    timerId: `timer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    entityId,
    entityName,
    startedAt: new Date().toISOString(),
    deadlineAt,
    remainingMs,
    percentElapsed: 0,
    status: 'on-track',
    regulatoryRef,
  };
}

/**
 * Update a countdown timer with current time.
 * Call periodically (every 30-60 seconds) for dashboard display.
 */
export function tickCountdown(timer: CountdownTimer): {
  timer: CountdownTimer;
  event?: DashboardEvent;
} {
  const now = Date.now();
  const started = new Date(timer.startedAt).getTime();
  const deadline = new Date(timer.deadlineAt).getTime();
  const totalMs = deadline - started;
  const elapsedMs = now - started;
  const remainingMs = Math.max(0, deadline - now);
  const percentElapsed = totalMs > 0 ? Math.round((elapsedMs / totalMs) * 100) : 100;

  let status: CountdownTimer['status'] = 'on-track';
  if (remainingMs <= 0) status = 'breached';
  else if (percentElapsed >= 90) status = 'critical';
  else if (percentElapsed >= 75) status = 'warning';

  const updated: CountdownTimer = {
    ...timer,
    remainingMs,
    percentElapsed,
    status,
  };

  // Emit event on status change
  let event: DashboardEvent | undefined;
  if (status !== timer.status) {
    const eventType: DashboardEventType =
      timer.type === 'freeze' || timer.type === 'eocn'
        ? status === 'breached' ? 'approval-sla-breached' : 'freeze-countdown-tick'
        : status === 'breached' ? 'filing-deadline-warning' : 'filing-deadline-warning';

    const hoursRemaining = Math.round(remainingMs / 3_600_000 * 10) / 10;

    event = createDashboardEvent(
      eventType,
      `${timer.type.toUpperCase()} Deadline ${status.toUpperCase()}`,
      `${timer.entityName}: ${hoursRemaining}h remaining (${timer.regulatoryRef})`,
      { timerId: timer.timerId, remainingMs, percentElapsed, status },
      { entityId: timer.entityId, entityName: timer.entityName },
    );
  }

  return { timer: updated, event };
}

/**
 * Build a snapshot of the current dashboard state.
 * Aggregates all active timers, gates, and metrics into a single object.
 */
export function buildDashboardState(
  countdowns: CountdownTimer[],
  recentEvents: DashboardEvent[],
  kpis: DashboardKPIs,
): DashboardState {
  const criticalAlerts = recentEvents.filter(e => e.severity === 'critical' || e.severity === 'emergency').length;
  const warningAlerts = recentEvents.filter(e => e.severity === 'warning').length;
  const infoAlerts = recentEvents.filter(e => e.severity === 'info').length;

  // Calculate events per minute from last 5 minutes of events
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const recentCount = recentEvents.filter(e => e.timestamp > fiveMinAgo).length;
  const eventsPerMinute = Math.round((recentCount / 5) * 10) / 10;

  return {
    kpis,
    countdowns: countdowns.filter(c => c.status !== 'breached'),
    activeScreenings: recentEvents.filter(e => e.type === 'screening-started').length,
    pendingApprovals: recentEvents.filter(e => e.type === 'approval-requested').length,
    openCases: recentEvents.filter(e => e.type === 'case-opened').length,
    filingsDueThisWeek: countdowns.filter(c =>
      (c.type === 'str-filing' || c.type === 'ctr-filing' || c.type === 'cnmr-filing') &&
      c.remainingMs < 7 * 24 * 3_600_000
    ).length,
    unresolvedAlerts: { critical: criticalAlerts, warning: warningAlerts, info: infoAlerts },
    systemStatus: criticalAlerts > 5 ? 'degraded' : 'healthy',
    lastEventAt: recentEvents.length > 0 ? recentEvents[recentEvents.length - 1].timestamp : new Date().toISOString(),
    eventsPerMinute,
  };
}

/**
 * Filter events for a specific client based on role-based access control.
 * Critical for FDL Art.29 (no tipping off) — restricts STR/screening
 * visibility to authorized roles only.
 */
export function filterEventsForClient(
  events: DashboardEvent[],
  client: DashboardClient,
): DashboardEvent[] {
  return events.filter(e => {
    // Role check
    if (!e.visibleToRoles.includes(client.userRole)) return false;
    // Panel subscription check
    if (!e.targetPanels.some(p => client.subscribedPanels.includes(p))) return false;
    return true;
  });
}

/**
 * Deduplicate events by entity + type within a time window.
 * Prevents alert fatigue from repeated similar events.
 */
export function deduplicateEvents(
  events: DashboardEvent[],
  windowMs: number = 60_000,
): DashboardEvent[] {
  const seen = new Map<string, string>(); // key -> most recent timestamp
  const result: DashboardEvent[] = [];

  for (const event of events) {
    const key = `${event.type}:${event.entityId ?? 'global'}`;
    const lastSeen = seen.get(key);

    if (lastSeen) {
      const elapsed = new Date(event.timestamp).getTime() - new Date(lastSeen).getTime();
      if (elapsed < windowMs) continue; // skip duplicate
    }

    seen.set(key, event.timestamp);
    result.push(event);
  }

  return result;
}

/**
 * Transform a raw ComplianceEvent from the streaming pipeline into
 * a DashboardEvent with appropriate routing and presentation.
 */
export function transformComplianceEvent(event: ComplianceEvent): DashboardEvent | null {
  const typeMapping: Partial<Record<EventType, DashboardEventType>> = {
    'screening-result': 'screening-completed',
    'alert': 'alert-new',
    'case-update': 'case-updated',
    'approval-decision': 'approval-completed',
    'filing-submitted': 'filing-submitted',
    'threshold-breach': 'alert-new',
    'sanctions-match': 'freeze-initiated',
    'cdd-expiry': 'case-updated',
    'risk-score-change': 'kpi-update',
  };

  const dashboardType = typeMapping[event.type];
  if (!dashboardType) return null;

  return createDashboardEvent(
    dashboardType,
    `${event.type}: ${event.entityName ?? 'Unknown'}`,
    `${event.source} reported ${event.type} at ${event.priority} priority`,
    event.data,
    event.entityId && event.entityName
      ? { entityId: event.entityId, entityName: event.entityName }
      : undefined,
  );
}
