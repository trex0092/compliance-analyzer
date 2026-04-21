/**
 * Four-Eyes Audit Log — server-side persistence of approval events
 *
 * POST /api/four-eyes-audit    (see netlify.toml redirect)
 *
 * Writes every four-eyes approval / rejection event to a Netlify Blob
 * store with strong consistency, keyed by date + timestamp. Satisfies
 * FDL No.(10)/2025 Art.24 (10-year retention) and Cabinet Res 134/2025
 * Art.14 (two-approver audit record).
 *
 * Schema (JSON body):
 *   {
 *     rowId:               string,   // screening row identifier
 *     subjectName:         string,
 *     country:             string,
 *     proposedDisposition: 'positive' | 'escalated',
 *     requesterId:         string,   // MLRO who proposed
 *     requestedAt:         ISO,
 *     approverId:          string,   // second MLRO
 *     event:               'approve' | 'reject',
 *     eventAt:             ISO,
 *     rejectionReason?:    string,
 *     cddTier?:            string,
 *     sanctionsHitCount?:  number,
 *     riskLevel?:          string,
 *     asanaUrl?:           string
 *   }
 *
 * Invariant: the server re-validates requesterId !== approverId before
 * accepting the record. A self-approval attempt returns 403 and is NOT
 * written — so the Blob store is a clean audit trail.
 *
 * Security + budget:
 *   - Authenticated (JWT / hex bearer).
 *   - Rate limited 30/min per IP (four-eyes events are rare; this
 *     catches runaway clients without starving the MLRO).
 *   - Input caps: string fields bounded; JSON size implicit.
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';

const RL_MAX = 30;
const RL_WINDOW_MS = 60 * 1000;
const STORE_NAME = 'four-eyes-audit';

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function str(v: unknown, max = 256): string | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0 || v.length > max) return null;
  return v;
}

function optStr(v: unknown, max = 256): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return undefined;
  if (v.length > max) return undefined;
  return v;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return fail(405, 'Method not allowed.');

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    namespace: 'four-eyes-audit',
    max: RL_MAX,
    windowMs: RL_WINDOW_MS,
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'Invalid JSON body.');
  }
  if (typeof body !== 'object' || body === null) return fail(400, 'Invalid body shape.');
  const b = body as Record<string, unknown>;

  const rowId       = str(b.rowId,      128);
  const subjectName = str(b.subjectName, 512);
  const requesterId = str(b.requesterId, 128);
  const approverId  = str(b.approverId,  128);
  const event       = str(b.event,        16);
  const eventAt     = str(b.eventAt,      64);
  const requestedAt = str(b.requestedAt,  64);
  const proposed    = str(b.proposedDisposition, 32);
  const country     = optStr(b.country, 128) ?? '';
  const cddTier     = optStr(b.cddTier,  16);
  const rejectionReason = optStr(b.rejectionReason, 1024);
  const asanaUrl    = optStr(b.asanaUrl, 1024);
  const riskLevel   = optStr(b.riskLevel, 32);
  const sanctionsHitCount = typeof b.sanctionsHitCount === 'number' ? Math.max(0, Math.min(20, b.sanctionsHitCount)) : undefined;

  if (!rowId || !subjectName || !requesterId || !approverId || !event || !eventAt || !requestedAt || !proposed) {
    return fail(400, 'Missing required fields.');
  }
  if (event !== 'approve' && event !== 'reject') {
    return fail(400, 'event must be "approve" or "reject".');
  }
  if (proposed !== 'positive' && proposed !== 'escalated') {
    return fail(400, 'proposedDisposition must be "positive" or "escalated".');
  }
  // Self-approval guard — refuse to write if requester === approver.
  // This is the server-side companion to the client-side currentMlroId
  // check; together they enforce Cabinet Res 134/2025 Art.14.
  if (requesterId === approverId) {
    return fail(403, 'Self-approval not permitted (Cabinet Res 134/2025 Art.14 two-approver rule).');
  }

  const record = {
    rowId,
    subjectName,
    country,
    proposedDisposition: proposed,
    requesterId,
    requestedAt,
    approverId,
    event,
    eventAt,
    rejectionReason,
    cddTier,
    sanctionsHitCount,
    riskLevel,
    asanaUrl,
    // Server-side provenance — so the audit pack can tie the record
    // back to the authenticating session without leaking raw tokens.
    recordedByUserId: auth.userId,
    recordedByJti: auth.jwt?.jti ?? null,
    recordedAtIso: new Date().toISOString(),
  };

  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    // Key = YYYY-MM-DD/<rowId>-<timestamp>.json so an auditor can
    // bucket by day and dedupe per rowId on replay.
    const dayKey = record.recordedAtIso.slice(0, 10);
    const key = `${dayKey}/${rowId}-${Date.now()}.json`;
    await store.setJSON(key, record);
    return Response.json({
      ok: true,
      key,
      recordedAtIso: record.recordedAtIso,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[four-eyes-audit] blob write failed:', msg);
    return fail(502, 'Audit store write failed.');
  }
};

export const config: Config = {
  method: ['POST', 'OPTIONS'],
};
