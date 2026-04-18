/**
 * Setup KYC / CDD Tracker Sections — idempotent section bootstrap
 * for the tenant-agnostic "KYC / CDD TRACKER — ALL ENTITIES" Asana
 * project, exposed as an HTTP endpoint so operators can do it from
 * the browser-only setup.html wizard (Step 9).
 *
 * POST /api/setup/kyc-cdd-tracker-sections
 *
 * Body:
 *   { projectGid: "1234567890123456" }
 *
 * What it does:
 *   1. Lists existing sections for the project via GET /projects/{gid}/sections
 *   2. For each section, counts tasks via GET /sections/{gid}/tasks?opt_fields=gid&limit=1
 *      (we only need to know if taskCount is 0 or >0, not the full count,
 *      so we stop at limit=1 for cost)
 *   3. Calls diffSections() (pure) to produce the create/keep/delete plan
 *   4. Walks the plan:
 *      - Creates missing canonical sections via POST /projects/{gid}/sections
 *      - Deletes the "Untitled section" placeholder IF empty
 *      - Reports orphans (operator custom sections) WITHOUT touching them
 *   5. Returns the full per-step audit trail + regulatory anchor list
 *
 * Idempotent: safe to re-run. Name-matched sections are reused,
 * never duplicated. Operator custom sections are NEVER deleted.
 *
 * Security:
 *   POST + OPTIONS
 *   Bearer HAWKEYE_BRAIN_TOKEN required
 *   X-MFA-Code TOTP (SETUP_MFA_TOTP_SECRET) required
 *   Rate limited 5 / 15 min (write-heavy endpoint)
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD tier + thresholds)
 *   FDL No.10/2025 Art.20-22 (CO continuous oversight)
 *   FDL No.10/2025 Art.24    (10yr retention — provisioning audit)
 *   FDL No.10/2025 Art.26-27 (STR / SAR section lane)
 *   FDL No.10/2025 Art.29    (tipping-off prohibition — STR lane)
 *   FDL No.10/2025 Art.35    (TFS screening lane)
 *   Cabinet Res 134/2025 Art.7-10 (CDD data collection)
 *   Cabinet Res 134/2025 Art.14   (EDD + PEP senior management + Board)
 *   Cabinet Res 134/2025 Art.19   (internal review + four-eyes)
 *   Cabinet Res 74/2020 Art.4-7   (TFS asset freeze, 24h EOCN)
 *   Cabinet Decision 109/2023     (UBO register, >25% threshold)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import { requireMfa } from './middleware/mfa.mts';
import {
  KYC_CDD_TRACKER_SECTIONS,
  diffSections,
  type ExistingSection,
} from '../../src/services/asana/kycCddTrackerSections';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';

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
// Asana HTTP helpers — thin wrapper over fetch
// ---------------------------------------------------------------------------

async function asanaGet<T>(path: string, token: string): Promise<T> {
  const res = await fetchWithTimeout(ASANA_BASE + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
    timeoutMs: 20_000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Asana GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function asanaPost<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetchWithTimeout(ASANA_BASE + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: 20_000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Asana POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function asanaDelete(path: string, token: string): Promise<void> {
  const res = await fetchWithTimeout(ASANA_BASE + path, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 20_000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Asana DELETE ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface BootstrapRequest {
  projectGid: string;
}

function validate(
  raw: unknown
): { ok: true; req: BootstrapRequest } | { ok: false; error: string } {
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
// Step log — structured audit trail returned in the response
// ---------------------------------------------------------------------------

interface Step {
  op: 'list' | 'count_tasks' | 'diff' | 'create' | 'delete' | 'orphan';
  detail: string;
  ok: boolean;
  gid?: string;
  error?: string;
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
    namespace: 'setup-kyc-cdd-tracker-sections',
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
  const steps: Step[] = [];

  // -------------------------------------------------------------------------
  // Step 1 — list existing sections
  // -------------------------------------------------------------------------
  let rawExisting: Array<{ gid: string; name: string }>;
  try {
    rawExisting = await asanaGet<Array<{ gid: string; name: string }>>(
      `/projects/${encodeURIComponent(projectGid)}/sections?opt_fields=gid,name&limit=100`,
      accessToken
    );
    steps.push({
      op: 'list',
      detail: `Found ${rawExisting.length} existing section(s) in project ${projectGid}`,
      ok: true,
    });
  } catch (err) {
    return jsonResponse(
      {
        error: 'asana_list_sections_failed',
        reason: err instanceof Error ? err.message : String(err),
        projectGid,
      },
      { status: 502 }
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 — count tasks per section (only for the Untitled-section
  // safety check; we stop at limit=1 because we only need to know
  // 0 vs non-zero).
  // -------------------------------------------------------------------------
  const existing: ExistingSection[] = [];
  for (const s of rawExisting) {
    let taskCount = 0;
    try {
      const tasks = await asanaGet<Array<{ gid: string }>>(
        `/sections/${encodeURIComponent(s.gid)}/tasks?opt_fields=gid&limit=1`,
        accessToken
      );
      taskCount = tasks.length;
    } catch (err) {
      // Non-fatal — if we can't count, assume non-empty so we err on
      // the side of NOT deleting the Untitled section.
      taskCount = 1;
      steps.push({
        op: 'count_tasks',
        detail: `Could not count tasks in section "${s.name}" — assuming non-empty for safety`,
        ok: false,
        gid: s.gid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    existing.push({ gid: s.gid, name: s.name, taskCount });
  }

  // -------------------------------------------------------------------------
  // Step 3 — pure diff
  // -------------------------------------------------------------------------
  const diff = diffSections(KYC_CDD_TRACKER_SECTIONS, existing);
  steps.push({
    op: 'diff',
    detail: `Plan: ${diff.toCreate.length} to create, ${diff.toKeep.length} to keep, ${diff.toDelete.length} to delete, ${diff.orphans.length} operator orphan(s) preserved`,
    ok: true,
  });

  // -------------------------------------------------------------------------
  // Step 4 — create missing canonical sections
  // -------------------------------------------------------------------------
  for (const spec of diff.toCreate) {
    try {
      const created = await asanaPost<{ gid: string }>(
        `/projects/${encodeURIComponent(projectGid)}/sections`,
        { data: { name: spec.name } },
        accessToken
      );
      steps.push({
        op: 'create',
        detail: `Created section "${spec.name}" (${spec.regulatoryAnchor})`,
        ok: true,
        gid: created.gid,
      });
    } catch (err) {
      steps.push({
        op: 'create',
        detail: `FAILED to create section "${spec.name}"`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 5 — delete the empty Untitled section placeholder (if any)
  // -------------------------------------------------------------------------
  for (const d of diff.toDelete) {
    try {
      await asanaDelete(`/sections/${encodeURIComponent(d.gid)}`, accessToken);
      steps.push({
        op: 'delete',
        detail: `Deleted "${d.name}" (${d.reason})`,
        ok: true,
        gid: d.gid,
      });
    } catch (err) {
      // Non-fatal — Asana sometimes refuses to delete the last
      // section in a project. Log and continue.
      steps.push({
        op: 'delete',
        detail: `Could not delete "${d.name}" — operator may need to remove manually`,
        ok: false,
        gid: d.gid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Step 6 — report orphans (informational, never mutated)
  // -------------------------------------------------------------------------
  for (const o of diff.orphans) {
    steps.push({
      op: 'orphan',
      detail: `Operator section preserved: "${o.name}" (${o.taskCount} task${o.taskCount === 1 ? '' : 's'})`,
      ok: true,
      gid: o.gid,
    });
  }

  const createFailures = steps.filter((s) => s.op === 'create' && !s.ok).length;
  const overallOk = createFailures === 0;

  // -------------------------------------------------------------------------
  // Audit log — 10-year retention per FDL Art.24
  // -------------------------------------------------------------------------
  try {
    const audit = getStore('setup-audit');
    await audit.setJSON(`kyc-cdd-tracker-sections/${projectGid}/${Date.now()}.json`, {
      tsIso: new Date().toISOString(),
      userId: auth.userId,
      projectGid,
      ok: overallOk,
      created: diff.toCreate.length,
      kept: diff.toKeep.length,
      deleted: diff.toDelete.length,
      orphans: diff.orphans.length,
      createFailures,
    });
  } catch {
    // non-fatal
  }

  return jsonResponse(
    {
      ok: overallOk,
      projectGid,
      summary: overallOk
        ? `KYC/CDD Tracker provisioned: ${diff.toCreate.length} created, ${diff.toKeep.length} kept, ${diff.toDelete.length} deleted, ${diff.orphans.length} orphan(s) preserved.`
        : `KYC/CDD Tracker partially provisioned: ${createFailures} section creation(s) failed. See steps for details.`,
      canonicalSectionCount: KYC_CDD_TRACKER_SECTIONS.length,
      created: diff.toCreate.length,
      kept: diff.toKeep.length,
      deleted: diff.toDelete.length,
      orphans: diff.orphans.length,
      steps,
      regulatory: [
        'FDL No.10/2025 Art.12-14',
        'FDL No.10/2025 Art.20-22',
        'FDL No.10/2025 Art.24',
        'FDL No.10/2025 Art.26-27',
        'FDL No.10/2025 Art.29',
        'FDL No.10/2025 Art.35',
        'Cabinet Res 134/2025 Art.7-10',
        'Cabinet Res 134/2025 Art.14',
        'Cabinet Res 134/2025 Art.19',
        'Cabinet Res 74/2020 Art.4-7',
        'Cabinet Decision 109/2023',
      ],
    },
    { status: overallOk ? 200 : 502 }
  );
};

export const config: Config = {
  path: '/api/setup/kyc-cdd-tracker-sections',
  method: ['POST', 'OPTIONS'],
};
