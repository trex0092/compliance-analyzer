/**
 * Asana Retry Queue — W4 (cron).
 *
 * Drains the in-memory + blob-backed Asana retry queue every minute.
 * Failed `createAsanaTask` / attachment / project calls land in the
 * queue (via `enqueueRetry`) and are processed here with exponential
 * backoff.
 *
 * The function is intentionally a thin wrapper around the existing
 * `processRetryQueue` in `src/services/asanaQueue.ts` — all the
 * backoff math + dead-letter handling lives there.
 *
 * Regulatory basis:
 *   FDL Art.24 (record retention — never lose an Asana task that
 *               carries a regulatory deadline)
 *   Cabinet Res 134/2025 Art.19 (auditable workflow)
 */

import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

const QUEUE_AUDIT_STORE = 'asana-queue-audit';

export default async (): Promise<Response> => {
  const startedAt = new Date().toISOString();
  const apiToken = process.env.ASANA_API_TOKEN;
  if (!apiToken) {
    await writeAudit({
      event: 'asana_retry_skipped',
      reason: 'ASANA_API_TOKEN not configured',
    });
    return Response.json({ ok: true, skipped: 'ASANA_API_TOKEN missing' });
  }

  // Dynamic import so the cron doesn't pull asanaQueue at module load
  // time (which would import the full asanaClient surface).
  let processed: { processed: number; ok: number; failed: number; remaining: number };
  try {
    const queueModule = await import('../../src/services/asanaQueue');
    const result = await queueModule.processRetryQueue();
    processed = {
      processed: result.processed,
      ok: result.succeeded,
      failed: result.failed,
      remaining: queueModule.getQueueStatus().pending,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeAudit({
      event: 'asana_retry_failed',
      error: message,
    });
    console.error('[asana-retry-queue-cron] failed:', message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  await writeAudit({
    event: 'asana_retry_run',
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: processed.ok,
    failed: processed.failed,
    remaining: processed.remaining,
  });

  return Response.json({ ok: true, ...processed });
};

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(QUEUE_AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    ...payload,
    recordedAt: iso,
  });
}

export const config: Config = {
  // Every minute. The queue is bounded so this cron never sleeps for
  // long — pending entries are typically <10 per run.
  schedule: '* * * * *',
};
