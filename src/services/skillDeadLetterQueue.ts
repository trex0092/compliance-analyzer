/**
 * Skill Dead-Letter Queue — Tier C4.
 *
 * Tracks skill job retry attempts and moves them to a dead-
 * letter queue after 5 consecutive failures. The handler cron
 * consults this module to decide whether to post a "this
 * command failed permanently" reply and stop retrying.
 *
 * Pure state machine over a localStorage-backed attempt map.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (audit trail on permanent failures)
 *   - Cabinet Res 134/2025 Art.19 (operational telemetry)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeadLetterEntry {
  jobId: string;
  firstAttemptIso: string;
  lastAttemptIso: string;
  attempts: number;
  lastError: string;
  movedAtIso?: string;
}

const ATTEMPTS_KEY = 'fgl_skill_attempts';
const DEAD_KEY = 'fgl_skill_deadletter';
const MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface AttemptMap {
  [jobId: string]: { attempts: number; firstAt: string; lastAt: string; lastError: string };
}

function readAttempts(): AttemptMap {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(ATTEMPTS_KEY);
    return raw ? (JSON.parse(raw) as AttemptMap) : {};
  } catch {
    return {};
  }
}

function writeAttempts(map: AttemptMap): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(map));
  } catch {
    /* storage quota */
  }
}

function readDead(): DeadLetterEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(DEAD_KEY);
    return raw ? (JSON.parse(raw) as DeadLetterEntry[]) : [];
  } catch {
    return [];
  }
}

function writeDead(entries: readonly DeadLetterEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(DEAD_KEY, JSON.stringify(entries.slice(0, 200)));
  } catch {
    /* storage quota */
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export interface RecordAttemptResult {
  shouldRetry: boolean;
  attempts: number;
  movedToDeadLetter: boolean;
  entry?: DeadLetterEntry;
}

export function recordAttempt(
  jobId: string,
  error: string,
  atIso: string = new Date().toISOString()
): RecordAttemptResult {
  const map = readAttempts();
  const existing = map[jobId] ?? {
    attempts: 0,
    firstAt: atIso,
    lastAt: atIso,
    lastError: '',
  };
  existing.attempts += 1;
  existing.lastAt = atIso;
  existing.lastError = error;
  map[jobId] = existing;
  writeAttempts(map);

  if (existing.attempts >= MAX_ATTEMPTS) {
    const entry: DeadLetterEntry = {
      jobId,
      firstAttemptIso: existing.firstAt,
      lastAttemptIso: existing.lastAt,
      attempts: existing.attempts,
      lastError: existing.lastError,
      movedAtIso: atIso,
    };
    const dead = readDead();
    if (!dead.find((d) => d.jobId === jobId)) {
      dead.unshift(entry);
      writeDead(dead);
    }
    // Remove from the active attempts map
    delete map[jobId];
    writeAttempts(map);
    return {
      shouldRetry: false,
      attempts: existing.attempts,
      movedToDeadLetter: true,
      entry,
    };
  }

  return {
    shouldRetry: true,
    attempts: existing.attempts,
    movedToDeadLetter: false,
  };
}

export function recordSuccess(jobId: string): void {
  const map = readAttempts();
  if (map[jobId]) {
    delete map[jobId];
    writeAttempts(map);
  }
}

export function readDeadLetter(): DeadLetterEntry[] {
  return readDead();
}

export function clearDeadLetter(): void {
  writeDead([]);
  writeAttempts({});
}

export function getAttemptCount(jobId: string): number {
  return readAttempts()[jobId]?.attempts ?? 0;
}
