/**
 * Brain zk Cross-Tenant — commit-only cross-tenant sanctions
 * collision attestation endpoint.
 *
 * POST /api/brain/zk-cross-tenant
 *
 * Actions:
 *   commit    — tenant commits an observation tuple under a shared
 *                salt version; only the hash is persisted.
 *   aggregate — returns the collision report for a salt version.
 *
 * Security:
 *   sharedSalt must match HAWKEYE_CROSS_TENANT_SALT env var.
 *   Any mismatch -> 400 reject. The salt is published by the FIU
 *   circular and is NOT secret — its role is domain separation.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.14, Art.20-22, Art.29
 *   Cabinet Res 74/2020 Art.5
 *   FATF Rec 2
 *   EU GDPR Art.25
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  commitCrossTenantObservation,
  aggregateCrossTenantCommitments,
  DEFAULT_K_ANONYMITY,
  MIN_K_ANONYMITY,
  type CrossTenantObservation,
} from '../../src/services/zkCrossTenantAttestation';
import { CrossTenantCommitmentBlobStore } from '../../src/services/tierCBlobStores';
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

const store: CrossTenantCommitmentBlobStore | null = (() => {
  try {
    const blob = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => blob.get(key, opts),
      setJSON: (key, value) => blob.setJSON(key, value),
      delete: (key) => blob.delete(key),
    });
    return new CrossTenantCommitmentBlobStore(handle);
  } catch {
    return null;
  }
})();

const LIST_NAMES: CrossTenantObservation['listName'][] = ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN'];

function validate(raw: unknown):
  | {
      ok: true;
      action: 'commit';
      tenantId: string;
      observation: CrossTenantObservation;
      saltVersion: string;
    }
  | { ok: true; action: 'aggregate'; saltVersion: string; kAnonymity: number }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (
    typeof r.saltVersion !== 'string' ||
    r.saltVersion.length === 0 ||
    r.saltVersion.length > 32
  ) {
    return { ok: false, error: 'saltVersion must be non-empty string (<=32)' };
  }

  if (action === 'aggregate') {
    // Optional kAnonymity override — clamped to the safety floor by
    // the aggregator, so a caller cannot ask for k=1.
    let kAnonymity = DEFAULT_K_ANONYMITY;
    if (r.kAnonymity !== undefined) {
      if (typeof r.kAnonymity !== 'number' || !Number.isFinite(r.kAnonymity)) {
        return { ok: false, error: 'kAnonymity must be a finite number' };
      }
      const requested = Math.floor(r.kAnonymity);
      if (requested < MIN_K_ANONYMITY) {
        return {
          ok: false,
          error: `kAnonymity must be >= ${MIN_K_ANONYMITY} (re-identification safety)`,
        };
      }
      if (requested > 100) {
        return { ok: false, error: 'kAnonymity must be <= 100' };
      }
      kAnonymity = requested;
    }
    return { ok: true, action, saltVersion: r.saltVersion, kAnonymity };
  }

  if (action === 'commit') {
    if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
      return { ok: false, error: 'tenantId required' };
    }
    const o = r.observation as Record<string, unknown> | undefined;
    if (!o || typeof o !== 'object') {
      return { ok: false, error: 'observation must be an object' };
    }
    if (
      typeof o.subjectKey !== 'string' ||
      o.subjectKey.length === 0 ||
      o.subjectKey.length > 256
    ) {
      return { ok: false, error: 'observation.subjectKey required (<=256)' };
    }
    if (typeof o.tsDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.tsDay)) {
      return { ok: false, error: 'observation.tsDay must be YYYY-MM-DD' };
    }
    if (
      typeof o.listName !== 'string' ||
      !LIST_NAMES.includes(o.listName as CrossTenantObservation['listName'])
    ) {
      return { ok: false, error: `observation.listName must be one of ${LIST_NAMES.join(', ')}` };
    }
    return {
      ok: true,
      action: 'commit',
      tenantId: r.tenantId,
      saltVersion: r.saltVersion,
      observation: {
        subjectKey: o.subjectKey,
        tsDay: o.tsDay,
        listName: o.listName as CrossTenantObservation['listName'],
      },
    };
  }

  return { ok: false, error: 'action must be commit | aggregate' };
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: 'brain-zk-cross-tenant',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const sharedSalt = process.env.HAWKEYE_CROSS_TENANT_SALT;
  if (!sharedSalt || sharedSalt.length < 16) {
    return jsonResponse(
      { error: 'HAWKEYE_CROSS_TENANT_SALT env var missing or too short' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) {
    console.warn(`[BRAIN-ZK-CROSS-TENANT] Rejected from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  if (!store) return jsonResponse({ error: 'xt_store_unavailable' }, { status: 503 });

  if (v.action === 'commit') {
    const commitment = commitCrossTenantObservation(v.observation, {
      tenantId: v.tenantId,
      saltVersion: v.saltVersion,
      sharedSalt,
    });
    store.persist(commitment);
    await store.flush();
    return jsonResponse({ ok: true, commitment });
  }

  // aggregate
  const commitments = await store.forSaltVersion(v.saltVersion);
  const report = aggregateCrossTenantCommitments(commitments, {
    kAnonymity: v.kAnonymity,
  });
  return jsonResponse({ ok: true, report });
};

export const config: Config = {
  path: '/api/brain/zk-cross-tenant',
  method: ['POST', 'OPTIONS'],
};

export const __test__ = { validate };
