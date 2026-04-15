/**
 * Sanctions Delta Cohort Screen Cron.
 *
 * Scheduled function that runs after `sanctions-ingest-cron` and
 * re-screens every active customer in the blob-stored cohort against
 * the most recent sanctions delta. Hits are appended to an audit
 * blob and (when actionable) dispatched as Asana tasks via the
 * orchestrator with the right SLA section attached.
 *
 * Why this exists:
 *   The existing sanctions-ingest-cron computes deltas every 4h
 *   but does NOT re-screen the customer cohort against them. So
 *   when OFAC adds a name on Tuesday morning, we have the delta
 *   in the blob store within 4h — but a customer onboarded on
 *   Monday is still not flagged until their next periodic CDD
 *   review (which can be weeks away). Cabinet Res 74/2020 Art.4
 *   requires "without delay" — weeks is unacceptable.
 *
 *   This cron closes that loop: it polls the latest delta, walks
 *   the per-tenant cohort blob `sanctions-cohort/<tenantId>/cohort.json`,
 *   runs `screenCohortAgainstDelta` (pure function), and dispatches
 *   each hit. Confirmed hits go straight to the EOCN Freeze Required
 *   section; likely hits go to Pending CO Review with a 24h SLA;
 *   potential hits go to escalation review.
 *
 * Schedule: `0 *\/4 * * *` (every 4 hours, aligned with ingest cron).
 *
 * Cohort blob layout:
 *   sanctions-cohort/<tenantId>/cohort.json
 *     → JSON array of CohortCustomer records
 *
 * Audit log:
 *   sanctions-delta-screen-audit/<YYYY-MM-DD>/<runId>.json
 *     → run summary with per-tenant hit counts + downstream dispatch ids
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22  (CO continuous monitoring)
 *   FDL No.10/2025 Art.35     (TFS — sanctions completeness)
 *   Cabinet Res 74/2020 Art.4-7 (24h freeze, 5 BD CNMR)
 *   FATF Rec 6                (timely UN sanctions implementation)
 *   FATF Rec 20               (ongoing monitoring)
 *   MoE Circular 08/AML/2021  (DPMS sector — quarterly-or-faster screening)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import {
  screenCohortAgainstDelta,
  type CohortCustomer,
  type DeltaScreenHit,
} from '../../src/services/sanctionsDeltaCohortScreener';
import type { SanctionsDelta } from '../../src/services/sanctionsDelta';
import { orchestrator as defaultOrchestrator } from '../../src/services/asana/orchestrator';

const COHORT_STORE = 'sanctions-cohort';
const DELTA_STORE = 'sanctions-deltas';
const AUDIT_STORE = 'sanctions-delta-screen-audit';

interface PerTenantResult {
  tenantId: string;
  cohortSize: number;
  hits: number;
  confirmedFreezes: number;
  likelyGates: number;
  potentialEscalations: number;
  dispatchedTaskIds: readonly string[];
  errorMessage?: string;
}

interface RunSummary {
  ok: boolean;
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  runId: string;
  deltaSnapshot: { fromHash: string; toHash: string; computedAtIso: string } | null;
  tenants: readonly PerTenantResult[];
  totalHits: number;
  totalConfirmed: number;
  totalLikely: number;
  totalPotential: number;
  skippedReason?: string;
}

function parseTenants(csv: string | undefined): readonly string[] {
  if (!csv || typeof csv !== 'string') return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 64);
}

async function loadLatestDelta(): Promise<SanctionsDelta | null> {
  try {
    const store = getStore(DELTA_STORE);
    // The ingest cron writes one delta per source per day. The "latest"
    // logical delta is the union of every source delta produced today.
    // For this screener we fall back to a single key the ingest cron
    // also writes: `latest.json` (a merged view). If it's not present
    // we return null and the cron skips.
    const raw = await store.get('latest.json', { type: 'json' });
    if (!raw || typeof raw !== 'object') return null;
    return raw as SanctionsDelta;
  } catch {
    return null;
  }
}

async function loadCohort(tenantId: string): Promise<readonly CohortCustomer[]> {
  try {
    const store = getStore(COHORT_STORE);
    const raw = await store.get(`${tenantId}/cohort.json`, { type: 'json' });
    if (!Array.isArray(raw)) return [];
    return raw as CohortCustomer[];
  } catch {
    return [];
  }
}

async function dispatchHit(hit: DeltaScreenHit): Promise<string | null> {
  // Dispatch via the orchestrator — same idempotency contract as
  // every other Asana write. Failure is non-fatal: the audit log
  // still records the hit even if Asana is unreachable.
  try {
    const result = await defaultOrchestrator.dispatchBrainVerdict({
      id: `delta:${hit.matchedAgainst.id}:${hit.customerId}`,
      tenantId: hit.tenantId,
      verdict: hit.recommendedAction === 'freeze_immediately' ? 'freeze' : 'escalate',
      confidence: hit.matchScore,
      recommendedAction:
        hit.recommendedAction === 'freeze_immediately'
          ? 'Execute EOCN freeze within 24 clock hours per Cabinet Res 74/2020 Art.4. Stage CNMR within 5 business days. DO NOT notify subject (FDL Art.29).'
          : 'CO review required: sanctions delta hit — investigate match before deciding freeze vs false positive.',
      requiresHumanReview: true,
      at: new Date().toISOString(),
      entityId: hit.customerId,
      entityName: hit.matchedAgainst.name,
      citations: [
        'FDL No.10/2025 Art.35',
        'Cabinet Res 74/2020 Art.4-7',
        'FATF Rec 6',
      ],
    });
    return result?.taskGid ?? null;
  } catch (err) {
    console.warn(
      '[sanctions-delta-screen-cron] dispatch failed:',
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

async function writeAudit(summary: RunSummary): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const day = summary.startedAtIso.slice(0, 10);
    await store.setJSON(`${day}/${summary.runId}.json`, summary);
  } catch (err) {
    console.warn(
      '[sanctions-delta-screen-cron] audit write failed:',
      err instanceof Error ? err.message : String(err)
    );
  }
}

export default async (): Promise<Response> => {
  const startedAt = new Date();
  const runId = `${startedAt.getTime()}-${Math.floor(Math.random() * 1e6)}`;

  const tenants = parseTenants(process.env.HAWKEYE_DELTA_SCREEN_TENANTS);
  if (tenants.length === 0) {
    const summary: RunSummary = {
      ok: true,
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      runId,
      deltaSnapshot: null,
      tenants: [],
      totalHits: 0,
      totalConfirmed: 0,
      totalLikely: 0,
      totalPotential: 0,
      skippedReason: 'HAWKEYE_DELTA_SCREEN_TENANTS not configured',
    };
    await writeAudit(summary);
    return Response.json(summary);
  }

  const delta = await loadLatestDelta();
  if (!delta) {
    const summary: RunSummary = {
      ok: true,
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      runId,
      deltaSnapshot: null,
      tenants: [],
      totalHits: 0,
      totalConfirmed: 0,
      totalLikely: 0,
      totalPotential: 0,
      skippedReason: 'no latest delta in sanctions-deltas blob store',
    };
    await writeAudit(summary);
    return Response.json(summary);
  }

  const tenantResults: PerTenantResult[] = [];
  let totalHits = 0;
  let totalConfirmed = 0;
  let totalLikely = 0;
  let totalPotential = 0;

  for (const tenantId of tenants) {
    try {
      const cohort = await loadCohort(tenantId);
      const report = screenCohortAgainstDelta(cohort, delta);

      const dispatchedTaskIds: string[] = [];
      let confirmed = 0;
      let likely = 0;
      let potential = 0;

      for (const hit of report.hits) {
        if (hit.recommendedAction === 'freeze_immediately') confirmed += 1;
        else if (hit.recommendedAction === 'gate_for_co_review') likely += 1;
        else potential += 1;

        const taskId = await dispatchHit(hit);
        if (taskId) dispatchedTaskIds.push(taskId);
      }

      tenantResults.push({
        tenantId,
        cohortSize: report.cohortSize,
        hits: report.hits.length,
        confirmedFreezes: confirmed,
        likelyGates: likely,
        potentialEscalations: potential,
        dispatchedTaskIds,
      });

      totalHits += report.hits.length;
      totalConfirmed += confirmed;
      totalLikely += likely;
      totalPotential += potential;
    } catch (err) {
      tenantResults.push({
        tenantId,
        cohortSize: 0,
        hits: 0,
        confirmedFreezes: 0,
        likelyGates: 0,
        potentialEscalations: 0,
        dispatchedTaskIds: [],
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: RunSummary = {
    ok: true,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    runId,
    deltaSnapshot: {
      fromHash: delta.fromSnapshotHash,
      toHash: delta.toSnapshotHash,
      computedAtIso: delta.computedAtIso,
    },
    tenants: tenantResults,
    totalHits,
    totalConfirmed,
    totalLikely,
    totalPotential,
  };

  await writeAudit(summary);
  return Response.json(summary);
};

export const config: Config = {
  // Every 4 hours — aligned with sanctions-ingest-cron cadence.
  schedule: '0 */4 * * *',
};

// Exported for tests.
export const __test__ = {
  parseTenants,
};
