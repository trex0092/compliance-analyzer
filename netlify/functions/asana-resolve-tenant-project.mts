/**
 * Asana Tenant Project Resolver — Phase 19 W-B wiring endpoint.
 *
 * POST /api/asana/resolve-tenant-project
 *
 * Read-only. Takes { tenantId, kind } and returns the resolved
 * Asana project GID via the three-tier chain (registry blob →
 * legacy compiled map → env default). This is the server-side
 * replacement for the browser-side hardcoded map in
 * asana-project-resolver.js.
 *
 * Body shape:
 *   {
 *     tenantId: string,
 *     kind: "compliance" | "workflow",
 *     allowDefaultFallback?: boolean
 *   }
 *
 * Response on success:
 *   {
 *     ok: true,
 *     tenantId, kind, projectGid, source: "registry" | "legacy" | "default",
 *     name?: string
 *   }
 *
 * Response on resolution failure:
 *   {
 *     ok: false,
 *     tenantId, kind, reason: "tenant_not_in_registry_and_no_legacy_entry" |
 *                              "invalid_tenant_id" |
 *                              "invalid_project_kind" |
 *                              "registry_entry_missing_kind"
 *   }
 *
 * The underlying pure compute lives in
 * src/services/asanaTenantProjectResolver.ts (PR #185). This file
 * wires three things: bearer-token auth, Netlify Blobs read for
 * the registry row, and the env-var default.
 *
 * Regulatory basis:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility; no cross-tenant
 *     dispatch.
 *   FDL No. 10 of 2025 Art.29 — no tipping off.
 *   Cabinet Resolution 134/2025 Art.18 — tenant bootstrap produces
 *     the registry rows this endpoint consumes.
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  resolveTenantProject,
  type AsanaProjectKind,
  type TenantProjectEntry,
} from '../../src/services/asanaTenantProjectResolver';

const REGISTRY_STORE = 'asana-tenant-registry';
const MAX_BODY_BYTES = 4 * 1024;

interface RequestShape {
  tenantId: string;
  kind: AsanaProjectKind;
  allowDefaultFallback?: boolean;
}

function coerceRequest(raw: unknown): RequestShape | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Body must be a JSON object.' };
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0) {
    return { error: 'tenantId is required.' };
  }
  if (r.kind !== 'compliance' && r.kind !== 'workflow') {
    return { error: 'kind must be "compliance" or "workflow".' };
  }
  if (r.allowDefaultFallback !== undefined && typeof r.allowDefaultFallback !== 'boolean') {
    return { error: 'allowDefaultFallback must be a boolean if provided.' };
  }
  return {
    tenantId: r.tenantId,
    kind: r.kind,
    allowDefaultFallback: Boolean(r.allowDefaultFallback),
  };
}

async function readRegistryEntry(tenantId: string): Promise<TenantProjectEntry | null> {
  try {
    const store = getStore(REGISTRY_STORE);
    const raw = (await store.get(`tenant:${tenantId}.json`, {
      type: 'json',
    })) as TenantProjectEntry | null;
    if (!raw) return null;
    if (typeof raw !== 'object') return null;
    if (typeof raw.compliance !== 'string' || typeof raw.workflow !== 'string') return null;
    return raw;
  } catch {
    // Netlify Blobs unavailable — treat as cache miss, let the
    // resolver fall through to the legacy map.
    return null;
  }
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 60,
    namespace: 'asana-resolve-tenant-project',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Preflight Content-Length — refuse before buffering.
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return Response.json({ error: 'Body exceeds 4 KB cap.' }, { status: 413 });
    }
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: 'Body exceeds 4 KB cap.' }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const coerced = coerceRequest(parsed);
  if ('error' in coerced) {
    return Response.json({ error: coerced.error }, { status: 400 });
  }

  const registryEntry = await readRegistryEntry(coerced.tenantId);
  const defaultProjectGid = process.env.ASANA_DEFAULT_PROJECT_GID ?? null;

  const result = resolveTenantProject(coerced.tenantId, coerced.kind, {
    registryEntry,
    defaultProjectGid,
    allowDefaultFallback: coerced.allowDefaultFallback,
  });

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 404,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};

export const config: Config = {
  path: '/api/asana/resolve-tenant-project',
  method: ['POST', 'OPTIONS'],
};
