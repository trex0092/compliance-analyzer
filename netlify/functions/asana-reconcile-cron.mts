/**
 * Asana ↔ Brain State Reconciler — Phase 19 W-C cron.
 *
 * Schedule: every 5 minutes.
 *
 * The cron enumerates every known tenant and writes an audit row
 * per tick so the MLRO dashboard can surface "when did reconcile
 * last run and on which tenants". For now, the real snapshot
 * integration (brain case store read + Asana task list read per
 * tenant) is a SCAFFOLD — a deliberate decision so the cron itself
 * lands and starts producing audit rows BEFORE the MLRO approves
 * the brain-state and Asana-API read paths.
 *
 * The reconciler compute itself (src/services/asanaBrainStateReconciler.ts,
 * PR #188) is ALREADY wired into the call graph via the
 * /api/asana/reconcile-plan read endpoint (PR #199). This cron
 * exists to SCHEDULE the compute. When the MLRO approves the
 * snapshot read paths, their PR only needs to replace the two
 * placeholder reads inside `readSnapshotsForTenant()` below.
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

const AUDIT_STORE = 'asana-reconcile-audit';

function cronDisabled(): boolean {
  const raw =
    typeof process !== 'undefined' ? process.env?.ASANA_RECONCILE_CRON_DISABLED : undefined;
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
 * Placeholder for the per-tenant snapshot read. The MLRO-approved
 * wiring PR replaces the two assignments below:
 *
 *   const brainCases = await readBrainCases(tenantId);
 *   const asanaTasks = await listAsanaTasksForTenant(tenantId);
 *
 * Until then the cron runs with empty snapshots, which means
 * reconcileTenant returns no actions. The cron still records an
 * audit row per tick per tenant so the scheduled cadence is
 * observable before the read paths land.
 */
async function readSnapshotsForTenant(
  _tenantId: string
): Promise<{ brainCases: BrainCase[]; asanaTasks: AsanaTaskSnapshot[] }> {
  return { brainCases: [], asanaTasks: [] };
}

export default async (): Promise<Response> => {
  if (cronDisabled()) {
    return Response.json({ ok: true, skipped: 'cron_disabled_via_env' });
  }

  const tickStart = Date.now();
  const tenants = COMPANY_REGISTRY.map((c) => c.id);

  const perTenant: Array<{
    tenantId: string;
    actions: number;
    inAgreement: number;
    tolerated: number;
    actionKinds: string[];
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
    });
  }

  await writeAudit({
    event: 'asana_reconcile_cron_tick',
    tenantsProcessed: tenants.length,
    totalActions: perTenant.reduce((a, b) => a + b.actions, 0),
    durationMs: Date.now() - tickStart,
    perTenant,
    note: 'Snapshot reads are currently scaffolded (empty). Action count reflects real reconciliation only once the MLRO-approved wiring PR lands.',
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
