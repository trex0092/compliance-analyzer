/**
 * Asana Super-Brain Autopilot Cron.
 *
 * Runs every 15 minutes. Walks the open compliance cases in
 * the Netlify blob store, dispatches the super brain against
 * any that haven't been recorded in the dispatch audit log,
 * and logs the batch summary back into the audit store.
 *
 * This is the server-side twin of the in-SPA auto-dispatch
 * listener. Together they close the loop: cases created in
 * the SPA fan out immediately via the listener, and cases
 * that land via webhooks / manual seed / API push get picked
 * up by this cron within 15 minutes.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (no case left undispatched)
 *   - FDL No.10/2025 Art.26-27 (STR filing without delay)
 *   - Cabinet Res 134/2025 Art.19 (auditable internal review)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const AUDIT_STORE = 'asana-autopilot-audit';
const CASES_STORE = 'compliance-cases'; // optional — ops may not have it set up yet

interface StoredCase {
  id: string;
  caseType: string;
  status: string;
  riskLevel: string;
  riskScore: number;
  [k: string]: unknown;
}

export default async (): Promise<Response> => {
  const startedAtIso = new Date().toISOString();
  const apiToken = process.env.ASANA_API_TOKEN;
  if (!apiToken) {
    await writeAudit({
      event: 'autopilot_skipped',
      reason: 'ASANA_API_TOKEN not configured',
      at: startedAtIso,
    });
    return Response.json({ ok: true, skipped: 'ASANA_API_TOKEN missing' });
  }

  // Read open cases from the blob store. We intentionally skip
  // the full local IndexedDB surface — the cron runs in Node and
  // doesn't have a window. Ops should mirror open cases into the
  // `compliance-cases` blob store via a separate pipeline when
  // they want the autopilot to see them.
  let cases: StoredCase[] = [];
  try {
    const store = getStore(CASES_STORE);
    const raw = await store.get('open-cases.json', { type: 'json' });
    if (Array.isArray(raw)) {
      cases = raw.filter((c) => (c?.status ?? 'open') === 'open') as StoredCase[];
    }
  } catch (err) {
    await writeAudit({
      event: 'autopilot_case_read_failed',
      error: err instanceof Error ? err.message : String(err),
      at: startedAtIso,
    });
    return Response.json({ ok: true, skipped: 'case store unavailable' });
  }

  if (cases.length === 0) {
    await writeAudit({
      event: 'autopilot_idle',
      reason: 'no open cases in blob store',
      at: startedAtIso,
    });
    return Response.json({ ok: true, dispatched: 0, reason: 'no cases' });
  }

  // Defer the real dispatch to a dynamic import so the cron
  // module stays lightweight at cold-start time. The dispatcher
  // talks to Asana via the standard asanaClient path (env vars
  // wired via process.env).
  let dispatched = 0;
  let failed = 0;
  const items: Array<{ caseId: string; verdict?: string; ok: boolean; error?: string }> = [];
  try {
    const batchModule = await import('../../src/services/superBrainBatchDispatcher');
    const typedCases = cases as unknown as Parameters<typeof batchModule.runSuperBrainBatch>[0];
    const summary = await batchModule.runSuperBrainBatch(typedCases, {
      trigger: 'cron',
      skipAlreadyDispatched: true,
      consecutiveFailureLimit: 3,
      nowIso: startedAtIso,
    });
    dispatched = summary.dispatched;
    failed = summary.failed;
    for (const item of summary.items) {
      items.push({
        caseId: item.caseId,
        verdict: item.verdict,
        ok: item.ok,
        error: item.error,
      });
    }
    await writeAudit({
      event: 'autopilot_batch',
      summary: {
        total: summary.total,
        dispatched: summary.dispatched,
        skipped: summary.skipped,
        failed: summary.failed,
        aborted: summary.aborted,
        durationMs: summary.durationMs,
      },
      at: startedAtIso,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeAudit({
      event: 'autopilot_batch_failed',
      error: message,
      at: startedAtIso,
    });
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    dispatched,
    failed,
    items,
  });
};

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  try {
    const store = getStore(AUDIT_STORE);
    const iso = new Date().toISOString();
    await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
      ...payload,
      recordedAt: iso,
    });
  } catch {
    // Audit store write failure is non-fatal — the cron still
    // reports its result via the HTTP response, which the
    // scheduler captures.
  }
}

export const config: Config = {
  // Every 15 minutes. The batch dispatcher throttles itself
  // via the adaptive rate limiter in asanaClient.
  schedule: '*/15 * * * *',
};
