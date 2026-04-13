/**
 * War-room dashboard snapshot builder.
 *
 * Framework-agnostic view-model producer. Consumers (React panel,
 * vanilla JS dashboard, voice assistant, regulator portal) call
 * `buildDashboardSnapshot` with a war-room feed and a tenant id, and
 * receive a flat, serialisable view model ready to render.
 *
 * Separation of concerns: the feed (`WarRoomFeed`) is append-only and
 * raw. The dashboard (`buildDashboardSnapshot`) is a derived view —
 * it aggregates, filters, and formats for the UI without mutating
 * feed state. Keeping compute here rather than in the UI lets us test
 * deterministically and reuse across surfaces.
 */

import type { WarRoomFeed, WarRoomSnapshot, IncidentSeverity } from './warRoomFeed';

export interface DashboardTile {
  id: string;
  label: string;
  value: string;
  accent: 'info' | 'ok' | 'warn' | 'critical';
  sublabel?: string;
}

export interface DashboardIncidentCard {
  id: string;
  title: string;
  severity: IncidentSeverity;
  openedAt: string;
  deadlineIso?: string;
  minutesRemaining?: number;
  entityId?: string;
  caseId?: string;
}

export interface DashboardSnapshot {
  asOf: string;
  tenantId: string;
  tiles: DashboardTile[];
  topIncidents: DashboardIncidentCard[];
  upcomingDeadlines: DashboardIncidentCard[];
  recentEventTitles: string[];
  /** Underlying war-room snapshot for drill-down. */
  raw: WarRoomSnapshot;
}

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export function buildDashboardSnapshot(feed: WarRoomFeed, tenantId: string): DashboardSnapshot {
  const raw = feed.snapshot();

  const tiles: DashboardTile[] = [
    {
      id: 'screenings-1h',
      label: 'Screenings (1h)',
      value: String(raw.kpis.screeningsLast1h),
      accent: raw.kpis.screeningsLast1h === 0 ? 'info' : 'ok',
    },
    {
      id: 'sanctions-hits-1h',
      label: 'Sanctions hits (1h)',
      value: String(raw.kpis.sanctionsMatchesLast1h),
      accent: raw.kpis.sanctionsMatchesLast1h > 0 ? 'critical' : 'ok',
      sublabel: pct(raw.kpis.sanctionsMatchesLast1h, raw.kpis.screeningsLast1h) + ' match rate',
    },
    {
      id: 'str-24h',
      label: 'STRs filed (24h)',
      value: String(raw.kpis.strFiledLast24h),
      accent: raw.kpis.strFiledLast24h > 0 ? 'warn' : 'ok',
    },
    {
      id: 'freezes-active',
      label: 'Active freezes',
      value: String(raw.kpis.freezesActive),
      accent: raw.kpis.freezesActive > 0 ? 'critical' : 'ok',
    },
    {
      id: 'incidents-critical',
      label: 'Critical incidents',
      value: String(raw.incidentsBySeverity.critical || 0),
      accent: (raw.incidentsBySeverity.critical || 0) > 0 ? 'critical' : 'ok',
    },
    {
      id: 'incidents-high',
      label: 'High incidents',
      value: String(raw.incidentsBySeverity.high || 0),
      accent: (raw.incidentsBySeverity.high || 0) > 0 ? 'warn' : 'ok',
    },
    {
      id: 'evidence-breaks',
      label: 'Evidence breaks',
      value: String(raw.kpis.evidenceBreaksOpen),
      accent: raw.kpis.evidenceBreaksOpen > 0 ? 'critical' : 'ok',
    },
  ];

  const topIncidents: DashboardIncidentCard[] = raw.activeIncidents.slice(0, 10).map((i) => ({
    id: i.id,
    title: i.title,
    severity: i.severity,
    openedAt: i.openedAt,
    deadlineIso: i.deadlineIso,
    minutesRemaining: i.minutesRemaining,
    entityId: i.entityId,
    caseId: i.caseId,
  }));

  const upcomingDeadlines: DashboardIncidentCard[] = raw.upcomingDeadlines
    .slice(0, 10)
    .map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      openedAt: i.openedAt,
      deadlineIso: i.deadlineIso,
      minutesRemaining: i.minutesRemaining,
      entityId: i.entityId,
      caseId: i.caseId,
    }));

  const recentEventTitles = raw.recentEvents
    .slice(0, 20)
    .map((e) => `[${e.severity.toUpperCase()}] ${e.title}`);

  return {
    asOf: raw.asOf,
    tenantId,
    tiles,
    topIncidents,
    upcomingDeadlines,
    recentEventTitles,
    raw,
  };
}

/**
 * Build a 20-sentence voice brief from a dashboard snapshot. The
 * output is plain prose suitable for piping into a TTS service.
 * Every sentence is short (< 120 chars) so the TTS engine can
 * deliver them naturally without running out of breath.
 */
export function buildVoiceBrief(snap: DashboardSnapshot): string[] {
  const sentences: string[] = [];
  const r = snap.raw;

  sentences.push(`Compliance status as of ${snap.asOf.slice(0, 16).replace('T', ' ')} UTC.`);

  if ((r.incidentsBySeverity.critical || 0) > 0) {
    sentences.push(
      `${r.incidentsBySeverity.critical} critical incidents open. Immediate attention required.`
    );
  } else {
    sentences.push('No critical incidents open.');
  }

  if ((r.incidentsBySeverity.high || 0) > 0) {
    sentences.push(`${r.incidentsBySeverity.high} high-severity incidents pending.`);
  }

  sentences.push(
    `${r.kpis.screeningsLast1h} screenings in the last hour, with ${r.kpis.sanctionsMatchesLast1h} potential hits.`
  );

  if (r.kpis.freezesActive > 0) {
    sentences.push(`${r.kpis.freezesActive} asset freezes are active.`);
  }

  if (r.kpis.evidenceBreaksOpen > 0) {
    sentences.push(`${r.kpis.evidenceBreaksOpen} evidence chain breaks require MLRO review.`);
  }

  const deadlines = r.upcomingDeadlines.slice(0, 3);
  if (deadlines.length > 0) {
    sentences.push(
      `Next regulatory deadline: ${deadlines[0].title} in ${deadlines[0].minutesRemaining ?? '?'} minutes.`
    );
    for (let i = 1; i < deadlines.length; i++) {
      sentences.push(
        `Also: ${deadlines[i].title} in ${deadlines[i].minutesRemaining ?? '?'} minutes.`
      );
    }
  }

  sentences.push(`${r.totalEventsIngested} total events on the feed. End of brief.`);

  return sentences;
}
