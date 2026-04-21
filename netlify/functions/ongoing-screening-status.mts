/**
 * Ongoing Screening Status — read-only status endpoint powering the
 * in-app status banner (PR-3).
 *
 * GET /api/ongoing-screening-status
 *   → {
 *       ok: true,
 *       timestamp: "2026-04-21T...",
 *       schedule: "0 8 * * *",
 *       nextRunAt: "2026-04-22T08:00:00.000Z",
 *       lastRun: null | {
 *         ranAt: "2026-04-21T08:00:00.123Z",
 *         routineId: "ongoing-screening-daily",
 *         note: "No anomalies detected this run.",
 *         projectGid: "1201234567890123" | null
 *       },
 *       routinesProjectGid: "1201234567890123" | null,
 *       routinesProjectUrl: "https://app.asana.com/0/1201234567890123" | null
 *     }
 *
 * Why this exists: the MLRO opening the screening command needs to
 * know — at a glance — that the daily ongoing-screening cron
 * actually ran, when, and where to go to see the output. Without
 * this, the "subjects are being re-screened" claim is invisible
 * until someone clicks into Asana to check. That is the FDL
 * Art.20-21 "situational awareness" failure mode we are preventing.
 *
 * Security design:
 *   - No auth required. Returns only metadata already visible to
 *     anyone who opens the MLRO UI (the routines Asana project GID
 *     is already exposed in the app bundle via /api/env-check, and
 *     lastRun timestamp / note is non-sensitive).
 *   - Rate limited (30 req / IP / minute) — the banner auto-refreshes,
 *     so it polls; the limit keeps this from being abused as a
 *     generic availability probe.
 *   - Never returns subject identities, hit details, or any data
 *     about WHOM has been screened. Absence of those is part of
 *     FDL Art.29 "no tipping off" — even the existence of an
 *     ongoing-screening programme on a named subject must not leak.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 — CO situational awareness.
 *     The banner surfaces whether the daily routine fired, which is
 *     the evidence the CO needs that ongoing monitoring is live.
 *   - FDL No.10/2025 Art.24 — 10-yr audit retention.
 *     This endpoint reads (never writes) the ongoing-screening-audit
 *     blob store; the write-side is routineRunner.
 *   - FATF Rec 10 — ongoing CDD.
 *     Exposing the "last run" date to the CO is table-stakes evidence
 *     of the ongoing CDD control being active.
 *   - FDL No.10/2025 Art.29 — no tipping off.
 *     This endpoint deliberately does NOT expose subject counts,
 *     subject IDs, or per-subject delta details.
 */
import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { resolveAsanaProjectGid } from '../../src/services/asanaModuleProjects';

const AUDIT_STORE = 'ongoing-screening-audit';
const ROUTINE_ID = 'ongoing-screening-daily';
// Mirrored from ongoing-screening-daily-cron.mts `schedule` field. Keep in sync.
const SCHEDULE_CRON = '0 8 * * *';
const SCHEDULE_HOUR_UTC = 8;
const SCHEDULE_MIN_UTC = 0;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

interface AuditEntry {
  routineId?: string;
  recordedAt?: string;
  note?: string;
  projectGid?: string | null;
}

interface LastRun {
  ranAt: string;
  routineId: string;
  note: string;
  projectGid: string | null;
}

function computeNextRunAt(now: Date): string {
  // Next 08:00 UTC after `now`. If `now` is before today's 08:00 UTC,
  // use today; else tomorrow.
  const candidate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      SCHEDULE_HOUR_UTC,
      SCHEDULE_MIN_UTC,
      0,
      0,
    ),
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.toISOString();
}

async function listAuditKeys(store: ReturnType<typeof getStore>): Promise<string[]> {
  const out: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iter = (store as any).list({ paginate: true }) as AsyncIterable<{
    blobs?: Array<{ key: string }>;
  }>;
  try {
    for await (const page of iter) {
      for (const b of page.blobs ?? []) out.push(b.key);
    }
  } catch {
    // Older blob client may not support paginate iterator — fall back to single call.
    try {
      const single = (await (
        store as unknown as {
          list: () => Promise<{ blobs: Array<{ key: string }> }>;
        }
      ).list()) as { blobs: Array<{ key: string }> };
      for (const b of single.blobs ?? []) out.push(b.key);
    } catch {
      return [];
    }
  }
  return out;
}

async function findLatestRun(): Promise<LastRun | null> {
  let store: ReturnType<typeof getStore>;
  try {
    store = getStore(AUDIT_STORE);
  } catch {
    return null;
  }
  const keys = await listAuditKeys(store);
  if (keys.length === 0) return null;
  // Keys are `YYYY-MM-DD/<epochMs>.json` (see src/services/routineRunner.ts)
  // so a lex sort is already chronological. Fall back to recordedAt when
  // a record's key doesn't match the expected shape.
  keys.sort();
  const newest = keys[keys.length - 1];
  const payload = (await store.get(newest, { type: 'json' })) as AuditEntry | null;
  if (!payload || typeof payload !== 'object') return null;
  return {
    ranAt:
      typeof payload.recordedAt === 'string' && payload.recordedAt.length > 0
        ? payload.recordedAt
        : new Date().toISOString(),
    routineId: typeof payload.routineId === 'string' ? payload.routineId : ROUTINE_ID,
    note: typeof payload.note === 'string' ? payload.note : '',
    projectGid:
      typeof payload.projectGid === 'string' && payload.projectGid.length > 0
        ? payload.projectGid
        : null,
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET') {
    return Response.json(
      { ok: false, error: 'Method not allowed.' },
      { status: 405, headers: CORS_HEADERS },
    );
  }

  const rl = await checkRateLimit(req, {
    max: 30,
    windowMs: 60_000,
    clientIp: context.ip,
    namespace: 'ongoing-screening-status',
  });
  if (rl) return rl;

  const now = new Date();
  const lastRun = await findLatestRun();
  const routinesProjectGid = resolveAsanaProjectGid('routines');
  const routinesProjectUrl = routinesProjectGid
    ? `https://app.asana.com/0/${routinesProjectGid}`
    : null;

  return Response.json(
    {
      ok: true,
      timestamp: now.toISOString(),
      schedule: SCHEDULE_CRON,
      nextRunAt: computeNextRunAt(now),
      lastRun,
      routinesProjectGid,
      routinesProjectUrl,
    },
    { headers: CORS_HEADERS },
  );
};

export const config: Config = {
  method: ['GET', 'OPTIONS'],
};

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

export const __test__ = {
  computeNextRunAt,
};
