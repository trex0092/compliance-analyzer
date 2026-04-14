/**
 * Asana Weekly Customer Status — cron.
 *
 * Tier-4 #12 from the Asana setup gap audit. Posts a weekly Asana
 * "status update" to each customer compliance project so the MLRO
 * + auditors see a 7-day compliance pulse on every customer's
 * project home page (and in any Portfolio that aggregates them).
 *
 * Schedule: Mondays 06:00 UTC = 10:00 Asia/Dubai. Same slot as the
 * existing asana-weekly-digest-cron.mts so the MLRO's Monday inbox
 * has both the global digest and the per-customer breakdown.
 *
 * Per customer, the cron:
 *   1. Lists tasks in the compliance project via /projects/{gid}/tasks
 *      with opt_fields=name,gid,completed,created_at,modified_at,
 *      tags.name,memberships.section.name (one bounded API call).
 *   2. Hands the raw task list to summarizeCustomerWeek (pure).
 *   3. Builds the status_updates payload via buildStatusUpdatePayload.
 *   4. POSTs it to https://app.asana.com/api/1.0/status_updates via
 *      the rate-limited asanaRequestWithRetry helper.
 *   5. Persists the per-customer summary to a blob store for audit.
 *
 * Failure mode contract: a per-customer error never short-circuits
 * the rest of the run — every customer gets attempted independently
 * and the summary records partial failures.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — weekly visibility)
 *   - Cabinet Res 134/2025 Art.19 (internal review cadence)
 *   - Cabinet Res 134/2025 Art.5 (risk appetite — colour signal)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const STATUS_AUDIT_STORE = 'asana-weekly-customer-status-audit';

interface CustomerStatusResult {
  customerId: string;
  customerLegalName: string;
  projectGid?: string;
  ok: boolean;
  skipped?: 'no-project-gid' | 'list-tasks-failed' | 'post-status-failed';
  taskCount?: number;
  color?: string;
  error?: string;
  statusUpdateGid?: string;
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore(STATUS_AUDIT_STORE);
    const iso = new Date().toISOString();
    await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
      ...payload,
      recordedAt: iso,
    });
  } catch {
    /* audit write best-effort */
  }
}

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const apiToken = process.env.ASANA_TOKEN;

  if (!apiToken) {
    await writeAudit({
      event: 'asana_weekly_customer_status_skipped',
      reason: 'ASANA_TOKEN not configured',
    });
    return Response.json({ ok: true, skipped: 'ASANA_TOKEN missing' });
  }

  // Dynamic imports — keep cron cold-start fast and avoid pulling
  // the whole React surface into the function bundle.
  const { COMPANY_REGISTRY } = await import('../../src/domain/customers');
  const { asanaRequestWithRetry } = await import('../../src/services/asanaClient');
  const {
    summarizeCustomerWeek,
    buildStatusUpdatePayload,
  } = await import('../../src/services/asanaWeeklyCustomerStatus');

  const windowToIso = startedAt;
  const windowFromIso = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const results: CustomerStatusResult[] = [];

  for (const customer of COMPANY_REGISTRY) {
    const projectGid = customer.asanaComplianceProjectGid;
    if (!projectGid) {
      results.push({
        customerId: customer.id,
        customerLegalName: customer.legalName,
        ok: false,
        skipped: 'no-project-gid',
      });
      continue;
    }

    // Fetch the customer's task list with all fields the
    // summarizer needs in one bounded call.
    const optFields =
      'name,gid,completed,created_at,modified_at,tags.name,memberships.section.name';
    const listResult = await asanaRequestWithRetry<
      Array<{
        gid: string;
        name: string;
        completed: boolean;
        created_at?: string;
        modified_at?: string;
        tags?: ReadonlyArray<{ name?: string }>;
        memberships?: ReadonlyArray<{ section?: { name?: string } }>;
      }>
    >(
      `/projects/${encodeURIComponent(projectGid)}/tasks?opt_fields=${optFields}&limit=100`
    );

    if (!listResult.ok || !listResult.data) {
      results.push({
        customerId: customer.id,
        customerLegalName: customer.legalName,
        projectGid,
        ok: false,
        skipped: 'list-tasks-failed',
        error: listResult.error,
      });
      await writeAudit({
        event: 'asana_weekly_customer_status_list_failed',
        customerId: customer.id,
        projectGid,
        error: listResult.error,
      });
      continue;
    }

    const summary = summarizeCustomerWeek({
      customerId: customer.id,
      customerLegalName: customer.legalName,
      windowFromIso,
      windowToIso,
      tasks: listResult.data,
    });

    const payload = buildStatusUpdatePayload(summary, projectGid);

    const postResult = await asanaRequestWithRetry<{ gid?: string }>(
      `/status_updates`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    if (!postResult.ok) {
      results.push({
        customerId: customer.id,
        customerLegalName: customer.legalName,
        projectGid,
        ok: false,
        skipped: 'post-status-failed',
        taskCount: summary.totalTasks,
        color: summary.color,
        error: postResult.error,
      });
      await writeAudit({
        event: 'asana_weekly_customer_status_post_failed',
        customerId: customer.id,
        projectGid,
        color: summary.color,
        error: postResult.error,
      });
      continue;
    }

    results.push({
      customerId: customer.id,
      customerLegalName: customer.legalName,
      projectGid,
      ok: true,
      taskCount: summary.totalTasks,
      color: summary.color,
      statusUpdateGid: postResult.data?.gid,
    });

    await writeAudit({
      event: 'asana_weekly_customer_status_posted',
      customerId: customer.id,
      projectGid,
      color: summary.color,
      taskCount: summary.totalTasks,
      freezeCount: summary.freezeCount,
      escalateCount: summary.escalateCount,
    });
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;

  return Response.json({
    ok: failCount === 0,
    startedAt,
    customersProcessed: results.length,
    okCount,
    failCount,
    results,
  });
};

export const config: Config = {
  // Mondays 06:00 UTC = 10:00 Asia/Dubai. Same cadence as the
  // existing asana-weekly-digest-cron.mts so both reports land in
  // the MLRO inbox at the start of the working week.
  schedule: '0 6 * * 1',
};
