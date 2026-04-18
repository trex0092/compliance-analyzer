/**
 * Expiry Scan Cron — daily job that walks every customer profile
 * in the Netlify Blob store, runs the expiry alerter, and produces
 * the Asana task draft list. READ-ONLY for this first cut — the
 * drafts are returned in the response for operator review; a
 * future commit will actually dispatch them to Asana once the
 * operator confirms the routing is right.
 *
 * POST /api/expiry-scan   (manual / setup.html button)
 *
 * Scheduled: the same handler is exposed as a daily Netlify
 * scheduled function via `config.schedule = '0 5 * * *'`
 * (05:00 UTC = 09:00 Dubai time — before Luisa starts work).
 *
 * Why it's read-only (by default):
 *   The first run of a new alerter should always be dry-run so the
 *   operator can sanity-check the routing before tasks start landing
 *   in Asana en masse. Pass `{ dispatch: true }` in the body to
 *   actually emit tasks. The dry-run path still writes an audit
 *   record to Netlify Blobs under `expiry-scan-audit/`.
 *
 * Security:
 *   POST + OPTIONS
 *   Bearer HAWKEYE_BRAIN_TOKEN
 *   Rate limited 10 / 15 min
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO oversight)
 *   FDL No.10/2025 Art.24    (10yr retention — expiring records
 *                              trigger refresh, not deletion)
 *   Cabinet Res 134/2025 Art.19 (periodic review cadence)
 *   Cabinet Decision 109/2023 (UBO re-verification)
 *   MoE Circular 08/AML/2021 (DPMS licence validity)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import type { CustomerProfileV2 } from '../../src/domain/customerProfile';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';
import { scanExpiries, type ExpiryReport } from '../../src/services/customerExpiryAlerter';
import {
  buildExpiryEmitReport,
  type ExpiryEmitReport,
} from '../../src/services/expiryAsanaEmitter';

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

// ---------------------------------------------------------------------------
// Blob-store loader for customer profiles
// ---------------------------------------------------------------------------

async function loadAllProfiles(): Promise<readonly CustomerProfileV2[]> {
  const store = getStore('customer-profiles');
  const listed = await store.list({ prefix: 'profile/' });
  const profiles: CustomerProfileV2[] = [];
  for (const entry of listed.blobs) {
    try {
      const raw = (await store.get(entry.key, { type: 'json' })) as CustomerProfileV2 | null;
      if (raw && raw.schemaVersion === 2) profiles.push(raw);
    } catch {
      // skip corrupt entries — they are audit-logged separately by
      // the blob store; the cron should never fail the whole scan on
      // one broken profile.
    }
  }
  return profiles;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface ScanRequest {
  /** If true, actually dispatch tasks. Default: dry-run. */
  readonly dispatch?: boolean;
  /** ISO 8601 "as of" date override for tests. Default: now. */
  readonly asOfIso?: string;
}

function validateRequest(
  raw: unknown
): { ok: true; req: ScanRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: true, req: {} };
  const r = raw as Record<string, unknown>;
  const req: ScanRequest = {};
  if (r.dispatch !== undefined) {
    if (typeof r.dispatch !== 'boolean') {
      return { ok: false, error: 'dispatch must be boolean' };
    }
    req.dispatch = r.dispatch;
  }
  if (r.asOfIso !== undefined) {
    if (typeof r.asOfIso !== 'string' || Number.isNaN(Date.parse(r.asOfIso))) {
      return { ok: false, error: 'asOfIso must be a valid ISO 8601 string' };
    }
    req.asOfIso = r.asOfIso;
  }
  return { ok: true, req };
}

// ---------------------------------------------------------------------------
// Response payload builder (shared by all exit paths)
// ---------------------------------------------------------------------------

