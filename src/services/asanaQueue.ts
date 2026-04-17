/**
 * Persistent retry queue for failed Asana operations.
 * Stores failed tasks in localStorage and retries them with backoff.
 */

import { createAsanaTask, isAsanaConfigured, type AsanaTaskPayload } from './asanaClient';
import { tryAcquire, type TenantBucketState } from './asanaPerTenantRateLimit';

const QUEUE_KEY = 'asana_retry_queue';
const MAX_QUEUE_SIZE = 50;
const MAX_RETRY_ATTEMPTS = 5;

// ─── Phase 19 W-A wiring — per-tenant rate limit ────────────────────────────
//
// Before every createAsanaTask call, the retry queue checks a
// tenant-keyed token bucket (see asanaPerTenantRateLimit.ts). If the
// tenant has no tokens, the call is deferred to the next drain pass
// and the rejection is logged for MLRO observability. This prevents
// one tenant's burst from consuming the workspace-level rate budget
// and 429-ing every other tenant.
//
// The bucket state is process-local (in-memory Map). Netlify functions
// are short-lived, so bucket state effectively resets on cold start,
// but the refill rate is continuous — a cold start with a new bucket
// starts at full burst, which is correct behaviour for a first-hit
// dispatch.
//
// Escape hatch: ASANA_RATE_LIMIT_DISABLED=1 disables the check. The
// call proceeds without consulting the bucket. Default is ENABLED.
//
// tenantId resolution: QueueEntry carries an optional customerId
// which maps to the tenant at the business layer. If neither is set
// we fall back to 'default' so the bucket still applies (conservatively).

const BUCKET_STATE: Map<string, TenantBucketState> = new Map();

function rateLimitDisabled(): boolean {
  const raw = typeof process !== 'undefined' ? process.env?.ASANA_RATE_LIMIT_DISABLED : undefined;
  if (!raw) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function tenantIdFor(entry: QueueEntry): string {
  // Prefer customerId when present; otherwise use 'default' so one
  // bucket applies to every un-tenanted dispatch.
  return entry.customerId && entry.customerId.length > 0 ? entry.customerId : 'default';
}

export interface QueueEntry {
  id: string;
  payload: AsanaTaskPayload;
  kind: string;
  ruleId?: string;
  attempts: number;
  lastError: string;
  createdAt: string;
  lastAttemptAt?: string;
  /**
   * Optional tenant / customer identifier. When present it is used as
   * the rate-limit bucket key so one tenant's burst cannot starve
   * other tenants. When absent the bucket keyed on 'default' is used.
   */
  customerId?: string;
}

function readQueue(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(entries: QueueEntry[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(entries.slice(0, MAX_QUEUE_SIZE)));
  } catch {
    console.error('Failed to persist Asana retry queue');
  }
}

export function enqueueRetry(
  payload: AsanaTaskPayload,
  kind: string,
  error: string,
  ruleId?: string
): void {
  const queue = readQueue();
  // Deduplicate by task name + project
  const exists = queue.some(
    (e) =>
      e.payload.name === payload.name &&
      (e.payload.projects?.[0] ?? '') === (payload.projects?.[0] ?? '')
  );
  if (exists) return;

  const entry: QueueEntry = {
    id: `retry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    payload,
    kind,
    ruleId,
    attempts: 0,
    lastError: error,
    createdAt: new Date().toISOString(),
  };

  queue.push(entry);
  writeQueue(queue);
}

export function getQueueStatus(): { pending: number; failed: number } {
  const queue = readQueue();
  const pending = queue.filter((e) => e.attempts < MAX_RETRY_ATTEMPTS).length;
  const failed = queue.filter((e) => e.attempts >= MAX_RETRY_ATTEMPTS).length;
  return { pending, failed };
}

export function clearQueue(): void {
  writeQueue([]);
}

export async function processRetryQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  if (!isAsanaConfigured()) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const queue = readQueue();
  const retryable = queue.filter((e) => e.attempts < MAX_RETRY_ATTEMPTS);

  let succeeded = 0;
  let failed = 0;
  const remaining: QueueEntry[] = [];

  for (const entry of retryable) {
    // Per-tenant rate limit gate. When enabled (default), a bucket
    // rejection defers the entry to the next drain pass — the entry
    // is NOT marked as an attempt and NOT counted as failed, so the
    // retry budget is preserved. A warning is logged once per
    // rate-limited dispatch so the MLRO dashboard can surface
    // throttling without inferring it from 429 noise.
    if (!rateLimitDisabled()) {
      const bucketResult = tryAcquire(tenantIdFor(entry), BUCKET_STATE, Date.now());
      if (!bucketResult.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[asanaQueue] rate-limited tenant=${bucketResult.tenantId} ` +
            `retryAfterMs=${bucketResult.retryAfterMs} ` +
            `tokensAvailable=${bucketResult.tokensAvailable.toFixed(2)} ` +
            `entryId=${entry.id}`
        );
        remaining.push(entry);
        continue;
      }
    }

    entry.attempts++;
    entry.lastAttemptAt = new Date().toISOString();

    const result = await createAsanaTask(entry.payload);

    if (result.ok) {
      succeeded++;
      // Don't keep successful entries
    } else {
      entry.lastError = result.error ?? 'Unknown error';
      remaining.push(entry);
      failed++;
    }
  }

  // Keep entries that exceeded max retries (for visibility) + remaining
  const exhausted = queue.filter((e) => e.attempts >= MAX_RETRY_ATTEMPTS);
  writeQueue([...exhausted, ...remaining]);

  return { processed: retryable.length, succeeded, failed };
}
