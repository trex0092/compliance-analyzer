/**
 * Weekly CDD Status Report — cron.
 *
 * Schedule: Mondays 05:00 UTC = 09:00 Asia/Dubai. Feeds the Claude
 * Code "Weekly CDD Status Report" routine that runs at the same time
 * slot. The routine reads the latest blob from this cron to produce
 * the MLRO briefing without re-computing the report itself.
 *
 * The cron is thin by design:
 *   1. Materialise a CustomerProfile view over COMPANY_REGISTRY
 *      (the registry omits beneficialOwners + reviewHistory; we
 *      provide empty arrays because this report does not need them).
 *   2. Derive PeriodicReviewSchedule entries from each customer's
 *      lastCDDReviewDate + risk rating via createReviewSchedule.
 *   3. Pass empty arrays for approvals, filings, and screeningRuns
 *      for the initial release — those stores will be wired in a
 *      follow-up once the persistence layer exists. The generator
 *      already handles empty collections.
 *   4. Build the report and persist both markdown + JSON to the
 *      cdd-weekly-status-reports blob store so the routine (and
 *      auditors) can retrieve it. FDL Art.24 requires 10yr retention,
 *      which the blob store already satisfies.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.12-14, Art.14, Art.24, Art.26-27, Art.29
 *   - Cabinet Res 134/2025 Art.7-14, Art.19
 *   - Cabinet Res 74/2020 Art.6
 *   - MoE Circular 08/AML/2021
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const REPORT_STORE = 'cdd-weekly-status-reports';
const AUDIT_STORE = 'cdd-weekly-status-audit';

interface CronResult {
  ok: boolean;
  startedAt: string;
  customers: number;
  reportKey?: string;
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

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();

  // Dynamic imports keep cold-start small and avoid pulling React
  // into the function bundle.
  const { COMPANY_REGISTRY } = await import('../../src/domain/customers');
  const { createReviewSchedule } = await import(
    '../../src/domain/periodicReview'
  );
  const { buildWeeklyCddReport, renderWeeklyCddReportMarkdown } = await import(
    '../../src/services/cddReportGenerator'
  );

  try {
    const customers = COMPANY_REGISTRY.map((c) => ({
      ...c,
      beneficialOwners: [],
      reviewHistory: [],
    }));

    const reviewSchedules = customers.map((c) =>
      createReviewSchedule(
        c.id,
        c.legalName,
        c.riskRating,
        'cdd-refresh',
        c.lastCDDReviewDate
      )
    );

    const report = buildWeeklyCddReport({
      now: new Date(),
      customers,
      reviewSchedules,
      approvals: [],
      filings: [],
      screeningRuns: [],
    });

    const markdown = renderWeeklyCddReportMarkdown(report);
    const key = `${startedAt.slice(0, 10)}/report.json`;

    const store = getStore(REPORT_STORE);
    await store.setJSON(key, {
      generatedAt: startedAt,
      report,
      markdown,
    });

    await writeAudit({
      event: 'cdd_weekly_status_report_generated',
      reportKey: key,
      tierRollup: report.tierRollup,
      overdueReviewsCount: report.overdueReviews.length,
      pendingApprovalsCount: report.pendingApprovals.length,
      overdueFilingsCount: report.filingSnapshot.overdue.length,
      sanctionsResolvedCount: report.sanctionsResolvedThisWeek.length,
    });

    const result: CronResult = {
      ok: true,
      startedAt,
      customers: customers.length,
      reportKey: key,
    };
    return Response.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await writeAudit({
      event: 'cdd_weekly_status_report_failed',
      error,
    });
    const result: CronResult = {
      ok: false,
      startedAt,
      customers: 0,
      error,
    };
    return Response.json(result, { status: 500 });
  }
};

export const config: Config = {
  // Mondays 05:00 UTC = 09:00 Asia/Dubai.
  schedule: '0 5 * * 1',
};
