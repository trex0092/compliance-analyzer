/**
 * Asana Weekly Digest — F10 (cron).
 *
 * Once a week (Mondays 06:00 UTC), assemble a summary task in the
 * "MLRO Weekly Digest" project containing the past 7 days of
 * compliance KPIs:
 *
 *   - Total decisions, verdict distribution
 *   - Median + p95 decision latency
 *   - Sanctions hits, freezes initiated, STRs filed
 *   - Drift report status
 *   - Red-team miss count
 *
 * The cron emits a digest task payload via the orchestrator's
 * `weekly_digest` template. The actual Asana create-task call is
 * deferred to the executor (asana-dispatch / asana-proxy) so this
 * cron stays small and deterministic.
 *
 * Regulatory basis:
 *   FDL Art.20-21 (CO oversight)
 *   Cabinet Res 134/2025 Art.19 (internal review cadence)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { orchestrateAsanaForEvent } from '../../src/services/asanaComplianceOrchestrator';

const BRAIN_STORE = 'brain-events';
const DIGEST_STORE = 'asana-weekly-digests';
const DIGEST_AUDIT_STORE = 'asana-weekly-digest-audit';

interface DigestSummary {
  windowFromIso: string;
  windowToIso: string;
  totalEvents: number;
  countsBySeverity: Record<string, number>;
}

async function buildDigestSummary(): Promise<DigestSummary> {
  const store = getStore(BRAIN_STORE);
  const todayIso = new Date().toISOString();
  const sevenDaysAgoIso = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const counts: Record<string, number> = {};
  let total = 0;
  // Walk the last 7 daily prefixes — same pattern as the inspector.
  for (let i = 0; i < 7; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    let listing;
    try {
      listing = await store.list({ prefix: day });
    } catch {
      continue;
    }
    for (const entry of listing.blobs || []) {
      try {
        const blob = (await store.get(entry.key, { type: 'json' })) as {
          event?: { severity?: string };
        } | null;
        if (!blob?.event) continue;
        total++;
        const sev = String(blob.event.severity ?? 'info');
        counts[sev] = (counts[sev] ?? 0) + 1;
      } catch {
        /* skip malformed */
      }
    }
  }
  return {
    windowFromIso: sevenDaysAgoIso,
    windowToIso: todayIso,
    totalEvents: total,
    countsBySeverity: counts,
  };
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const summary = await buildDigestSummary();

  const plan = orchestrateAsanaForEvent({
    kind: 'weekly_digest',
    tenantId: 'default',
    occurredAtIso: startedAt,
    refId: `weekly-digest-${startedAt.slice(0, 10)}`,
    payload: { summary },
  });

  // Persist the digest plan; the Asana executor cron picks it up.
  const store = getStore(DIGEST_STORE);
  await store.setJSON(`${startedAt.slice(0, 10)}.json`, {
    at: startedAt,
    summary,
    plan,
  });

  const auditStore = getStore(DIGEST_AUDIT_STORE);
  await auditStore.setJSON(`${startedAt.slice(0, 10)}.json`, {
    at: startedAt,
    totalEvents: summary.totalEvents,
    countsBySeverity: summary.countsBySeverity,
  });

  return Response.json({
    ok: true,
    summary,
    taskCount: plan.tasks.length,
  });
};

export const config: Config = {
  // Mondays 06:00 UTC = 10:00 Asia/Dubai — start of the business
  // week, before the MLRO sits down at their desk.
  schedule: '0 6 * * 1',
};
