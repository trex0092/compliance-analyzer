/**
 * Regulatory drift detector (cron).
 *
 * Daily job that samples a tenant's current customer-feature
 * distribution, compares it to the stored baseline via
 * `analyseDrift` (PSI + KS), and publishes a drift report. If the
 * overall band is `significant`, the function also writes a
 * `drift_alert` event into the brain-events store so the MLRO
 * dashboard surfaces it on next load.
 *
 * This is the "the risk model calibration may no longer apply" early
 * warning signal. Without it, a slowly drifting customer base can
 * defeat even a well-tuned scorer (e.g. the portfolio silently
 * shifts from corporate to individual walk-in, or mix of jurisdictions
 * changes, without anyone noticing).
 *
 * Regulatory basis:
 *   FATF Rec 1 — risk-based approach must be reviewed regularly
 *   Cabinet Res 134/2025 Art.5 — dynamic risk rating
 *   FDL Art.19 — internal review
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { analyseDrift, type DriftSample, type PortfolioDriftReport } from '../../src/services/regulatoryDrift';

const BASELINE_STORE = 'drift-baseline';
const CURRENT_STORE = 'drift-current';
const REPORT_STORE = 'drift-reports';
const BRAIN_EVENTS_STORE = 'brain-events';
const DRIFT_AUDIT_STORE = 'drift-audit';

/**
 * Load the baseline sample. The baseline is seeded out-of-band (e.g.
 * by a one-shot script that runs at onboarding or after a risk-model
 * recalibration). If no baseline exists, the cron short-circuits with
 * an audit entry — nothing to compare against.
 */
async function loadBaseline(): Promise<DriftSample[] | null> {
  try {
    const store = getStore(BASELINE_STORE);
    const data = (await store.get('baseline.json', { type: 'json' })) as DriftSample[] | null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Load the current sample. Populated by the main application as
 * customers are scored — the cron just reads the latest snapshot.
 */
async function loadCurrent(): Promise<DriftSample[] | null> {
  try {
    const store = getStore(CURRENT_STORE);
    const data = (await store.get('current.json', { type: 'json' })) as DriftSample[] | null;
    return data ?? null;
  } catch {
    return null;
  }
}

async function writeReport(report: PortfolioDriftReport): Promise<void> {
  const store = getStore(REPORT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}.json`, { at: iso, report });
  await store.setJSON('latest.json', { at: iso, report });
}

async function emitAlert(report: PortfolioDriftReport): Promise<void> {
  if (report.overallBand !== 'significant') return;
  const store = getStore(BRAIN_EVENTS_STORE);
  const iso = new Date().toISOString();
  const id = `drift:${Date.now()}`;
  await store.setJSON(`${iso.slice(0, 10)}/${id}.json`, {
    at: iso,
    event: {
      kind: 'system_warning',
      severity: 'high',
      summary: `Significant regulatory drift detected: ${report.driftedFeatureCount} feature(s) above 0.25 PSI. Review risk model calibration (Cabinet Res 134/2025 Art.5).`,
      refId: id,
    },
  });
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(DRIFT_AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    ...payload,
    recordedAt: iso,
  });
}

export default async (): Promise<Response> => {
  const baseline = await loadBaseline();
  const current = await loadCurrent();

  if (!baseline || baseline.length === 0) {
    await writeAudit({ event: 'drift_cron_skipped', reason: 'baseline missing' });
    return Response.json({ ok: true, skipped: 'baseline missing' });
  }
  if (!current || current.length === 0) {
    await writeAudit({ event: 'drift_cron_skipped', reason: 'current sample empty' });
    return Response.json({ ok: true, skipped: 'current sample empty' });
  }

  const report = analyseDrift(baseline, current);
  await writeReport(report);
  await emitAlert(report);
  await writeAudit({
    event: 'drift_cron_success',
    overallBand: report.overallBand,
    driftedFeatureCount: report.driftedFeatureCount,
    overallMaxPsi: report.overallMaxPsi,
  });

  return Response.json({
    ok: true,
    overallBand: report.overallBand,
    driftedFeatureCount: report.driftedFeatureCount,
    overallMaxPsi: report.overallMaxPsi,
    notes: report.notes,
  });
};

export const config: Config = {
  // Daily at 02:00 UTC — runs before CBUAE FX cron so the drift report
  // is always fresh before the morning business day in Asia/Dubai.
  schedule: '0 2 * * *',
};
