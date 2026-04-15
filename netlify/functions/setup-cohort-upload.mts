/**
 * Setup Cohort Upload — accepts a raw CSV body from the browser-only
 * setup wizard, parses it via csvCohortImporter, and writes the
 * result to the sanctions-cohort blob store.
 *
 * POST /api/setup/cohort-upload
 *
 * Body:
 *   { tenantId: "tenant-a", csv: "id,name,tenantId\\n..." }
 *
 * This endpoint exists so operators who cannot use a terminal can
 * still load their customer cohort — the setup.html wizard calls
 * this endpoint from the browser after the user pastes a CSV.
 *
 * Security:
 *   POST + OPTIONS only
 *   Bearer HAWKEYE_BRAIN_TOKEN required
 *   Rate limited 10 / 15 min (sensitive bucket — cohorts are big)
 *   Input length capped at 10 MB
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD data)
 *   FDL No.10/2025 Art.20-22 (CO visibility)
 *   FDL No.10/2025 Art.24    (audit trail)
 *   Cabinet Res 134/2025 Art.7-10
 *   FATF Rec 10
 *   EU GDPR Art.25
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import { importCohortCsv } from '../../src/services/csvCohortImporter';

const MAX_CSV_BYTES = 10 * 1024 * 1024; // 10 MB

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? 'https://compliance-analyzer.netlify.app',
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

interface SetupUploadRequest {
  tenantId: string;
  csv: string;
}

function validate(raw: unknown): { ok: true; req: SetupUploadRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: 'tenantId must be 1..64 chars' };
  }
  if (!/^[a-z0-9-]+$/.test(r.tenantId)) {
    return { ok: false, error: 'tenantId must contain only lowercase letters, digits, and hyphens' };
  }
  if (typeof r.csv !== 'string' || r.csv.length === 0) {
    return { ok: false, error: 'csv must be a non-empty string' };
  }
  if (r.csv.length > MAX_CSV_BYTES) {
    return { ok: false, error: `csv exceeds max size ${MAX_CSV_BYTES} bytes` };
  }
  return { ok: true, req: { tenantId: r.tenantId, csv: r.csv } };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  // Sensitive bucket — 10 / 15 min
  const rl = await checkRateLimit(req, {
    max: 10,
    clientIp: context.ip,
    namespace: 'setup-cohort-upload',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) {
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  // Run the pure importer.
  const report = importCohortCsv(v.req.csv, { targetTenantId: v.req.tenantId });

  // Only write to the blob if we got at least one valid row.
  if (report.customers.length === 0) {
    return jsonResponse(
      {
        ok: false,
        reason: 'no valid rows — see errors field',
        totalRowsObserved: report.totalRowsObserved,
        totalRowsAccepted: report.totalRowsAccepted,
        totalRowsRejected: report.totalRowsRejected,
        errors: report.errors,
        warnings: report.warnings,
      },
      { status: 400 }
    );
  }

  // Write to the sanctions-cohort blob store at the key the cron reads.
  let written = false;
  try {
    const store = getStore('sanctions-cohort');
    await store.setJSON(`${v.req.tenantId}/cohort.json`, report.customers);
    written = true;
  } catch (err) {
    console.warn(
      '[setup-cohort-upload] blob write failed:',
      err instanceof Error ? err.message : String(err)
    );
  }

  // Append an audit record so the operator can trace the upload later.
  try {
    const audit = getStore('setup-audit');
    await audit.setJSON(
      `cohort-upload/${v.req.tenantId}/${Date.now()}.json`,
      {
        tsIso: new Date().toISOString(),
        userId: auth.userId,
        tenantId: v.req.tenantId,
        totalRowsObserved: report.totalRowsObserved,
        totalRowsAccepted: report.totalRowsAccepted,
        totalRowsRejected: report.totalRowsRejected,
        summary: report.summary,
      }
    );
  } catch {
    // non-fatal
  }

  return jsonResponse(
    {
      ok: written,
      blobWritten: written,
      tenantId: v.req.tenantId,
      totalRowsObserved: report.totalRowsObserved,
      totalRowsAccepted: report.totalRowsAccepted,
      totalRowsRejected: report.totalRowsRejected,
      warnings: report.warnings,
      errors: report.errors,
      summary: report.summary,
      regulatory: report.regulatory,
    },
    { status: written ? 200 : 503 }
  );
};

export const config: Config = {
  path: '/api/setup/cohort-upload',
  method: ['POST', 'OPTIONS'],
};

// Exported for tests.
export const __test__ = { validate, MAX_CSV_BYTES };
