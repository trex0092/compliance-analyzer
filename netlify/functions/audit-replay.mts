/**
 * Audit Replay — reconstruct the full evidentiary timeline for a
 * subject or screening event, in the exact order an auditor/inspector
 * would want it.
 *
 * GET  /api/audit-replay?subjectId=<id>
 *   → every screening event, continuous-monitor delta, and
 *     deep-brain verdict recorded against the subject, in
 *     chronological order.
 *
 * GET  /api/audit-replay?eventId=<id>
 *   → a single screening event with every linked artefact (run
 *     response, deep-brain audit chain, Asana task gid, goAML XML
 *     hash if the event produced a filing).
 *
 * The replay does NOT re-execute any decision logic — it is a pure
 * read from the durable audit blobs. This is exactly what an MoE
 * inspector asks for: "show me what this system knew about this
 * entity at each point in time, and who approved what." Re-running
 * the decision on today's data would be actively misleading.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10-year record retention)
 *   - FDL No.10/2025 Art.20-21 (CO accountability)
 *   - Cabinet Res 134/2025 Art.19 (internal review audit trail)
 *   - FATF Rec 10, 11 (record-keeping and traceability)
 *   - Cabinet Res 71/2024 (administrative-penalty evidence chain)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import type { ScreeningEvent } from './screening-save.mts';

const EVENTS_STORE = 'screening-events';
const MONITOR_AUDIT_STORE = 'continuous-monitor-audit';
const MONITOR_STATE_STORE = 'continuous-monitor-state';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimelineKind =
  | 'screening_event'
  | 'continuous_monitor_delta'
  | 'continuous_monitor_resolve'
  | 'audit_marker';

interface TimelineEntry {
  atIso: string;
  kind: TimelineKind;
  summary: string;
  evidence: Record<string, unknown>;
}

interface SubjectReplay {
  subjectId: string;
  subjectName?: string;
  firstSeenIso?: string;
  lastSeenIso?: string;
  screeningEvents: ScreeningEvent[];
  monitorRunsTouched: number;
  timeline: TimelineEntry[];
}

interface EventReplay {
  eventId: string;
  event: ScreeningEvent;
  relatedSubjectTimeline: TimelineEntry[];
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

async function listScreeningEvents(subjectId: string): Promise<ScreeningEvent[]> {
  try {
    const store = getStore(EVENTS_STORE);
    // Netlify Blobs `list` returns iterable { blobs: [{ key, etag }] }
    const listRes = await (
      store as unknown as { list: () => Promise<{ blobs: Array<{ key: string }> }> }
    ).list();
    const out: ScreeningEvent[] = [];
    for (const { key } of listRes.blobs) {
      const raw = (await store.get(key, { type: 'json' })) as ScreeningEvent | null;
      if (raw && raw.subjectId === subjectId) out.push(raw);
    }
    out.sort((a, b) => (a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : 0));
    return out;
  } catch {
    return [];
  }
}

async function loadSingleEvent(eventId: string): Promise<ScreeningEvent | null> {
  try {
    const store = getStore(EVENTS_STORE);
    const raw = (await store.get(eventId, { type: 'json' })) as ScreeningEvent | null;
    if (raw && typeof raw === 'object' && raw.eventId === eventId) return raw;
    return null;
  } catch {
    return null;
  }
}

interface MonitorAuditSubjectEntry {
  subjectId: string;
  subjectName?: string;
  newHits?: Array<{
    list?: string;
    matchedName?: string;
    score?: number;
    classification?: string;
    fingerprint?: string;
  }>;
  resolvedHits?: string[];
}
interface MonitorAuditSummary {
  runId?: string;
  startedAtIso?: string;
  finishedAtIso?: string;
  perSubject?: MonitorAuditSubjectEntry[];
}

async function listMonitorAuditsForSubject(
  subjectId: string
): Promise<MonitorAuditSummary[]> {
  try {
    const store = getStore(MONITOR_AUDIT_STORE);
    const listRes = await (
      store as unknown as { list: () => Promise<{ blobs: Array<{ key: string }> }> }
    ).list();
    const out: MonitorAuditSummary[] = [];
    for (const { key } of listRes.blobs) {
      const raw = (await store.get(key, { type: 'json' })) as MonitorAuditSummary | null;
      if (!raw || !Array.isArray(raw.perSubject)) continue;
      const touched = raw.perSubject.some((p) => p && p.subjectId === subjectId);
      if (touched) out.push(raw);
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Timeline assembly
// ---------------------------------------------------------------------------

function buildTimelineForSubject(
  subjectId: string,
  events: ScreeningEvent[],
  monitorRuns: MonitorAuditSummary[]
): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  for (const e of events) {
    timeline.push({
      atIso: e.savedAt,
      kind: 'screening_event',
      summary: `${e.outcome.toUpperCase()} — ${e.eventType} — reviewed by ${e.reviewedBy}`,
      evidence: {
        eventId: e.eventId,
        overallTopScore: e.overallTopScore,
        overallTopClassification: e.overallTopClassification,
        listsScreened: e.listsScreened,
        rationale: e.rationale,
        runId: e.runId,
        asanaGid: e.asanaGid,
        riskTier: e.riskTier,
        jurisdiction: e.jurisdiction,
      },
    });
  }

  for (const run of monitorRuns) {
    const stamp = run.finishedAtIso ?? run.startedAtIso ?? '';
    const entry = (run.perSubject ?? []).find((p) => p && p.subjectId === subjectId);
    if (!entry) continue;
    if ((entry.newHits?.length ?? 0) > 0) {
      timeline.push({
        atIso: stamp,
        kind: 'continuous_monitor_delta',
        summary: `${entry.newHits?.length ?? 0} new sanctions hit(s) detected in monitor run ${run.runId ?? ''}`,
        evidence: {
          runId: run.runId,
          newHits: entry.newHits,
        },
      });
    }
    if ((entry.resolvedHits?.length ?? 0) > 0) {
      timeline.push({
        atIso: stamp,
        kind: 'continuous_monitor_resolve',
        summary: `${entry.resolvedHits?.length ?? 0} prior hit(s) no longer present (possible delisting)`,
        evidence: {
          runId: run.runId,
          resolvedFingerprints: entry.resolvedHits,
        },
      });
    }
  }

  timeline.sort((a, b) => (a.atIso < b.atIso ? -1 : a.atIso > b.atIso ? 1 : 0));
  return timeline;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  const rateLimited = await checkRateLimit(req, { max: 30, clientIp: context.ip });
  if (rateLimited) return rateLimited;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const url = new URL(req.url);
  const subjectId = url.searchParams.get('subjectId');
  const eventId = url.searchParams.get('eventId');

  if (!subjectId && !eventId) {
    return jsonResponse(
      { ok: false, error: 'missing ?subjectId or ?eventId query parameter' },
      { status: 400 }
    );
  }

  try {
    if (eventId) {
      const event = await loadSingleEvent(eventId);
      if (!event) {
        return jsonResponse({ ok: false, error: 'event not found' }, { status: 404 });
      }
      const monitorRuns = await listMonitorAuditsForSubject(event.subjectId);
      const relatedTimeline = buildTimelineForSubject(event.subjectId, [], monitorRuns);
      const payload: EventReplay = {
        eventId,
        event,
        relatedSubjectTimeline: relatedTimeline,
      };
      return jsonResponse({ ok: true, replay: payload });
    }

    // subjectId case
    const events = await listScreeningEvents(subjectId as string);
    const monitorRuns = await listMonitorAuditsForSubject(subjectId as string);
    const timeline = buildTimelineForSubject(subjectId as string, events, monitorRuns);
    const firstSeenIso = timeline[0]?.atIso;
    const lastSeenIso = timeline[timeline.length - 1]?.atIso;
    const subjectName = events[0]?.subjectName;

    const payload: SubjectReplay = {
      subjectId: subjectId as string,
      subjectName,
      firstSeenIso,
      lastSeenIso,
      screeningEvents: events,
      monitorRunsTouched: monitorRuns.length,
      timeline,
    };
    return jsonResponse({ ok: true, replay: payload });
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'replay failed',
      },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: '/api/audit-replay',
};

// Exported for unit tests.
export const __test__ = {
  buildTimelineForSubject,
  MONITOR_AUDIT_STORE,
  MONITOR_STATE_STORE,
};
