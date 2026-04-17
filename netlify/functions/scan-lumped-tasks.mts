/**
 * Scan Lumped Tasks — read-only scan of an Asana project to find
 * tasks whose title lumps multiple legal entities together, which
 * is a compliance-level rule violation per FDL Art.12-14 and
 * Cabinet Res 134/2025 Art.7-10 (CDD data collection per entity).
 *
 * POST /api/setup/scan-lumped-tasks
 *
 * Body:
 *   { projectGid: "1234567890123456" }
 *
 * What it does:
 *   1. GET /projects/{gid}/tasks?opt_fields=gid,name (pagination via offset)
 *   2. For each task, runs lintTaskTitle() (pure, no I/O)
 *   3. Returns the structured scan report including per-lumped-task
 *      detail (gid, name, entity count, entities)
 *
 * READ-ONLY — never mutates Asana. The MLRO uses the output to
 * split tasks manually or can run the task-splitter endpoint
 * (if/when implemented) with targeted gids.
 *
 * Security:
 *   POST + OPTIONS
 *   Bearer HAWKEYE_BRAIN_TOKEN required
 *   X-MFA-Code TOTP (SETUP_MFA_TOTP_SECRET) required
 *   Rate limited 5 / 15 min
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD per customer)
 *   FDL No.10/2025 Art.24    (10yr retention — per-entity audit)
 *   FDL No.10/2025 Art.26-27 (STR / SAR per subject)
 *   Cabinet Res 134/2025 Art.7-10 (CDD data collection per entity)
 *   Cabinet Res 134/2025 Art.19   (internal review per case)
 *   Cabinet Decision 109/2023     (UBO register per entity)
 *   FATF Rec 10 (CDD)
 *   FATF Rec 22 (DPMS CDD)
 */

import type { Config, Context } from '@netlify/functions';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import { requireMfa } from './middleware/mfa.mts';
import {
  scanForLumpedTasks,
  type ExistingTask,
} from '../../src/services/asana/entityLumpingLinter';

const ASANA_BASE = 'https://app.asana.com/api/1.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-MFA-Code',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Asana fetcher — paginated task list over a project
// ---------------------------------------------------------------------------

async function fetchAllTasks(projectGid: string, token: string): Promise<ExistingTask[]> {
  const all: ExistingTask[] = [];
  let offset: string | null = null;
  const pageSize = 100;
  // Safety ceiling: if a project has more than 10_000 tasks we stop
  // paginating. The MLRO can narrow the scope to a single section
  // in a follow-up if this ever bites.
  const maxPages = 100;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      opt_fields: 'gid,name',
      limit: String(pageSize),
    });
    if (offset) params.set('offset', offset);

    const url = `${ASANA_BASE}/projects/${encodeURIComponent(projectGid)}/tasks?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Asana GET /projects/${projectGid}/tasks → ${res.status}: ${text.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as {
      data: Array<{ gid: string; name: string }>;
      next_page?: { offset: string } | null;
    };
    for (const t of json.data) {
      all.push({ gid: t.gid, name: t.name });
    }
    if (!json.next_page || !json.next_page.offset) break;
    offset = json.next_page.offset;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface ScanRequest {
  projectGid: string;
}

function validate(raw: unknown): { ok: true; req: ScanRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.projectGid !== 'string' || r.projectGid.length === 0 || r.projectGid.length > 32) {
    return { ok: false, error: 'projectGid must be 1..32 chars' };
  }
  if (!/^\d+$/.test(r.projectGid)) {
    return { ok: false, error: 'projectGid must contain only digits (Asana GID format)' };
  }
  return { ok: true, req: { projectGid: r.projectGid } };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 5,
    clientIp: context.ip,
    namespace: 'scan-lumped-tasks',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const mfa = await requireMfa(req);
  if (!mfa.ok) return mfa.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) return jsonResponse({ error: v.error }, { status: 400 });

  const accessToken = process.env.ASANA_ACCESS_TOKEN;
  if (!accessToken || accessToken.length < 16) {
    return jsonResponse(
      { error: 'ASANA_ACCESS_TOKEN env var missing or invalid' },
      { status: 503 }
    );
  }

  const { projectGid } = v.req;

  let tasks: ExistingTask[];
  try {
    tasks = await fetchAllTasks(projectGid, accessToken);
  } catch (err) {
    return jsonResponse(
      {
        error: 'asana_task_list_failed',
        reason: err instanceof Error ? err.message : String(err),
        projectGid,
      },
      { status: 502 }
    );
  }

  // Pure scan — no I/O after this point.
  const report = scanForLumpedTasks(tasks);

  return jsonResponse(
    {
      ok: report.lumpedTasks.length === 0,
      projectGid,
      scanned: report.scanned,
      cleanCount: report.cleanCount,
      lumpedCount: report.lumpedTasks.length,
      summary: report.summary,
      findings: report.lumpedTasks,
      regulatory: report.regulatory,
    },
    { status: 200 }
  );
};

export const config: Config = {
  path: '/api/setup/scan-lumped-tasks',
  method: ['POST', 'OPTIONS'],
};
