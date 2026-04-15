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
import { scanExpiries } from '../../src/services/customerExpiryAlerter';
import { buildExpiryEmitReport } from '../../src/services/expiryAsanaEmitter';

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

  // NOTE: actual Asana dispatch is deliberately left for a
  // follow-up commit once the operator confirms the section
  // routing is right. For now we return the draft list so the
  // operator can eyeball it.
  const dispatchNote = dispatch
    ? 'dispatch=true was requested but is a no-op in this release — the draft list is returned for operator review. A follow-up commit will wire this to the Asana production dispatcher.'
    : 'Dry-run: the draft list is returned for operator review. Pass { "dispatch": true } to enable dispatch (currently a no-op).';

  return jsonResponse({
    ok: true,
    asOfIso: asOf.toISOString(),
    scannedProfiles: scan.scannedProfiles,
    alertCount: scan.alerts.length,
    bySeverity: scan.counts,
    summary: scan.summary,
    emitSummary: report.summary,
    draftCount: report.draftCount,
    bySection: report.bySection,
    drafts: report.drafts,
    dispatchNote,
    regulatory: scan.regulatory,
  });
};

export const config: Config = {
  path: '/api/expiry-scan',
  method: ['POST', 'OPTIONS'],
  // Daily at 05:00 UTC (09:00 Dubai). Netlify scheduled functions
  // invoke the handler with an empty POST body which the handler
  // treats as a default dry-run scan.
  schedule: '0 5 * * *',
};

// Exported for unit tests.
export const __test__ = {
  validateRequest,
};
