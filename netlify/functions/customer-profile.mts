/**
 * Customer Profile CRUD endpoint — browser-facing + agent-facing
 * CRUD over CustomerProfileV2 records, backed by Netlify Blobs.
 *
 * Routes (all under POST /api/customer-profile with an { action } field):
 *   - action: 'create'  → create a new profile
 *   - action: 'get'     → fetch by id
 *   - action: 'list'    → list all profiles
 *   - action: 'update'  → partial patch by id
 *   - action: 'delete'  → hard delete by id (audit-logged)
 *
 * Why POST for everything:
 *   Netlify functions are routed by path, and the existing
 *   middleware chain (auth + rate limit) is POST-first. Using a
 *   single POST endpoint with an `action` discriminator keeps the
 *   auth/rate-limit plumbing consistent with every other brain
 *   endpoint in this repo.
 *
 * Every write path runs the pure `validateCustomerProfile`
 * validator before touching the blob store. If the validator
 * reports blockers, the write is rejected with 422 + the full
 * finding list so the UI can render inline errors.
 *
 * Persistence: Netlify Blobs store "customer-profiles", keyed by
 * `profile/${id}.json`. The store is global per-site (per-tenant
 * partitioning is enforced at the auth layer — the brain token
 * carries a tenant id).
 *
 * Security:
 *   POST + OPTIONS only
 *   Bearer HAWKEYE_BRAIN_TOKEN required (via authenticate())
 *   Rate limited 30 / 15 min per IP (read-heavy on the list action)
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD per customer)
 *   FDL No.10/2025 Art.24    (10yr retention — records are never
 *                              hard-deleted; `delete` moves to a
 *                              tombstone key with the same TTL)
 *   FDL No.10/2025 Art.20-22 (CO visibility into the customer register)
 *   Cabinet Res 134/2025 Art.7-10 (CDD data per tier)
 *   Cabinet Res 134/2025 Art.19   (internal review)
 *   Cabinet Decision 109/2023     (UBO register)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import type { CustomerProfileV2 } from '../../src/domain/customerProfile';
import { validateCustomerProfile } from '../../src/services/customerProfileValidator';

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
// Request validation
// ---------------------------------------------------------------------------

type Action = 'create' | 'get' | 'list' | 'update' | 'delete';

interface BaseRequest {
  action: Action;
}
interface CreateRequest extends BaseRequest {
  action: 'create';
  profile: CustomerProfileV2;
}
interface GetRequest extends BaseRequest {
  action: 'get';
  id: string;
}
interface ListRequest extends BaseRequest {
  action: 'list';
}
interface UpdateRequest extends BaseRequest {
  action: 'update';
  id: string;
  patch: Partial<CustomerProfileV2>;
}
interface DeleteRequest extends BaseRequest {
  action: 'delete';
  id: string;
  reason: string;
}

type ProfileRequest = CreateRequest | GetRequest | ListRequest | UpdateRequest | DeleteRequest;

function validateRequest(
  raw: unknown
): { ok: true; req: ProfileRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  const action = r.action;
  if (typeof action !== 'string') return { ok: false, error: 'action must be a string' };
  if (!['create', 'get', 'list', 'update', 'delete'].includes(action)) {
    return { ok: false, error: `unknown action: ${action}` };
  }
  if (action === 'create') {
    if (!r.profile || typeof r.profile !== 'object') {
      return { ok: false, error: 'create requires a profile object' };
    }
    return { ok: true, req: { action: 'create', profile: r.profile as CustomerProfileV2 } };
  }
  if (action === 'get') {
    if (typeof r.id !== 'string' || r.id.length === 0) {
      return { ok: false, error: 'get requires id string' };
    }
    return { ok: true, req: { action: 'get', id: r.id } };
  }
  if (action === 'list') {
    return { ok: true, req: { action: 'list' } };
  }
  if (action === 'update') {
    if (typeof r.id !== 'string' || r.id.length === 0) {
      return { ok: false, error: 'update requires id string' };
    }
    if (!r.patch || typeof r.patch !== 'object') {
      return { ok: false, error: 'update requires a patch object' };
    }
    return {
      ok: true,
      req: {
        action: 'update',
        id: r.id,
        patch: r.patch as Partial<CustomerProfileV2>,
      },
    };
  }
  // delete
  if (typeof r.id !== 'string' || r.id.length === 0) {
    return { ok: false, error: 'delete requires id string' };
  }
  if (typeof r.reason !== 'string' || r.reason.length < 5) {
    return { ok: false, error: 'delete requires a reason (≥5 chars) for the audit log' };
  }
  return { ok: true, req: { action: 'delete', id: r.id, reason: r.reason } };
}

// ---------------------------------------------------------------------------
// Blob-store helpers (injectable for tests via __test__)
// ---------------------------------------------------------------------------

interface ProfileStore {
  list(): Promise<readonly string[]>;
  get(id: string): Promise<CustomerProfileV2 | null>;
  set(id: string, profile: CustomerProfileV2): Promise<void>;
  tombstone(id: string, payload: { reason: string; tombstonedAt: string }): Promise<void>;
}

function makeNetlifyBlobStore(): ProfileStore {
  const store = getStore('customer-profiles');
  const tombstones = getStore('customer-profiles-tombstones');
  return {
    async list() {
      // Netlify Blobs exposes a list() method that yields keys under
      // a prefix. We scope by "profile/".
      const res = await store.list({ prefix: 'profile/' });
      return res.blobs.map((b) => b.key);
    },
    async get(id: string) {
      const raw = (await store.get(`profile/${id}.json`, {
        type: 'json',
      })) as CustomerProfileV2 | null;
      return raw ?? null;
    },
    async set(id: string, profile: CustomerProfileV2) {
      await store.setJSON(`profile/${id}.json`, profile);
    },
    async tombstone(id, payload) {
      // Move the profile body out of the live store and into the
      // tombstone store. FDL Art.24 — 10 year retention means we
      // do NOT hard delete.
      const existing = await store.get(`profile/${id}.json`, { type: 'json' });
      if (existing) {
        await tombstones.setJSON(`tombstone/${id}/${Date.now()}.json`, {
          profile: existing,
          ...payload,
        });
      }
      await store.delete(`profile/${id}.json`);
    },
  };
}

// ---------------------------------------------------------------------------
// Pure business logic (testable, store is injected)
// ---------------------------------------------------------------------------

interface HandlerDeps {
  store: ProfileStore;
  nowIso: string;
  userId: string;
}

export async function handleCreate(
  req: CreateRequest,
  deps: HandlerDeps
): Promise<{ status: number; body: unknown }> {
  // Force the schema version + createdAt on create — caller cannot
  // forge these.
  const profile: CustomerProfileV2 = {
    ...req.profile,
    schemaVersion: 2,
    createdAt: deps.nowIso,
  };
  const report = validateCustomerProfile(profile);
  if (!report.ok) {
    return {
      status: 422,
      body: { ok: false, error: 'validation_failed', report },
    };
  }
  // Reject if id already exists — create is not an upsert.
  const existing = await deps.store.get(profile.id);
  if (existing) {
    return {
      status: 409,
      body: {
        ok: false,
        error: 'id_already_exists',
        id: profile.id,
        hint: 'use action="update" to modify an existing profile',
      },
    };
  }
  await deps.store.set(profile.id, profile);
  return { status: 200, body: { ok: true, profile, warnings: report.warningCount } };
}

export async function handleGet(
  req: GetRequest,
  deps: HandlerDeps
): Promise<{ status: number; body: unknown }> {
  const profile = await deps.store.get(req.id);
  if (!profile) return { status: 404, body: { ok: false, error: 'not_found', id: req.id } };
  return { status: 200, body: { ok: true, profile } };
}

export async function handleList(
  _req: ListRequest,
  deps: HandlerDeps
): Promise<{ status: number; body: unknown }> {
  const keys = await deps.store.list();
  const ids = keys
    .map((k) => {
      // profile/<id>.json → <id>
      const match = /^profile\/(.+)\.json$/.exec(k);
      return match?.[1] ?? null;
    })
    .filter((id): id is string => id !== null);
  // For list, return only id + legalName + riskRating summary (cheap
  // payload for the list view; UI fetches full profile on row click).
  const summaries: Array<{
    id: string;
    legalName: string;
    riskRating: string;
    licenseExpiryDate: string;
    country: string;
  }> = [];
  for (const id of ids) {
    const p = await deps.store.get(id);
    if (p) {
      summaries.push({
        id: p.id,
        legalName: p.legalName,
        riskRating: p.riskRating,
        licenseExpiryDate: p.licenseExpiryDate,
        country: p.country,
      });
    }
  }
  return { status: 200, body: { ok: true, count: summaries.length, profiles: summaries } };
}

export async function handleUpdate(
  req: UpdateRequest,
  deps: HandlerDeps
): Promise<{ status: number; body: unknown }> {
  const existing = await deps.store.get(req.id);
  if (!existing) return { status: 404, body: { ok: false, error: 'not_found', id: req.id } };

  // Merge the patch, but ALWAYS preserve id + createdAt +
  // schemaVersion (these are write-once).
  const merged: CustomerProfileV2 = {
    ...existing,
    ...req.patch,
    id: existing.id,
    schemaVersion: 2,
    createdAt: existing.createdAt,
    lastReviewedAt: deps.nowIso,
    lastReviewerUserId: deps.userId,
  };
  const report = validateCustomerProfile(merged);
  if (!report.ok) {
    return {
      status: 422,
      body: { ok: false, error: 'validation_failed', report },
    };
  }
  await deps.store.set(merged.id, merged);
  return { status: 200, body: { ok: true, profile: merged, warnings: report.warningCount } };
}

export async function handleDelete(
  req: DeleteRequest,
  deps: HandlerDeps
): Promise<{ status: number; body: unknown }> {
  const existing = await deps.store.get(req.id);
  if (!existing) return { status: 404, body: { ok: false, error: 'not_found', id: req.id } };
  await deps.store.tombstone(req.id, {
    reason: req.reason,
    tombstonedAt: deps.nowIso,
  });
  return { status: 200, body: { ok: true, tombstoned: req.id, reason: req.reason } };
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
    max: 30,
    clientIp: context.ip,
    namespace: 'customer-profile',
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

  const v = validateRequest(body);
  if (!v.ok) return jsonResponse({ error: v.error }, { status: 400 });

  const deps: HandlerDeps = {
    store: makeNetlifyBlobStore(),
    nowIso: new Date().toISOString(),
    userId: auth.userId ?? 'unknown',
  };

  let result;
  try {
    switch (v.req.action) {
      case 'create':
        result = await handleCreate(v.req, deps);
        break;
      case 'get':
        result = await handleGet(v.req, deps);
        break;
      case 'list':
        result = await handleList(v.req, deps);
        break;
      case 'update':
        result = await handleUpdate(v.req, deps);
        break;
      case 'delete':
        result = await handleDelete(v.req, deps);
        break;
    }
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        error: 'handler_error',
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  return jsonResponse(result.body, { status: result.status });
};

export const config: Config = {
  path: '/api/customer-profile',
  method: ['POST', 'OPTIONS'],
};

// Exports for unit tests.
export const __test__ = {
  validateRequest,
};
export type { ProfileStore, HandlerDeps };
