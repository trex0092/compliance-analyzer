/**
 * Morning Briefing Asana Dispatch — callable HTTP endpoint.
 *
 * POST /api/morning-briefing-dispatch
 *
 * Reads today's morning-briefing report from the blob store
 * (written by morning-briefing-cron on its 04:00 UTC schedule) and
 * dispatches the result to Asana:
 *
 *   ok === true  → TWO mirrored tasks:
 *     Task A  "Morning Briefing · YYYY-MM-DD"
 *             in ASANA_CENTRAL_MLRO_PROJECT_GID
 *             assignee: MLRO, due today, tags: morning-briefing, daily-digest
 *             body: briefing markdown + regulatory footer
 *     Task B  "ARCHIVE · Morning Briefing · YYYY-MM-DD"
 *             in ASANA_AUDIT_LOG_PROJECT_GID
 *             tags: archive, retention-10yr
 *             body: same as Task A
 *
 *   ok !== true (or report missing) → ONE failure task:
 *     "Morning Briefing FAILED — YYYY-MM-DD"
 *             in ASANA_CENTRAL_MLRO_PROJECT_GID
 *             assignee: MLRO, due today, tags: routine-failure
 *
 * Response: { ok, date, tasksCreated, taskA?, taskB?, failureTask?, error? }
 *
 * Auth & rate-limit:
 *   Authenticated via the shared bearer-token middleware.
 *   Rate-limited to 10 req / 15 min per IP (sensitive operation).
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20 (CO daily oversight obligations)
 *   FDL No.10/2025 Art.24 (10-year record retention)
 *   Cabinet Res 134/2025 Art.19 (internal reporting cadence)
 *   FDL Art.29 (no tipping off — tasks created in internal projects only)
 */

import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import { createAsanaTask, resolveAsanaUserByName, isAsanaConfigured } from '../../src/services/asanaClient';

const REPORT_STORE = 'morning-briefing-reports';

const REGULATORY_FOOTER = `
---
REGULATORY BASIS: FDL No.10/2025 Art.20 (CO oversight), Art.24 (retention),
Cabinet Res 134/2025 Art.19 (internal reporting).
NO TIPPING OFF (FDL Art.29). Retained 10 years.`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://hawkeye-sterling-v2.netlify.app',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
  Vary: 'Origin',
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

/** ISO date for today in UAE timezone (UTC+4). */
function todayUAE(): string {
  const now = new Date();
  // UTC+4 offset: add 4 hours then take the date portion.
  const uae = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  return uae.toISOString().slice(0, 10);
}

interface BriefingBlob {
  ok?: boolean;
  generatedAt?: string;
  markdown?: string;
  error?: string;
}

