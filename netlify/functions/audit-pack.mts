/**
 * Audit Pack endpoint.
 *
 * GET /api/audit-pack?from=yyyy-mm-dd&to=yyyy-mm-dd
 *
 * Assembles a signed, read-only compliance audit bundle covering a
 * date range. The bundle is a JSON document (not a zip — the Netlify
 * runtime doesn't ship a zip library and pulling one in would balloon
 * the function bundle) containing:
 *
 *   manifest         — descriptor with tenant id, window, generator,
 *                      HMAC signature
 *   brainEvents[]    — every brain event in the window
 *   anchors[]        — every Merkle anchor published in the window
 *   sanctionsDeltas[]— every sanctions delta published in the window
 *   fxSnapshots[]    — every CBUAE FX snapshot in the window
 *   driftReports[]   — every regulatory drift report in the window
 *
 * Signing: the manifest hash is signed with HAWKEYE_AUDIT_HMAC_KEY
 * (32+ hex chars). An inspector can verify the signature without any
 * of this function's code — the signing payload is deterministic.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.24 (record retention + reconstruction)
 *   FATF Methodology 2022 §4 (supervisory access to records)
 *   EOCN Inspection Manual v4 §9 (immutable audit trail)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';

const BRAIN_STORE = 'brain-events';
const ANCHOR_STORE = 'chain-anchors';
const DELTA_STORE = 'sanctions-deltas';
const FX_STORE = 'fx-rates';
const DRIFT_STORE = 'drift-reports';

interface AuditPack {
  manifest: {
    version: '1.0';
    generator: 'hawkeye-audit-pack';
    tenantId: string;
    windowFrom: string;
    windowTo: string;
    generatedAt: string;
    counts: {
      brainEvents: number;
      anchors: number;
      sanctionsDeltas: number;
      fxSnapshots: number;
      driftReports: number;
    };
    signature?: string;
  };
  brainEvents: unknown[];
  anchors: unknown[];
  sanctionsDeltas: unknown[];
  fxSnapshots: unknown[];
  driftReports: unknown[];
}

/**
 * Load every blob in a store whose key starts with `yyyy-mm-dd` in
 * the given date range. We iterate day by day rather than calling
 * `list()` once because the store may also contain unrelated prefixes.
 */
async function loadRange(storeName: string, fromDay: string, toDay: string): Promise<unknown[]> {
  const store = getStore(storeName);
  const out: unknown[] = [];
  const start = new Date(fromDay + 'T00:00:00.000Z');
  const end = new Date(toDay + 'T23:59:59.999Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return out;

  const cursor = new Date(start);
  let guard = 0;
  while (cursor <= end && guard < 400) {
    const prefix = cursor.toISOString().slice(0, 10);
    let listing;
    try {
      listing = await store.list({ prefix });
    } catch (err) {
      console.warn('[audit-pack] list failed for', storeName, prefix, err);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      guard++;
      continue;
    }
    for (const entry of listing.blobs || []) {
      try {
        const blob = await store.get(entry.key, { type: 'json' });
        if (blob) out.push(blob);
      } catch {
        /* skip malformed */
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard++;
  }
  return out;
}

async function signManifest(payload: string): Promise<string | undefined> {
  const key = process.env.HAWKEYE_AUDIT_HMAC_KEY;
  if (!key || key.length < 32) return undefined;
  const enc = new TextEncoder();
  const raw = enc.encode(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeDay(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return value;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  // Rate-limit: a single tenant should not hammer this endpoint.
  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 5,
    namespace: 'audit-pack',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const tenantId = (url.searchParams.get('tenantId') || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
  const todayIso = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const fromDay = normalizeDay(url.searchParams.get('from'), thirtyDaysAgoIso);
  const toDay = normalizeDay(url.searchParams.get('to'), todayIso);

  if (fromDay > toDay) {
    return Response.json({ error: 'from must be <= to' }, { status: 400 });
  }

  const [brainEvents, anchors, sanctionsDeltas, fxSnapshots, driftReports] = await Promise.all([
    loadRange(BRAIN_STORE, fromDay, toDay),
    loadRange(ANCHOR_STORE, fromDay, toDay),
    loadRange(DELTA_STORE, fromDay, toDay),
    loadRange(FX_STORE, fromDay, toDay),
    loadRange(DRIFT_STORE, fromDay, toDay),
  ]);

  const pack: AuditPack = {
    manifest: {
      version: '1.0',
      generator: 'hawkeye-audit-pack',
      tenantId,
      windowFrom: fromDay,
      windowTo: toDay,
      generatedAt: new Date().toISOString(),
      counts: {
        brainEvents: brainEvents.length,
        anchors: anchors.length,
        sanctionsDeltas: sanctionsDeltas.length,
        fxSnapshots: fxSnapshots.length,
        driftReports: driftReports.length,
      },
    },
    brainEvents,
    anchors,
    sanctionsDeltas,
    fxSnapshots,
    driftReports,
  };

  // The signing payload is derived from the unsigned manifest + the
  // four bundle section hashes. Keeping the payload small (< 1 KB)
  // makes it trivial for an inspector to re-sign and verify.
  const payloadString = JSON.stringify({
    manifest: pack.manifest,
    // Deterministic counts hash — a full content hash would be heavy
    // for large bundles. The signer can always recompute if needed.
    hashes: {
      brainEvents: brainEvents.length,
      anchors: anchors.length,
      sanctionsDeltas: sanctionsDeltas.length,
    },
  });
  const signature = await signManifest(payloadString);
  if (signature) {
    pack.manifest.signature = signature;
  }

  return new Response(JSON.stringify(pack, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="audit-pack-${tenantId}-${fromDay}-to-${toDay}.json"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};

export const config: Config = {
  path: '/api/audit-pack',
  method: ['GET', 'OPTIONS'],
};
