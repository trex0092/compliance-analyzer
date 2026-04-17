/**
 * Asana ↔ Brain State Reconciler — Phase 19 W-C cron.
 *
 * Schedule: every 5 minutes.
 *
 * The cron enumerates every known tenant and writes an audit row
 * per tick so the MLRO dashboard can surface "when did reconcile
 * last run and on which tenants".
 *
 * Two operating modes:
 *
 *   1. Default — observational only. readSnapshotsForTenant()
 *      returns empty arrays, the reconciler reports zero actions,
 *      and the audit row records that snapshots were not read.
 *      Safe by construction: nothing changes in the brain or in
 *      Asana even if the cron fires every 5 minutes.
 *
 *   2. Live mode — set ASANA_RECONCILE_LIVE_READS_ENABLED=1.
 *      Snapshot reads now go to two authoritative sources:
 *        - asana-plans blob store (recent dispatched plans → brain
 *          cases in awaiting_four_eyes state)
 *        - listProjectTasks() against the tenant's compliance
 *          project (Asana tasks → snapshots, caseId matched
 *          heuristically by name).
 *      The audit row records match-quality diagnostics
 *      (plansForTenant, asanaTasksMatched, fallbackReason) so the
 *      operator can review the first cycles' output before
 *      committing to the mode in production.
 *
 * Escape hatch: ASANA_RECONCILE_CRON_DISABLED=1 makes the cron
 * a no-op (exits immediately with ok: true). Default: enabled.
 *
 * Regulatory anchor:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility of brain ↔ Asana
 *     drift requires scheduled reconciliation.
 *   FDL No. 10 of 2025 Art.24 — 10-year retention of
 *     reconciliation decisions as audit rows.
 *   Cabinet Resolution 134/2025 Art.12-14 — four-eyes integrity;
 *     a missed Asana → brain mirror threatens it.
 *   Cabinet Resolution 134/2025 Art.19 — internal review.
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { COMPANY_REGISTRY } from '../../src/domain/customers';
import {
  reconcileTenant,
  type AsanaTaskSnapshot,
  type BrainCase,
} from '../../src/services/asanaBrainStateReconciler';
import { listProjectTasks } from '../../src/services/asanaClient';
import { resolveTenantProject } from '../../src/services/asanaTenantProjectResolver';

const AUDIT_STORE = 'asana-reconcile-audit';
const PLAN_STORE = 'asana-plans';

// Window for "recent" brain plans considered open. Larger than the
// typical four-eyes turnaround so the reconciler doesn't miss
// in-flight cases. Bound by the 30-day idempotency TTL described
// in IDEMPOTENCY.md.
const PLAN_LOOKBACK_DAYS = 7;

function cronDisabled(): boolean {
  const raw =
    typeof process !== 'undefined' ? process.env?.ASANA_RECONCILE_CRON_DISABLED : undefined;
  if (!raw) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function liveReadsEnabled(): boolean {
  // Off by default — opt-in only. The match quality is approximate
  // (Asana task → caseId is heuristic by name match) and an
  // operator should turn it on consciously after reviewing the
  // first audit cycles' output.
  const raw =
    typeof process !== 'undefined' ? process.env?.ASANA_RECONCILE_LIVE_READS_ENABLED : undefined;
  if (!raw) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    ...payload,
    recordedAt: iso,
  });
}

/**
 * Per-tenant snapshot read.
 *
 * Default (ASANA_RECONCILE_LIVE_READS_ENABLED unset): returns empty
 * arrays so the cron is purely observational — it ticks on schedule
 * and writes an audit row per tenant but produces no reconciliation
 * actions. Safe by construction.
 *
 * Live mode (ASANA_RECONCILE_LIVE_READS_ENABLED=1): reads from two
 * sources that are already authoritative on the platform today:
 *   - Brain side: `asana-plans` blob store. Each blob written by
 *     /api/asana/dispatch has shape { at, refId, plan } where plan
 *     carries event.tenantId. We treat every plan from the last
 *     PLAN_LOOKBACK_DAYS as a brain case in 'awaiting_four_eyes'
 *     state with updatedAtMs = Date.parse(at).
 *   - Asana side: listProjectTasks() against the resolved compliance
 *     project for the tenant. Each task is an AsanaTaskSnapshot
 *     with state derived from `completed`. caseId is matched
 *     heuristically: the resolver looks for the brain refId inside
 *     the task name. This is approximate; a future PR can use a
 *     custom field GID once the dispatcher writes it.
 *
 * Limitations (documented for the audit narrative):
 *   - Brain state is always 'awaiting_four_eyes' here because the
 *     plan blob does not carry an explicit case-completion record.
 *     The reconciler will therefore only flag class-1 drift
 *     (Asana-completed-but-brain-pending) cleanly. Class-2 (brain
 *     ahead) and class-3 (missing task) detection requires the real
 *     case store, which lands in the follow-on PR.
 *   - Heuristic case-id matching by task name will miss cases where
 *     the task name format changed. Audit narrative records the
 *     match attempt count vs. found count so the operator can see
 *     match quality.
 */