async function readTodayReport(dateIso: string): Promise<BriefingBlob | null> {
  try {
    const store = getStore(REPORT_STORE);
    const data = await store.get(`${dateIso}/report.json`, { type: 'json' }) as BriefingBlob | null;
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the MLRO user GID from env vars.
 * Returns undefined (unassigned task) when workspace or name not configured.
 */
async function resolveMlroGid(): Promise<string | undefined> {
  const workspaceGid = process.env.ASANA_WORKSPACE_GID;
  const assigneeName = process.env.ASANA_DEFAULT_ASSIGNEE_NAME;
  if (!workspaceGid || !assigneeName) return undefined;
  const result = await resolveAsanaUserByName(workspaceGid, assigneeName);
  return result.ok && result.user ? result.user.gid : undefined;
}

export default async (req: Request, context: Context): Promise<Response> => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  // Rate limit: 10 req / 15 min (sensitive endpoint per CLAUDE.md §1)
  const rlResponse = await checkRateLimit(req, {
    windowMs: 15 * 60 * 1000,
    max: 10,
    clientIp: context.ip,
    namespace: 'morning-briefing-dispatch',
  });
  if (rlResponse) return rlResponse;

  // Authenticate
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response!;

  // Require Asana to be configured before attempting any task creation.
  if (!isAsanaConfigured()) {
    return jsonResponse({ ok: false, error: 'Asana not configured (missing token)' }, { status: 503 });
  }

  const mlroProject = process.env.ASANA_CENTRAL_MLRO_PROJECT_GID;
  const auditProject = process.env.ASANA_AUDIT_LOG_PROJECT_GID;

  if (!mlroProject) {
    return jsonResponse(
      { ok: false, error: 'ASANA_CENTRAL_MLRO_PROJECT_GID not configured' },
      { status: 503 }
    );
  }

  const dateIso = todayUAE();
  const report = await readTodayReport(dateIso);

  // Treat a missing report, a failed report, or ok !== true as a failure.
  const briefingOk = report !== null && report.ok === true;

  const [mlroGid] = await Promise.all([resolveMlroGid()]);

  if (!briefingOk) {
    // ONE failure task in MLRO Central.
    const failureTitle = `Morning Briefing FAILED — ${dateIso}`;
    const failureNotes = [
      `Morning briefing cron did not produce a successful report for ${dateIso}.`,
      report?.error ? `Error: ${report.error}` : 'Report was missing or marked ok:false.',
      '',
      'Tags: routine-failure',
      REGULATORY_FOOTER,
    ].join('\n');

    const taskResult = await createAsanaTask({
      name: failureTitle,
      notes: failureNotes,
      projects: [mlroProject],
      ...(mlroGid ? { assignee: mlroGid } : {}),
      due_on: dateIso,
      tags: ['routine-failure'],
    });

    return jsonResponse({
      ok: taskResult.ok,
      date: dateIso,
      tasksCreated: taskResult.ok ? 1 : 0,
      failureTask: taskResult.ok ? { gid: taskResult.gid, title: failureTitle } : undefined,
      error: taskResult.ok ? undefined : taskResult.error,
    }, { status: taskResult.ok ? 200 : 502 });
  }

  // ok === true — create TWO mirrored tasks.
  const title = `Morning Briefing · ${dateIso}`;
  const archiveTitle = `ARCHIVE · Morning Briefing · ${dateIso}`;

  const taskBody = [
    report.markdown ?? '(no markdown in report)',
    REGULATORY_FOOTER,
  ].join('\n');

  const taskANotes = [
    'Due: today by 10:00 GST',
    'Tags: morning-briefing, daily-digest',
    '',
    taskBody,
  ].join('\n');

  const taskBNotes = [
    'Tags: archive, retention-10yr',
    '',
    taskBody,
  ].join('\n');

  const taskA = await createAsanaTask({
    name: title,
    notes: taskANotes,
    projects: [mlroProject],
    ...(mlroGid ? { assignee: mlroGid } : {}),
    due_on: dateIso,
    tags: ['morning-briefing', 'daily-digest'],
  });

  type TaskBResult =
    | { ok: true; gid?: string; skipped?: string }
    | { ok: false; error?: string };

  let taskB: TaskBResult;
  if (auditProject) {
    const res = await createAsanaTask({
      name: archiveTitle,
      notes: taskBNotes,
      projects: [auditProject],
      due_on: dateIso,
      tags: ['archive', 'retention-10yr'],
    });
    taskB = res;
  } else {
    taskB = { ok: true, skipped: 'no-audit-project-gid' };
  }

  const allOk = taskA.ok && taskB.ok;

  return jsonResponse({
    ok: allOk,
    date: dateIso,
    tasksCreated: (taskA.ok ? 1 : 0) + (taskB.ok && !taskB.skipped ? 1 : 0),
    taskA: taskA.ok ? { gid: taskA.gid, title } : undefined,
    taskB: taskB.ok
      ? { gid: taskB.ok && 'gid' in taskB ? taskB.gid : undefined, title: archiveTitle, skipped: taskB.skipped }
      : undefined,
    errors: [
      !taskA.ok ? `Task A: ${(taskA as { error?: string }).error}` : null,
      !taskB.ok ? `Task B: ${(taskB as { error?: string }).error}` : null,
    ].filter(Boolean),
  }, { status: allOk ? 200 : 502 });
};
