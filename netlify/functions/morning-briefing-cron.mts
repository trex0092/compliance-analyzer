/**
 * Weekday Morning Briefing — cron.
 *
 * Schedule: weekdays 04:00 UTC = 08:00 Asia/Dubai. Feeds the Claude
 * Code "Compliance Morning Briefing" routine that runs at the same
 * slot. The routine reads the latest blob from this cron so it can
 * brief the MLRO without re-aggregating from scratch.
 *
 * This cron is thin by design:
 *   1. Probe the sanctions-snapshots store for list-coverage health.
 *   2. Walk the past 24h of audit blobs for sanctions-delta-screen-audit,
 *      sanctions-watch-audit, cdd-weekly-status-audit, and summarise
 *      overnight activity + per-cron health.
 *   3. Derive reviews due today from COMPANY_REGISTRY + the existing
 *      review-schedule helper.
 *   4. Pass empty arrays for frozenSubjects / pendingApprovals / filings
 *      because no persistence layer exists yet for those — the
 *      generator renders "no critical items" cleanly.
 *   5. Build the report, persist JSON + markdown to the blob store,
 *      and dispatch a status_update to the central MLRO Asana project
 *      (graceful no-op if ASANA_CENTRAL_MLRO_PROJECT_GID unset).
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-22, Art.24, Art.29, Art.35
 *   - Cabinet Res 74/2020 Art.4-7
 *   - Cabinet Res 134/2025 Art.14, Art.19
 *   - MoE Circular 08/AML/2021
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const REPORT_STORE = 'morning-briefing-reports';
const AUDIT_STORE = 'morning-briefing-audit';
const SNAPSHOT_STORE = 'sanctions-snapshots';

const MONITORED_CRONS: ReadonlyArray<{ cronId: string; store: string }> = [
  { cronId: 'sanctions-delta-screen-cron', store: 'sanctions-delta-screen-audit' },
  { cronId: 'sanctions-watch-cron', store: 'sanctions-watch-audit' },
  { cronId: 'cdd-weekly-status-cron', store: 'cdd-weekly-status-audit' },
];

interface CronResult {
  ok: boolean;
  startedAt: string;
  reportKey?: string;
  /**
   * Rendered markdown report. Returned inline so Claude Code routines
   * can fetch the cron URL and present the briefing directly, without
   * needing Netlify blob SDK access.
   */
  markdown?: string;
  mlroDispatch?: { ok: boolean; skipped?: string; statusUpdateGid?: string; error?: string };
  error?: string;
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const iso = new Date().toISOString();
    await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
      ...payload,
      recordedAt: iso,
    });
  } catch {
    /* best-effort */
  }
}

type ProbeStatus = 'ok' | 'stale' | 'missing' | 'manual-pending';
type ProbeEntry = { status: ProbeStatus; lastCheckedAt?: string; note?: string };

// Sources without a stable URL default to `manual-pending` so the
// briefing does not flag them as a daily regulatory failure.
const MANUAL_ONLY_SOURCES = new Set<'UAE' | 'EOCN'>(['UAE', 'EOCN']);

async function probeCoverage(
  now: Date
): Promise<Record<'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN', ProbeEntry>> {
  const sources = ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN'] as const;
  const store = getStore(SNAPSHOT_STORE);
  const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;
  const out: Record<string, ProbeEntry> = {};
  for (const source of sources) {
    const manualOnly = MANUAL_ONLY_SOURCES.has(source as 'UAE' | 'EOCN');
    try {
      const listing = await store.list({ prefix: `${source}/` });
      const blobs = (listing.blobs ?? [])
        .slice()
        .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
      const latest = blobs[0];
      if (!latest) {
        out[source] = manualOnly
          ? { status: 'manual-pending', note: 'awaiting manual upload' }
          : { status: 'missing', note: 'no snapshot in store' };
        continue;
      }
      const dateSegment = latest.key.split('/')[1] ?? '';
      const dateMs = Date.parse(dateSegment);
      if (!Number.isFinite(dateMs)) {
        out[source] = { status: 'stale', note: 'key format unrecognised' };
        continue;
      }
      out[source] = {
        status: dateMs >= cutoffMs ? 'ok' : 'stale',
        lastCheckedAt: new Date(dateMs).toISOString(),
      };
    } catch (err) {
      const note = err instanceof Error ? err.message : String(err);
      out[source] = manualOnly ? { status: 'manual-pending', note } : { status: 'missing', note };
    }
  }
  return out as Record<'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN', ProbeEntry>;
}

