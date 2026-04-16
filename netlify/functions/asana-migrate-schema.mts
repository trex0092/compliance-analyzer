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
  type FieldDelta,
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

interface AsanaFieldFull extends AsanaField {
  /** Present when Asana returns the full field record (create / lookup). */
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

/**
 * Fetch workspace custom fields with GIDs included. Used by the apply
 * path so add-options deltas know which field GID to target.
 */
async function fetchExistingFieldsWithGids(
  workspaceGid: string,
  token: string
): Promise<AsanaFieldFull[]> {
  const url = `${ASANA_BASE_URL}/workspaces/${workspaceGid}/custom_fields?opt_fields=name,type,resource_subtype,enum_options.gid,enum_options.name`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Asana fetch failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: AsanaFieldFull[] };
  return body.data ?? [];
}

/**
 * Create a custom field on the workspace. Idempotent at the application
 * level because callers compute the plan from a fresh fetch.
 */
async function createCustomField(
  workspaceGid: string,
  token: string,
  delta: FieldDelta
): Promise<{ gid: string; name: string }> {
  // Asana resource_subtype values map to: 'enum' | 'text' | 'number' | 'date' | 'multi_enum' | 'people'
  const data: Record<string, unknown> = {
    workspace: workspaceGid,
    name: delta.name,
    resource_subtype: delta.type,
    description: delta.description ?? '',
  };
  if (delta.type === 'enum' && delta.missingOptions && delta.missingOptions.length > 0) {
    data.enum_options = delta.missingOptions.map((name) => ({ name }));
  }
  const res = await fetch(`${ASANA_BASE_URL}/custom_fields`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Asana create_custom_field failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`
    );
  }
  const body = (await res.json()) as { data: { gid: string; name: string } };
  return body.data;
}

/**
 * Add enum options to an existing enum custom field.
 */
async function addEnumOptions(
  fieldGid: string,
  token: string,
  optionNames: readonly string[]
): Promise<number> {
  let added = 0;
  for (const name of optionNames) {
    const res = await fetch(
      `${ASANA_BASE_URL}/custom_fields/${fieldGid}/enum_options`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { name } }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Asana add_enum_option failed for ${name}: ${res.status} ${res.statusText} ${text.slice(0, 300)}`
      );
    }
    added++;
  }
  return added;
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

  // Apply flag — when set, the endpoint executes the plan: creates
  // missing custom fields and adds missing enum options. Idempotent:
  // the plan is computed fresh from the live workspace on every call,
  // so re-running after a partial success is safe and only finishes
  // the outstanding work.
  const shouldApply = url.searchParams.get('apply') === '1';
  const applyResult: {
    created: Array<{ name: string; gid: string }>;
    optionsAdded: Array<{ field: string; options: readonly string[] }>;
    skipped: Array<{ name: string; reason: string }>;
    errors: Array<{ name: string; error: string }>;
  } = { created: [], optionsAdded: [], skipped: [], errors: [] };

  if (shouldApply && (plan.toCreate > 0 || plan.toUpdate > 0)) {
    // Fetch once with GIDs for add-options lookups.
    let fullFields: AsanaFieldFull[] = [];
    try {
      fullFields = await fetchExistingFieldsWithGids(workspaceGid, token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeAudit({
        event: 'asana_migrate_apply_fetch_failed',
        workspaceGid,
        error: message,
      });
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
    const fieldGidByName = new Map<string, string>();
    for (const f of fullFields) fieldGidByName.set(f.name, f.gid);

    for (const delta of plan.deltas) {
      if (delta.action === 'ok') continue;
      try {
        if (delta.action === 'create') {
          const created = await createCustomField(workspaceGid, token, delta);
          applyResult.created.push({ name: created.name, gid: created.gid });
        } else if (delta.action === 'add-options') {
          const fieldGid = fieldGidByName.get(delta.name);
          if (!fieldGid) {
            applyResult.skipped.push({
              name: delta.name,
              reason: 'field gid not found on workspace at apply time',
            });
            continue;
          }
          const opts = delta.missingOptions ?? [];
          if (opts.length === 0) continue;
          await addEnumOptions(fieldGid, token, opts);
          applyResult.optionsAdded.push({ field: delta.name, options: opts });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        applyResult.errors.push({ name: delta.name, error: message });
      }
    }

    await writeAudit({
      event: 'asana_migrate_applied',
      workspaceGid,
      ...applyResult,
    });
  }

  return new Response(
    JSON.stringify({ ok: true, plan, ...(shouldApply ? { apply: applyResult } : {}) }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    }
  );
};

export const config: Config = {
  path: '/api/asana/migrate-schema',
  method: ['POST', 'OPTIONS'],
};