function buildResponsePayload(
  scan: ExpiryReport,
  report: ExpiryEmitReport,
  dispatched: number,
  skipped: number,
  dispatchErrors: number
) {
  return {
    asOfIso: scan.asOfIso,
    scannedProfiles: scan.scannedProfiles,
    alertCount: scan.alerts.length,
    bySeverity: scan.counts,
    summary: scan.summary,
    emitSummary: report.summary,
    draftCount: report.draftCount,
    bySection: report.bySection,
    drafts: report.drafts,
    dispatched,
    skipped,
    dispatchErrors,
    regulatory: scan.regulatory,
  };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 10,
    clientIp: context.ip,
    namespace: 'expiry-scan',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  // Accept empty body for the scheduled-function path.
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.length > 0) body = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validateRequest(body);
  if (!v.ok) return jsonResponse({ error: v.error }, { status: 400 });

  const asOf = v.req.asOfIso ? new Date(v.req.asOfIso) : new Date();
  const dispatch = v.req.dispatch === true;

  let profiles: readonly CustomerProfileV2[];
  try {
    profiles = await loadAllProfiles();
  } catch (err) {
    return jsonResponse(
      {
        error: 'load_profiles_failed',
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  const scan = scanExpiries(profiles, asOf);
  const report = buildExpiryEmitReport(scan.alerts);

  // Audit trail — always written, dry-run or not.
  try {
    const audit = getStore('expiry-scan-audit');
    await audit.setJSON(`scan/${Date.now()}.json`, {
      tsIso: asOf.toISOString(),
      userId: auth.userId ?? null,
      dispatch,
      scannedProfiles: scan.scannedProfiles,
      alertCount: scan.alerts.length,
      draftCount: report.draftCount,
      bySeverity: scan.counts,
      summary: scan.summary,
    });
  } catch {
    // non-fatal
  }

  // ---------------------------------------------------------------------------
  // Live Asana dispatch (when dispatch=true AND env vars are set)
  // ---------------------------------------------------------------------------
  let dispatched = 0;
  let skipped = 0;
  let dispatchErrors = 0;
  let dispatchNote = '';

  const kycProjectGid = process.env.ASANA_KYC_CDD_TRACKER_PROJECT_GID;
  const asanaToken = process.env.ASANA_ACCESS_TOKEN;

  if (dispatch && kycProjectGid && asanaToken && asanaToken.length >= 16) {
    // Step 1: list existing sections to resolve section names → GIDs.
    let sectionMap: Map<string, string>;
    try {
      const sectionsRes = await fetchWithTimeout(
        `https://app.asana.com/api/1.0/projects/${encodeURIComponent(kycProjectGid)}/sections?opt_fields=gid,name&limit=100`,
        {
          headers: { Authorization: `Bearer ${asanaToken}`, Accept: 'application/json' },
          timeoutMs: 20_000,
        }
      );
      if (!sectionsRes.ok) throw new Error(`HTTP ${sectionsRes.status}`);
      const sectionsJson = (await sectionsRes.json()) as {
        data: Array<{ gid: string; name: string }>;
      };
      sectionMap = new Map(sectionsJson.data.map((s) => [s.name, s.gid]));
    } catch (err) {
      dispatchNote = `dispatch=true but failed to list Asana sections: ${err instanceof Error ? err.message : String(err)}. Drafts returned for manual review.`;
      return jsonResponse({
        ok: false,
        error: 'asana_section_list_failed',
        dispatchNote,
        ...buildResponsePayload(scan, report, dispatched, skipped, dispatchErrors),
      });
    }

    // Step 2: list ALL existing task names for idempotency check.
    // Asana paginates at 100 items — we must follow next_page to
    // avoid missing tasks and creating duplicates.
    let existingTaskNames: Set<string>;
    try {
      existingTaskNames = new Set<string>();
      let nextUrl: string | null =
        `https://app.asana.com/api/1.0/projects/${encodeURIComponent(kycProjectGid)}/tasks?opt_fields=name&limit=100`;
      while (nextUrl) {
        const tasksRes = await fetchWithTimeout(nextUrl, {
          headers: { Authorization: `Bearer ${asanaToken}`, Accept: 'application/json' },
          timeoutMs: 20_000,
        });
        if (!tasksRes.ok) throw new Error(`HTTP ${tasksRes.status}`);
        const tasksJson = (await tasksRes.json()) as {
          data: Array<{ name: string }>;
          next_page: { uri: string } | null;
        };
        for (const t of tasksJson.data) existingTaskNames.add(t.name);
        nextUrl = tasksJson.next_page?.uri ?? null;
      }
    } catch {
      existingTaskNames = new Set(); // best-effort — allow dupes rather than fail
    }

    // Step 3: create tasks for each draft.
    for (const draft of report.drafts) {
      // Idempotency: skip if a task with the same name already exists.
      if (existingTaskNames.has(draft.taskName)) {
        skipped++;
        continue;
      }

      const sectionGid = sectionMap.get(draft.sectionName);
      if (!sectionGid) {
        skipped++;
        continue;
      }

      // Convert dd/mm/yyyy → yyyy-mm-dd for Asana due_on.
      const dueParts = draft.dueDateDdMmYyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const dueOn = dueParts ? `${dueParts[3]}-${dueParts[2]}-${dueParts[1]}` : undefined;

      try {
        const createRes = await fetchWithTimeout('https://app.asana.com/api/1.0/tasks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${asanaToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            data: {
              name: draft.taskName,
              notes: draft.taskBody,
              projects: [kycProjectGid],
              memberships: [{ project: kycProjectGid, section: sectionGid }],
              ...(dueOn ? { due_on: dueOn } : {}),
              tags: [],
            },
          }),
          timeoutMs: 15_000,
        });
        if (!createRes.ok) {
          // HTTP error (400, 401, 429, 500 etc.) — count as dispatch error.
          dispatchErrors++;
        } else {
          dispatched++;
          existingTaskNames.add(draft.taskName); // prevent duplicates within the same run
        }
      } catch {
        dispatchErrors++;
      }
    }

    dispatchNote =
      `Dispatched ${dispatched} task(s) to Asana project ${kycProjectGid}. ` +
      `${skipped} skipped (already exist or section not found). ` +
      `${dispatchErrors} error(s).`;
  } else if (dispatch && !kycProjectGid) {
    dispatchNote =
      'dispatch=true but ASANA_KYC_CDD_TRACKER_PROJECT_GID is not set. Set it in Netlify env vars to enable live dispatch. Drafts returned for manual review.';
  } else if (dispatch && (!asanaToken || asanaToken.length < 16)) {
    dispatchNote =
      'dispatch=true but ASANA_ACCESS_TOKEN is missing or too short. Drafts returned for manual review.';
  } else {
    dispatchNote =
      'Dry-run: the draft list is returned for operator review. Pass { "dispatch": true } to create tasks in Asana.';
  }

  return jsonResponse({
    ok: true,
    ...buildResponsePayload(scan, report, dispatched, skipped, dispatchErrors),
    dispatchNote,
  });
};

export const config: Config = {
  // Daily at 05:00 UTC (09:00 Dubai). Netlify scheduled functions
  // invoke the handler with an empty POST body which the handler
  // treats as a default dry-run scan.
  // Manual trigger: POST /.netlify/functions/expiry-scan-cron
  schedule: '0 5 * * *',
};

// Exported for unit tests.
export const __test__ = {
  validateRequest,
};