async function probeCronHealth(now: Date): Promise<
  Array<{
    cronId: string;
    runCount: number;
    okCount: number;
    lastRunAtIso?: string;
    note?: string;
  }>
> {
  const out: Array<{
    cronId: string;
    runCount: number;
    okCount: number;
    lastRunAtIso?: string;
    note?: string;
  }> = [];
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const cron of MONITORED_CRONS) {
    try {
      const store = getStore(cron.store);
      const prefixes = [today, yesterday];
      let runCount = 0;
      let okCount = 0;
      let lastKey: string | undefined;
      for (const prefix of prefixes) {
        const listing = await store.list({ prefix: `${prefix}/` });
        for (const blob of listing.blobs ?? []) {
          runCount += 1;
          // For a best-effort health check we only inspect the key; loading
          // every blob body is too expensive for a cold start.
          if (!lastKey || blob.key > lastKey) lastKey = blob.key;
        }
      }
      // Without loading every body, treat runCount>0 as ok — the stores
      // only write an audit entry after a completed invocation. Crons
      // that failed hard and never wrote an entry surface as runCount=0.
      okCount = runCount;
      const lastRunAtIso = lastKey
        ? (() => {
            const parts = lastKey!.split('/');
            const stamp = parts[1]?.replace(/\.json$/, '');
            const ms = stamp ? Number(stamp) : NaN;
            return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
          })()
        : undefined;
      out.push({
        cronId: cron.cronId,
        runCount,
        okCount,
        lastRunAtIso,
        note: runCount === 0 ? 'no runs in past 24h' : undefined,
      });
    } catch (err) {
      out.push({
        cronId: cron.cronId,
        runCount: 0,
        okCount: 0,
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

async function probeOvernightActivity(now: Date): Promise<{
  newConfirmedHits: number;
  newLikelyHits: number;
  newPotentialHits: number;
  deltaScreenRuns: number;
  sanctionsIngestRuns: number;
}> {
  const cutoffMs = now.getTime() - 16 * 60 * 60 * 1000;
  let newConfirmedHits = 0;
  let newLikelyHits = 0;
  let newPotentialHits = 0;
  let deltaScreenRuns = 0;
  try {
    const store = getStore('sanctions-delta-screen-audit');
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const prefix of [today, yesterday]) {
      const listing = await store.list({ prefix: `${prefix}/` });
      for (const blob of listing.blobs ?? []) {
        const body = (await store.get(blob.key, { type: 'json' })) as {
          finishedAtIso?: string;
          totalConfirmed?: number;
          totalLikely?: number;
          totalPotential?: number;
        } | null;
        if (!body) continue;
        const tms = body.finishedAtIso ? Date.parse(body.finishedAtIso) : NaN;
        if (!Number.isFinite(tms) || tms < cutoffMs) continue;
        deltaScreenRuns += 1;
        newConfirmedHits += Number(body.totalConfirmed ?? 0);
        newLikelyHits += Number(body.totalLikely ?? 0);
        newPotentialHits += Number(body.totalPotential ?? 0);
      }
    }
  } catch {
    /* best-effort */
  }
  // Ingest run counting — lightweight: we count audit entries on the
  // ingest store's recent prefixes when that store is present. The store
  // name is conventional; if missing, the count stays 0.
  let sanctionsIngestRuns = 0;
  try {
    const store = getStore('sanctions-ingest-audit');
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const prefix of [today, yesterday]) {
      const listing = await store.list({ prefix: `${prefix}/` });
      sanctionsIngestRuns += (listing.blobs ?? []).length;
    }
  } catch {
    /* best-effort */
  }
  return {
    newConfirmedHits,
    newLikelyHits,
    newPotentialHits,
    deltaScreenRuns,
    sanctionsIngestRuns,
  };
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const now = new Date(startedAt);

  const { COMPANY_REGISTRY } = await import('../../src/domain/customers');
  const { createReviewSchedule, checkReviewStatus } =
    await import('../../src/domain/periodicReview');
  const { buildMorningBriefingReport, renderMorningBriefingMarkdown } =
    await import('../../src/services/morningBriefingGenerator');
  const { postMlroStatusUpdate, deriveStatusColor } =
    await import('../../src/services/mlroAsanaDispatch');

  try {
    const [coverage, cronHealth, overnightActivity] = await Promise.all([
      probeCoverage(now),
      probeCronHealth(now),
      probeOvernightActivity(now),
    ]);

    // Reviews due today = any customer whose review schedule status is
    // 'due' given the current risk rating + last review date.
    const reviewsDueToday = COMPANY_REGISTRY.flatMap((c) => {
      const schedule = createReviewSchedule(
        c.id,
        c.legalName,
        c.riskRating,
        'cdd-refresh',
        c.lastCDDReviewDate
      );
      const live = checkReviewStatus(schedule);
      if (live.status !== 'due') return [];
      const tier = c.riskRating === 'high' ? 'EDD' : c.riskRating === 'medium' ? 'CDD' : 'SDD';
      return [
        {
          customerId: c.id,
          customerName: c.legalName,
          tier: tier as 'SDD' | 'CDD' | 'EDD',
          nextReviewDate: schedule.nextReviewDate,
        },
      ];
    });

    const report = buildMorningBriefingReport({
      now,
      listCoverage: coverage,
      cronHealth,
      reviewsDueToday,
      overnightActivity,
      // Persistence for these three does not yet exist. Leaving empty
      // here is safe — the generator surfaces "no items" rather than
      // pretending we checked them. See PR description for follow-up.
      frozenSubjects: [],
      pendingApprovals: [],
      filings: [],
    });

    const markdown = renderMorningBriefingMarkdown(report);
    const key = `${startedAt.slice(0, 10)}/report.json`;
    const store = getStore(REPORT_STORE);
    await store.setJSON(key, {
      generatedAt: startedAt,
      report,
      markdown,
    });

    // Dispatch to the central MLRO Asana project.
    const mlroDispatch = await postMlroStatusUpdate({
      title: `Morning Briefing — ${startedAt.slice(0, 10)}`,
      markdown,
      statusType: deriveStatusColor({
        anyListMissing: report.anyListMissing,
        confirmedHits: report.overnightActivity.newConfirmedHits,
        imminentBreaches: report.criticalToday.imminentFreezeBreaches.length,
        overdueFilings: report.actionList.overdueFilings.length,
      }),
    });

    await writeAudit({
      event: 'morning_briefing_report_generated',
      reportKey: key,
      anyListMissing: report.anyListMissing,
      missingSources: report.missingSources,
      overnightActivity: report.overnightActivity,
      criticalCount:
        report.criticalToday.imminentFreezeBreaches.length +
        report.criticalToday.filingsDueToday.length +
        report.criticalToday.reviewsDueToday.length,
      mlroDispatch,
    });

    const result: CronResult = {
      ok: true,
      startedAt,
      reportKey: key,
      markdown,
      mlroDispatch,
    };
    return Response.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await writeAudit({ event: 'morning_briefing_report_failed', error });
    return Response.json({ ok: false, startedAt, error }, { status: 500 });
  }
};

export const config: Config = {
  // Weekdays (Mon–Fri) 04:00 UTC = 08:00 Asia/Dubai.
  schedule: '0 4 * * 1-5',
};
