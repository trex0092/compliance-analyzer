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
interface ListFilter {
  readonly riskRating?: string;
  readonly country?: string;
  readonly legalNameContains?: string;
}
interface ListRequest extends BaseRequest {
  action: 'list';
  filter?: ListFilter;
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
    let filter: ListFilter | undefined;
    if (r.filter && typeof r.filter === 'object') {
      const f = r.filter as Record<string, unknown>;
      filter = {};
      if (f.riskRating !== undefined) {
        if (typeof f.riskRating !== 'string') return { ok: false, error: 'filter.riskRating must be a string' };
        filter = { ...filter, riskRating: f.riskRating };
      }
      if (f.country !== undefined) {
        if (typeof f.country !== 'string') return { ok: false, error: 'filter.country must be a string' };
        filter = { ...filter, country: f.country };
      }
      if (f.legalNameContains !== undefined) {
        if (typeof f.legalNameContains !== 'string') return { ok: false, error: 'filter.legalNameContains must be a string' };
        filter = { ...filter, legalNameContains: f.legalNameContains };
      }
    }
    return { ok: true, req: { action: 'list', filter } };
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
  /**
   * Atomic compare-and-swap update. Reads the current profile (or
   * null if absent), hands it to `transform`, and writes the result
   * back under a CAS precondition — retrying on conflict so two
   * concurrent patches cannot silently overwrite each other's
   * field changes. `transform` returning null aborts the update
   * (for 404 on missing profile).
   *
   * Implementations that can't do real CAS (in-memory test stubs,
   * older SDKs) may degrade to a plain get → transform → set; the
   * production blob-backed impl uses Netlify Blobs
   * `onlyIfMatch`.
   *
   * Returns:
   *   { ok: true, profile } — update landed
   *   { ok: false, notFound: true } — transform returned null
   *   { ok: false, contention: true } — all CAS attempts lost
   */
  casUpdate?(
    id: string,
    transform: (existing: CustomerProfileV2 | null) => CustomerProfileV2 | null,
  ): Promise<
    | { ok: true; profile: CustomerProfileV2 }
    | { ok: false; notFound?: boolean; contention?: boolean }
  >;
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
    async casUpdate(id, transform) {
      const MAX_ATTEMPTS = 5;
      const key = `profile/${id}.json`;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // Read with etag. Fall back to a plain get if
        // getWithMetadata is unavailable (older SDK).
        let existing: CustomerProfileV2 | null = null;
        let etag: string | null = null;
        try {
          const withMeta: unknown =
            typeof (store as unknown as { getWithMetadata?: unknown }).getWithMetadata === 'function'
              ? await (store as unknown as {
                  getWithMetadata: (k: string, o: unknown) => Promise<{ data: unknown; etag?: string }>;
                }).getWithMetadata(key, { type: 'json' })
              : null;
          if (withMeta && typeof withMeta === 'object' && 'data' in (withMeta as Record<string, unknown>)) {
            const tuple = withMeta as { data: CustomerProfileV2 | null; etag?: string };
            existing = tuple.data ?? null;
            etag = tuple.etag ?? null;
          } else {
            existing = (await store.get(key, { type: 'json' })) as CustomerProfileV2 | null;
          }
        } catch {
          existing = (await store.get(key, { type: 'json' })) as CustomerProfileV2 | null;
        }

        const next = transform(existing);
        if (next === null) return { ok: false, notFound: true };

        try {
          const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
          const res: unknown = await (store as unknown as {
            setJSON: (k: string, v: unknown, o?: unknown) => Promise<unknown>;
          }).setJSON(key, next, opts);
          const landed =
            res == null
              ? true
              : typeof res === 'object' && 'modified' in (res as Record<string, unknown>)
                ? (res as { modified: boolean }).modified === true
                : res !== false;
          if (landed) return { ok: true, profile: next };
          // else CAS conflict — loop and re-read.
        } catch {
          // SDK without CAS support — fall back to plain write and
          // treat as landed. Best-effort.
          await store.setJSON(key, next);
          return { ok: true, profile: next };
        }
      }
      return { ok: false, contention: true };
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
  req: ListRequest,
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
  const filter = req.filter;
  for (const id of ids) {
    const p = await deps.store.get(id);
    if (!p) continue;
    // Apply server-side filters if provided.
    if (filter?.riskRating && p.riskRating !== filter.riskRating) continue;
    if (filter?.country && p.country !== filter.country) continue;
    if (
      filter?.legalNameContains &&
      !p.legalName.toLowerCase().includes(filter.legalNameContains.toLowerCase())
    ) continue;
    summaries.push({
      id: p.id,
      legalName: p.legalName,
      riskRating: p.riskRating,
      licenseExpiryDate: p.licenseExpiryDate,
      country: p.country,
    });
  }
  return {
    status: 200,
    body: { ok: true, count: summaries.length, profiles: summaries, filter: filter ?? null },
  };
}

export async function handleUpdate(
  req: UpdateRequest,
  deps: HandlerDeps
): Promise<{ status: number; body: unknown }> {
  // Build the merged profile inside the transform so it is
  // recomputed on every CAS retry — picking up any fields another
  // writer added since we first read the record. Two concurrent
  // patches to the same customer no longer silently overwrite
  // each other's field changes (FDL Art.24 audit-chain integrity).
  let validationReport: ReturnType<typeof validateCustomerProfile> | null = null;

  const transform = (
    existing: CustomerProfileV2 | null,
  ): CustomerProfileV2 | null => {
    if (!existing) return null;
    const merged: CustomerProfileV2 = {
      ...existing,
      ...req.patch,
      id: existing.id,
      schemaVersion: 2,
      createdAt: existing.createdAt,
      lastReviewedAt: deps.nowIso,
      lastReviewerUserId: deps.userId,
    };
    // Validation uses the latest merged record — if the
    // concurrent writer added a field that conflicts with our
    // patch, the second-round validation will catch it instead
    // of silently losing state.
    validationReport = validateCustomerProfile(merged);
    if (!validationReport.ok) {
      // Abort the CAS loop by returning null — the handler below
      // surfaces 422 with the failed report.
      return null;
    }
    return merged;
  };

  if (typeof deps.store.casUpdate === 'function') {
    const result = await deps.store.casUpdate(req.id, transform);
    if (!result.ok) {
      if (validationReport && !validationReport.ok) {
        return {
          status: 422,
          body: { ok: false, error: 'validation_failed', report: validationReport },
        };
      }
      if (result.contention) {
        return {
          status: 503,
          body: {
            ok: false,
            error: 'profile_write_contention',
            message: 'Another update landed concurrently; please retry.',
          },
        };
      }
      return { status: 404, body: { ok: false, error: 'not_found', id: req.id } };
    }
    return {
      status: 200,
      body: {
        ok: true,
        profile: result.profile,
        warnings: validationReport?.warningCount ?? 0,
      },
    };
  }

  // Fallback for stores without CAS (test stubs). Same semantics
  // as before — no concurrency protection, but unchanged behaviour.
  const existing = await deps.store.get(req.id);
  if (!existing) return { status: 404, body: { ok: false, error: 'not_found', id: req.id } };
  const merged = transform(existing);
  if (!merged) {
    if (validationReport && !validationReport.ok) {
      return {
        status: 422,
        body: { ok: false, error: 'validation_failed', report: validationReport },
      };
    }
    return { status: 404, body: { ok: false, error: 'not_found', id: req.id } };
  }
  await deps.store.set(merged.id, merged);
  return {
    status: 200,
    body: { ok: true, profile: merged, warnings: validationReport?.warningCount ?? 0 },
  };
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
