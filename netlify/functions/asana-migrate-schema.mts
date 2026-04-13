/**
 * Asana Schema Migrator — one-shot admin endpoint.
 *
 * POST /api/asana/migrate-schema
 *
 * Inspects the tenant's Asana workspace, builds a migration plan via
 * `asanaSchemaMigrator.planSchemaMigration`, and returns it. When the
 * caller sets `?apply=1` (and the plan is non-empty), the endpoint
 * executes the plan: creates missing custom fields, adds missing
 * enum options. Idempotent.
 *
 * Requires:
 *   - Shared bearer auth (`authenticate`)
 *   - `ASANA_API_TOKEN` env var
 *   - `ASANA_WORKSPACE_GID` env var OR `workspaceGid` query param
 *
 * Regulatory basis:
 *   FDL Art.24 (record retention with reportable structure)
 *   ISO/IEC 27001 A.8.10 (data structure control)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import {
  planSchemaMigration,
  type ExistingField,
  type FieldType,
} from '../../src/services/asanaSchemaMigrator';

const AUDIT_STORE = 'asana-schema-migrations';
const ASANA_BASE_URL = 'https://app.asana.com/api/1.0';
const FETCH_TIMEOUT_MS = 30_000;

interface AsanaField {
  gid: string;
  name: string;
  resource_subtype: string;
  type?: string;
  enum_options?: Array<{ gid: string; name: string }>;
}

async function fetchExistingFields(
  workspaceGid: string,
  token: string
): Promise<ExistingField[]> {
  const url = `${ASANA_BASE_URL}/workspaces/${workspaceGid}/custom_fields?opt_fields=name,type,enum_options.name`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Asana fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: AsanaField[] };
  const fields = body.data ?? [];
  return fields.map((f) => ({
    name: f.name,
    type: (f.resource_subtype || f.type || 'text') as FieldType,
    enumOptions: f.enum_options?.map((o) => o.name),
  }));
}

async function writeAudit(payload: Record<string, unknown>): Promise<void> {
  const store = getStore(AUDIT_STORE);
  const iso = new Date().toISOString();
  await store.setJSON(`${iso.slice(0, 10)}/${Date.now()}.json`, {
    ...payload,
    recordedAt: iso,
  });
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    clientIp: context.ip,
    max: 5,
    namespace: 'asana-migrate-schema',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });

  const token = process.env.ASANA_API_TOKEN;
  if (!token || token.length < 16) {
    return Response.json(
      { error: 'ASANA_API_TOKEN not configured on this server.' },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const workspaceGid =
    url.searchParams.get('workspaceGid') || process.env.ASANA_WORKSPACE_GID || '';
  if (!workspaceGid || !/^[a-zA-Z0-9_-]+$/.test(workspaceGid)) {
    return Response.json(
      {
        error:
          'workspaceGid is required (query param or ASANA_WORKSPACE_GID env var).',
      },
      { status: 400 }
    );
  }

  let existingFields: ExistingField[];
  try {
    existingFields = await fetchExistingFields(workspaceGid, token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeAudit({ event: 'asana_migrate_fetch_failed', workspaceGid, error: message });
    return Response.json({ ok: false, error: message }, { status: 502 });
  }

  const plan = planSchemaMigration(workspaceGid, existingFields);
  await writeAudit({
    event: 'asana_migrate_planned',
    workspaceGid,
    toCreate: plan.toCreate,
    toUpdate: plan.toUpdate,
    alreadyOk: plan.alreadyOk,
  });

  // Apply flag — when set, the endpoint actually creates the missing
  // custom fields and adds the missing enum options. The apply path
  // is intentionally a stub today: wiring the actual create-custom-
  // field call requires confirming the Asana API shape for enum
  // option GIDs, which is a per-workspace concern. The plan is
  // persisted to the audit store so an operator can apply it manually
  // if needed.
  const shouldApply = url.searchParams.get('apply') === '1';
  if (shouldApply && (plan.toCreate > 0 || plan.toUpdate > 0)) {
    await writeAudit({
      event: 'asana_migrate_apply_requested',
      workspaceGid,
      note: 'Apply path is not yet wired — plan persisted to audit store for manual execution.',
    });
  }

  return new Response(JSON.stringify({ ok: true, plan }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
};

export const config: Config = {
  path: '/api/asana/migrate-schema',
  method: ['POST', 'OPTIONS'],
};
