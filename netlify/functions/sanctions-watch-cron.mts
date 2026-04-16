/**
 * Sanctions Watch Daily — cron.
 *
 * Schedule: daily 05:00 UTC = 09:00 Asia/Dubai. Feeds the Claude Code
 * "Sanctions Watch" routine that runs at the same time slot. The routine
 * reads the latest blob produced here to brief the MLRO without having
 * to re-aggregate the raw hits itself.
 *
 * This cron does NOT re-run screening. The existing
 * netlify/functions/sanctions-delta-screen-cron.mts handles that every
 * 4 hours and persists hits + audit records. This cron only aggregates
 * an MLRO-facing view over whatever those stores already contain.
 *
 * The initial implementation passes empty hit / frozen / false-positive
 * arrays for customer data we have not yet wired from the blob stores.
 * The generator tolerates empty collections and will render an "all
 * clear" report — which is still useful because it exercises the list-
 * coverage alert path.
 *
 * Follow-up (intentional, not a blocker for the routine):
 *   - Load latest DeltaScreenHit records from the sanctions-delta-
 *     screen audit store for the past 24h and pass as `hits`.
 *   - Load confirmed-freeze records from auto-remediation audit and
 *     pass as `frozenSubjects`.
 *   - Load dismissed hits from the screening audit store and pass as
 *     `recentFalsePositives`.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-22, Art.24, Art.29, Art.35
 *   - Cabinet Res 74/2020 Art.4-7
 *   - FATF Rec 6, Rec 20
 *   - MoE Circular 08/AML/2021
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const REPORT_STORE = 'sanctions-watch-reports';
const AUDIT_STORE = 'sanctions-watch-audit';
const SNAPSHOT_STORE = 'sanctions-snapshots';

interface CronResult {
  ok: boolean;
  startedAt: string;
  reportKey?: string;
  anyListMissing?: boolean;
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
    /* audit write best-effort */
  }
}

/**
 * Best-effort health probe per required source. Reads the most recent
 * snapshot key under `sanctions-snapshots/<SOURCE>/` and reports 'ok'
 * if a snapshot exists within the past 24h, 'stale' if older, and
 * 'missing' if nothing is there. Never throws.
 */
async function probeCoverage(
  now: Date
): Promise<
  Record<
    'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN',
    { status: 'ok' | 'stale' | 'missing'; lastCheckedAt?: string; note?: string }
  >
> {
  const sources = ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN'] as const;
  const store = getStore(SNAPSHOT_STORE);
  const cutoffMs = now.getTime() - 24 * 60 * 60 * 1000;

  const results: Record<
    string,
    { status: 'ok' | 'stale' | 'missing'; lastCheckedAt?: string; note?: string }
  > = {};
  for (const source of sources) {
    try {
      const listing = await store.list({ prefix: `${source}/` });
      const blobs = (listing.blobs ?? []).slice().sort((a, b) => {
        return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
      });
      const latest = blobs[0];
      if (!latest) {
        results[source] = { status: 'missing', note: 'no snapshot in store' };
        continue;
      }
      // Keys look like "<SOURCE>/<YYYY-MM-DD>/<timestamp>.json" —
      // the date prefix is enough to detect staleness without loading
      // the blob body.
      const dateSegment = latest.key.split('/')[1] ?? '';
      const dateMs = Date.parse(dateSegment);
      if (!Number.isFinite(dateMs)) {
        results[source] = { status: 'stale', note: 'key format unrecognised' };
        continue;
      }
      results[source] = {
        status: dateMs >= cutoffMs ? 'ok' : 'stale',
        lastCheckedAt: new Date(dateMs).toISOString(),
      };
    } catch (err) {
      const note = err instanceof Error ? err.message : String(err);
      results[source] = { status: 'missing', note };
    }
  }
  return results as Record<
    'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN',
    { status: 'ok' | 'stale' | 'missing'; lastCheckedAt?: string; note?: string }
  >;
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const now = new Date(startedAt);

  const { COMPANY_REGISTRY } = await import('../../src/domain/customers');
  const { buildSanctionsWatchReport, renderSanctionsWatchMarkdown } =
    await import('../../src/services/sanctionsWatchGenerator');

  try {
    const coverage = await probeCoverage(now);

    const report = buildSanctionsWatchReport({
      now,
      portfolioSize: COMPANY_REGISTRY.length,
      listCoverage: coverage,
      hits: [],
      frozenSubjects: [],
      recentFalsePositives: [],
    });

    const markdown = renderSanctionsWatchMarkdown(report);
    const key = `${startedAt.slice(0, 10)}/report.json`;
    const store = getStore(REPORT_STORE);
    await store.setJSON(key, {
      generatedAt: startedAt,
      report,
      markdown,
    });

    await writeAudit({
      event: 'sanctions_watch_report_generated',
      reportKey: key,
      portfolioSize: report.portfolioSize,
      anyListMissing: report.anyListMissing,
      missingSources: report.missingSources,
      bandCounts: report.bandCounts,
      freezeCount: report.freezeCountdowns.length,
    });

    const result: CronResult = {
      ok: true,
      startedAt,
      reportKey: key,
      anyListMissing: report.anyListMissing,
    };
    return Response.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await writeAudit({ event: 'sanctions_watch_report_failed', error });
    return Response.json({ ok: false, startedAt, error }, { status: 500 });
  }
};

export const config: Config = {
  // Daily 05:00 UTC = 09:00 Asia/Dubai.
  schedule: '0 5 * * *',
};
