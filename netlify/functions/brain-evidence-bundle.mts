/**
 * Brain Evidence Bundle — single-call audit artifact exporter.
 *
 * POST /api/brain/evidence-bundle
 *
 * Assembles every durable artifact for a historical case
 * (CaseReplayStore tuple + matching BrainTelemetryStore entry +
 * regulatory drift report against the stored baseline) and returns
 * a single EvidenceBundle with a SHA3-512 integrity hash. The
 * MLRO hands the bundle to the inspector verbatim; the inspector
 * re-hashes to prove the bundle has not been modified after export.
 *
 * Request body:
 *   { tenantId: string, caseId: string }
 *
 * Response:
 *   { ok, bundle: EvidenceBundle, durationMs }
 *
 * Security:
 *   - POST only (+ OPTIONS preflight)
 *   - authenticate() against HAWKEYE_BRAIN_TOKEN
 *   - Rate limit: general bucket (100 / 15min / IP)
 *   - Strict input validation
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-24   (CO audit trail + 10-year retention)
 *   FDL No.10/2025 Art.29      (no tipping off — opaque refs only)
 *   Cabinet Res 134/2025 Art.19 (internal review — bundle IS review)
 *   NIST AI RMF 1.0 MANAGE-2/4  (AI decision provenance + recourse)
 *   FATF Rec 11                 (record keeping)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  exportEvidenceBundle,
  type EvidenceBundleLoaders,
} from '../../src/services/evidenceBundleExporter';
import { CaseReplayStore } from '../../src/services/caseReplayStore';
import { BrainTelemetryStore } from '../../src/services/brainTelemetryStore';
import { createNetlifyBlobHandle } from '../../src/services/brainMemoryBlobStore';

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

// Shared loaders — same Netlify Blob backend brain-analyze writes to.
const loaders: EvidenceBundleLoaders | null = (() => {
  try {
    const store = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    const replay = new CaseReplayStore(handle);
    const telemetry = new BrainTelemetryStore(handle);
    return {
      loadReplayCase: (tenantId, caseId) => replay.loadReplayCase(tenantId, caseId),
      loadTelemetryForDay: (tenantId, dayIso) => telemetry.readDay(tenantId, dayIso),
    };
  } catch {
    return null;
  }
})();

interface BundleRequest {
  tenantId: string;
  caseId: string;
}

function validate(
  raw: unknown
): { ok: true; request: BundleRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: 'tenantId must be a non-empty string (<=64)' };
  }
  if (typeof r.caseId !== 'string' || r.caseId.length === 0 || r.caseId.length > 128) {
    return { ok: false, error: 'caseId must be a non-empty string (<=128)' };
  }
  return { ok: true, request: { tenantId: r.tenantId, caseId: r.caseId } };
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: 'brain-evidence-bundle',
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
    console.warn(`[BRAIN-EVIDENCE-BUNDLE] Rejected input from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  if (!loaders) {
    return jsonResponse({ error: 'evidence_store_unavailable' }, { status: 503 });
  }

  const started = Date.now();
  const bundle = await exportEvidenceBundle(v.request.tenantId, v.request.caseId, loaders);
  const durationMs = Date.now() - started;

  console.log(
    `[BRAIN-EVIDENCE-BUNDLE] ${auth.userId} tenant=${v.request.tenantId} case=${v.request.caseId} ` +
      `conclusion=${bundle.conclusion} ms=${durationMs}`
  );

  return jsonResponse({ ok: true, bundle, durationMs });
};

export const config: Config = {
  path: '/api/brain/evidence-bundle',
  method: ['POST', 'OPTIONS'],
};

export const __test__ = { validate };
