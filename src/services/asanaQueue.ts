/**
 * Persistent retry queue for failed Asana operations.
 * Stores failed tasks in localStorage and retries them with backoff.
 */

import { createAsanaTask, isAsanaConfigured, type AsanaTaskPayload } from './asanaClient';

const QUEUE_KEY = 'asana_retry_queue';
const MAX_QUEUE_SIZE = 50;
const MAX_RETRY_ATTEMPTS = 5;

export interface QueueEntry {
  id: string;
  payload: AsanaTaskPayload;
  kind: string;
  ruleId?: string;
  attempts: number;
  lastError: string;
  createdAt: string;
  lastAttemptAt?: string;
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