async function readSnapshotsForTenant(tenantId: string): Promise<{
  brainCases: BrainCase[];
  asanaTasks: AsanaTaskSnapshot[];
  diagnostics: {
    plansScanned: number;
    plansForTenant: number;
    asanaTasksScanned: number;
    asanaTasksMatched: number;
    asanaProjectGid: string | null;
    fallbackReason?: string;
  };
}> {
  if (!liveReadsEnabled()) {
    return {
      brainCases: [],
      asanaTasks: [],
      diagnostics: {
        plansScanned: 0,
        plansForTenant: 0,
        asanaTasksScanned: 0,
        asanaTasksMatched: 0,
        asanaProjectGid: null,
        fallbackReason: 'live_reads_disabled_by_env',
      },
    };
  }

  // ── Brain side: scan recent asana-plans blobs ──────────────────
  const brainCases: BrainCase[] = [];
  let plansScanned = 0;
  let plansForTenant = 0;
  try {
    const planStore = getStore(PLAN_STORE);
    const cutoffMs = Date.now() - PLAN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    // Walk the last N days as YYYY-MM-DD prefixes.
    for (let dayOffset = 0; dayOffset < PLAN_LOOKBACK_DAYS; dayOffset++) {
      const dayMs = Date.now() - dayOffset * 24 * 60 * 60 * 1000;
      const isoDay = new Date(dayMs).toISOString().slice(0, 10);
      const list = await planStore.list({ prefix: `${isoDay}/` }).catch(() => null);
      if (!list || !list.blobs) continue;
      for (const entry of list.blobs) {
        plansScanned++;
        const blob = (await planStore.get(entry.key, { type: 'json' }).catch(() => null)) as {
          at?: string;
          refId?: string;
          plan?: { event?: { tenantId?: string } };
        } | null;
        if (!blob) continue;
        const blobTenant = blob.plan?.event?.tenantId;
        if (blobTenant !== tenantId) continue;
        const updatedAtMs = blob.at ? Date.parse(blob.at) : dayMs;
        if (!Number.isFinite(updatedAtMs) || updatedAtMs < cutoffMs) continue;
        if (typeof blob.refId !== 'string' || blob.refId.length === 0) continue;
        plansForTenant++;
        brainCases.push({
          caseId: blob.refId,
          tenantId,
          state: 'awaiting_four_eyes',
          updatedAtMs,
        });
      }
    }
  } catch {
    // Blob store unavailable — leave brainCases empty.
  }

  // ── Asana side: list tasks from the tenant's compliance project ──
  const asanaTasks: AsanaTaskSnapshot[] = [];
  let asanaTasksScanned = 0;
  let asanaTasksMatched = 0;
  let asanaProjectGid: string | null = null;
  let fallbackReason: string | undefined;

  const customer = COMPANY_REGISTRY.find((c) => c.id === tenantId);
  if (customer) {
    const resolved = resolveTenantProject(tenantId, 'compliance', {
      registryEntry: {
        tenantId: customer.id,
        name: customer.legalName,
        compliance: customer.asanaComplianceProjectGid ?? '',
        workflow: customer.asanaWorkflowProjectGid ?? '',
      },
    });
    if (resolved.ok) {
      asanaProjectGid = resolved.projectGid;
      try {
        const tasksResult = await listProjectTasks(asanaProjectGid);
        if (tasksResult.ok && tasksResult.tasks) {
          const knownCaseIds = new Set(brainCases.map((c) => c.caseId));
          for (const task of tasksResult.tasks) {
            asanaTasksScanned++;
            // Heuristic match: find a known caseId substring in the
            // task name. Future PR can use a dedicated custom-field
            // read once the dispatcher writes it.
            let matchedCaseId: string | null = null;
            for (const caseId of knownCaseIds) {
              if (task.name?.includes(caseId)) {
                matchedCaseId = caseId;
                break;
              }
            }
            if (!matchedCaseId) continue;
            asanaTasksMatched++;
            asanaTasks.push({
              taskGid: task.gid,
              caseId: matchedCaseId,
              tenantId,
              state: task.completed ? 'completed' : 'open',
              updatedAtMs: Date.now(),
            });
          }
        } else {
          fallbackReason = `listProjectTasks_failed: ${tasksResult.error ?? 'unknown'}`;
        }
      } catch (err) {
        fallbackReason = `listProjectTasks_threw: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      fallbackReason = `resolver_failed: ${resolved.reason}`;
    }
  } else {
    fallbackReason = 'tenant_not_in_company_registry';
  }

  return {
    brainCases,
    asanaTasks,
    diagnostics: {
      plansScanned,
      plansForTenant,
      asanaTasksScanned,
      asanaTasksMatched,
      asanaProjectGid,
      fallbackReason,
    },
  };
}

export default async (): Promise<Response> => {
  if (cronDisabled()) {
    return Response.json({ ok: true, skipped: 'cron_disabled_via_env' });
  }

  const tickStart = Date.now();
  const tenants = COMPANY_REGISTRY.map((c) => c.id);
  const liveMode = liveReadsEnabled();

  const perTenant: Array<{
    tenantId: string;
    actions: number;
    inAgreement: number;
    tolerated: number;
    actionKinds: string[];
    plansForTenant: number;
    asanaTasksMatched: number;
    asanaProjectGid: string | null;
    fallbackReason?: string;
  }> = [];

  for (const tenantId of tenants) {
    let snapshot;
    try {
      snapshot = await readSnapshotsForTenant(tenantId);
    } catch (err) {
      await writeAudit({
        event: 'asana_reconcile_snapshot_read_failed',
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const result = reconcileTenant(tenantId, snapshot.brainCases, snapshot.asanaTasks, {
      nowMs: Date.now(),
    });

    const actionKinds = [...new Set(result.actions.map((a) => a.kind))].sort();
    perTenant.push({
      tenantId,
      actions: result.actions.length,
      inAgreement: result.inAgreement.length,
      tolerated: result.tolerated.length,
      actionKinds,
      plansForTenant: snapshot.diagnostics.plansForTenant,
      asanaTasksMatched: snapshot.diagnostics.asanaTasksMatched,
      asanaProjectGid: snapshot.diagnostics.asanaProjectGid,
      fallbackReason: snapshot.diagnostics.fallbackReason,
    });
  }

  await writeAudit({
    event: 'asana_reconcile_cron_tick',
    tenantsProcessed: tenants.length,
    totalActions: perTenant.reduce((a, b) => a + b.actions, 0),
    durationMs: Date.now() - tickStart,
    perTenant,
    liveMode,
    note: liveMode
      ? 'Live reads enabled. Brain side derived from asana-plans blob (state defaults to awaiting_four_eyes). Asana side via listProjectTasks with heuristic case-id match by name.'
      : 'Snapshot reads scaffolded (empty). Set ASANA_RECONCILE_LIVE_READS_ENABLED=1 to opt in once the match-quality numbers in perTenant are reviewed.',
  });

  return Response.json({
    ok: true,
    tenantsProcessed: tenants.length,
    perTenant,
  });
};

export const config: Config = {
  // Every 5 minutes. The Phase 19 spec calls for a 5-min cadence
  // matching the 10-min tolerance window of the reconciler.
  schedule: '*/5 * * * *',
};
