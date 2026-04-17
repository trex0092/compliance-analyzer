/**
 * Setup Asana Bootstrap — ALL SIX TENANTS AT ONCE.
 *
 * POST /api/setup/asana-bootstrap-all
 *
 * Body (optional):
 *   { tenantIds?: string[] }  // default = DEFAULT_TENANT_IDS
 *
 * Saves the MLRO from running Step 8 of the wizard six times. One
 * click, six tenants provisioned in sequence. Idempotent: existing
 * projects/sections/fields are reused, not duplicated.
 *
 * Shares the dispatcher, env validation, and state-machine wiring
 * with setup-asana-bootstrap.mts. Per-tenant outcomes are
 * collected and returned in a single response with the same audit
 * row shape (one per tenant) written to the existing setup-audit
 * and asana-tenant-bootstrap-state blob stores.
 *
 * Security:
 *   POST + OPTIONS
 *   Bearer HAWKEYE_BRAIN_TOKEN required
 *   Rate-limited 2 / 15 min (tighter than single-tenant bootstrap
 *     because this fans out six Asana provisionings per call)
 *
 * Regulatory basis:
 *   FDL No. 10 of 2025 Art.20-22 (CO visibility)
 *   FDL No. 10 of 2025 Art.24 (audit trail for every provisioning)
 *   Cabinet Resolution 134/2025 Art.18 (MLRO arrangement notif.)
 *   Cabinet Resolution 134/2025 Art.19 (internal review)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  tenantProvisioningPlan,
  provisionTenant,
  type AsanaProvisionDispatcher,
  type CustomFieldSpec,
} from '../../src/services/asana/tenantProvisioner';

const ASANA_BASE = 'https://app.asana.com/api/1.0';

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

/**
 * Canonical six-entity list. Matches the tenant IDs an operator
 * would otherwise type into Step 8 of the wizard six times.
 */
const DEFAULT_TENANT_IDS: readonly string[] = Object.freeze([
  'fine-gold-llc',
  'fine-gold-branch',
  'madison-llc',
  'naples-llc',
  'gramaltin-as',
  'zoe-fze',
]);

// ---------------------------------------------------------------------------
// Asana dispatcher — identical shape to setup-asana-bootstrap.mts.
// Kept inline rather than imported so this endpoint can be deployed
// or disabled without touching the single-tenant bootstrap code
// path.
// ---------------------------------------------------------------------------

function makeAsanaDispatcher(accessToken: string): AsanaProvisionDispatcher {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  async function asanaRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(ASANA_BASE + path, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Asana ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`
      );
    }
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  return {
    async ensureProject({ workspaceGid, name, color, layout }) {
      const existing = await asanaRequest<Array<{ gid: string; name: string }>>(
        `/projects?workspace=${encodeURIComponent(workspaceGid)}&opt_fields=name`
      );
      const match = existing.find((p) => p.name === name);
      if (match) return { projectGid: match.gid, created: false };
      const created = await asanaRequest<{ gid: string }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          data: { workspace: workspaceGid, name, color: mapColor(color), layout },
        }),
      });
      return { projectGid: created.gid, created: true };
    },

    async ensureSection({ projectGid, name }) {
      const existing = await asanaRequest<Array<{ gid: string; name: string }>>(
        `/projects/${encodeURIComponent(projectGid)}/sections`
      );
      const match = existing.find((s) => s.name === name);
      if (match) return { sectionGid: match.gid, created: false };
      const created = await asanaRequest<{ gid: string }>(
        `/projects/${encodeURIComponent(projectGid)}/sections`,
        { method: 'POST', body: JSON.stringify({ data: { name } }) }
      );
      return { sectionGid: created.gid, created: true };
    },

    async ensureCustomField({ workspaceGid, field }) {
      const existing = await asanaRequest<Array<{ gid: string; name: string }>>(
        `/workspaces/${encodeURIComponent(workspaceGid)}/custom_fields?opt_fields=name`
      );
      const match = existing.find((f) => f.name === field.name);
      if (match) return { fieldGid: match.gid, created: false };
      const data: Record<string, unknown> = {
        workspace: workspaceGid,
        name: field.name,
        resource_subtype: mapFieldType(field),
      };
      if (field.type === 'enum') {
        data.enum_options = (field.enumValues ?? []).map((v) => ({
          name: v,
          color: 'cool-gray',
        }));
      } else if (field.type === 'number') {
        data.precision = 2;
      }
      const created = await asanaRequest<{ gid: string }>('/custom_fields', {
        method: 'POST',
        body: JSON.stringify({ data }),
      });
      return { fieldGid: created.gid, created: true };
    },

    async ensureWebhook({ projectGid, target }) {
      const existing = await asanaRequest<
        Array<{ gid: string; resource: { gid: string }; target: string }>
      >(
        `/webhooks?workspace=${encodeURIComponent(process.env.ASANA_WORKSPACE_GID ?? '')}&opt_fields=target,resource`
      ).catch(() => [] as Array<{ gid: string; resource: { gid: string }; target: string }>);
      const match = existing.find((w) => w.resource.gid === projectGid && w.target === target);
      if (match) return { webhookGid: match.gid, created: false };
      const created = await asanaRequest<{ gid: string }>('/webhooks', {
        method: 'POST',
        body: JSON.stringify({ data: { resource: projectGid, target } }),
      });
      return { webhookGid: created.gid, created: true };
    },
  };
}

function mapColor(hex: string): string {
  const palette: Record<string, string> = {
    '#1F77B4': 'dark-blue',
    '#FF7F0E': 'dark-orange',
    '#2CA02C': 'dark-green',
    '#D62728': 'dark-red',
    '#9467BD': 'dark-purple',
    '#8C564B': 'dark-brown',
    '#E377C2': 'dark-pink',
    '#7F7F7F': 'dark-warm-gray',
    '#BCBD22': 'dark-teal',
    '#17BECF': 'dark-teal',
    '#393B79': 'dark-purple',
    '#637939': 'dark-green',
  };
  return palette[hex] ?? 'dark-blue';
}

function mapFieldType(field: CustomFieldSpec): string {
  switch (field.type) {
    case 'enum':
      return 'enum';
    case 'number':
      return 'number';
    case 'date':
      return 'date';
    case 'task_reference':
      return 'text';
    default:
      return 'text';
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface BulkRequest {
  tenantIds: readonly string[];
}

function validate(raw: unknown): { ok: true; req: BulkRequest } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, req: { tenantIds: DEFAULT_TENANT_IDS } };
  }
  if (typeof raw !== 'object') return { ok: false, error: 'body must be an object or absent' };
  const r = raw as Record<string, unknown>;
  if (r.tenantIds === undefined) {
    return { ok: true, req: { tenantIds: DEFAULT_TENANT_IDS } };
  }
  if (!Array.isArray(r.tenantIds)) {
    return { ok: false, error: 'tenantIds must be an array of strings if provided' };
  }
  if (r.tenantIds.length === 0) {
    return { ok: false, error: 'tenantIds must not be empty' };
  }
  if (r.tenantIds.length > 20) {
    return { ok: false, error: 'tenantIds must not exceed 20 entries per call' };
  }
  const seen = new Set<string>();
  for (const id of r.tenantIds) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) {
      return { ok: false, error: `tenantId ${JSON.stringify(id)} invalid (1..64 chars)` };
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      return {
        ok: false,
        error: `tenantId ${id} must contain only lowercase letters, digits, hyphens`,
      };
    }
    if (seen.has(id)) {
      return { ok: false, error: `tenantId ${id} duplicated` };
    }
    seen.add(id);
  }
  return { ok: true, req: { tenantIds: r.tenantIds as readonly string[] } };
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

  // Tighter rate limit than single-tenant bootstrap because each
  // call fans out to six Asana provisionings.
  const rl = await checkRateLimit(req, {
    max: 2,
    clientIp: context.ip,
    namespace: 'setup-asana-bootstrap-all',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: unknown = null;
  const rawText = await req.text().catch(() => '');
  if (rawText.length > 0) {
    try {
      body = JSON.parse(rawText);
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }

  const v = validate(body);
  if (!v.ok) return jsonResponse({ error: v.error }, { status: 400 });

  const accessToken = process.env.ASANA_ACCESS_TOKEN;
  const workspaceGid = process.env.ASANA_WORKSPACE_GID;
  if (!accessToken || accessToken.length < 16) {
    return jsonResponse(
      { error: 'ASANA_ACCESS_TOKEN env var missing or invalid' },
      { status: 503 }
    );
  }
  if (!workspaceGid || workspaceGid.length === 0) {
    return jsonResponse({ error: 'ASANA_WORKSPACE_GID env var missing' }, { status: 503 });
  }

  const rawOrigin = (process.env.HAWKEYE_ALLOWED_ORIGIN ?? '').trim();
  if (!rawOrigin) {
    return jsonResponse(
      {
        error: 'HAWKEYE_ALLOWED_ORIGIN env var missing',
        hint: 'Asana webhook targets must be absolute https:// URLs.',
      },
      { status: 503 }
    );
  }
  let originUrl: URL;
  try {
    originUrl = new URL(rawOrigin);
  } catch {
    return jsonResponse(
      { error: 'HAWKEYE_ALLOWED_ORIGIN is not a valid URL', value: rawOrigin },
      { status: 503 }
    );
  }
  if (originUrl.protocol !== 'https:') {
    return jsonResponse(
      { error: 'HAWKEYE_ALLOWED_ORIGIN must use https scheme', value: rawOrigin },
      { status: 503 }
    );
  }
  const origin = rawOrigin.replace(/\/+$/, '');
  const webhookTarget = `${origin}/api/asana/webhook?workspaceGid=${encodeURIComponent(workspaceGid)}`;

  // One dispatcher instance, reused across the whole batch. Each
  // Asana request inside provisionTenant goes through its own
  // 30-second abort signal so a slow tenant does not stall the
  // whole batch unboundedly.
  const dispatcher = makeAsanaDispatcher(accessToken);

  const stateDisabled = (() => {
    const raw = process.env.ASANA_WD_STATE_RECORDING_DISABLED;
    if (!raw) return false;
    const s = String(raw).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
  })();

  const tenantOutcomes: Array<{
    tenantId: string;
    ok: boolean;
    projectGid?: string;
    webhookGid?: string;
    summary?: string;
    stepCount?: number;
    error?: string;
  }> = [];

  for (const tenantId of v.req.tenantIds) {
    const plan = tenantProvisioningPlan(tenantId, { workspaceGid, webhookTarget });
    const CANON = [
      'validate_inputs',
      'create_project_compliance',
      'create_project_workflow',
      'create_sections',
      'provision_custom_fields',
      'emit_custom_field_env_vars',
      'register_webhook',
      'seed_idempotency_namespace',
      'write_registry_row',
    ] as const;

    let result: Awaited<ReturnType<typeof provisionTenant>> | null = null;
    let threwError: string | null = null;
    try {
      result = await provisionTenant(plan, dispatcher);
    } catch (err) {
      threwError = err instanceof Error ? err.message : String(err);
    }

    const nowMs = Date.now();

    // Setup audit row — mirrors single-tenant bootstrap format.
    try {
      const audit = getStore('setup-audit');
      await audit.setJSON(`asana-bootstrap/${tenantId}/${Date.now()}.json`, {
        tsIso: new Date().toISOString(),
        userId: auth.userId,
        tenantId,
        projectGid: result?.projectGid,
        webhookGid: result?.webhookGid,
        ok: result?.ok ?? false,
        stepCount: result?.steps.length ?? 0,
        thrown: threwError,
        batched: true,
      });
    } catch {
      // non-fatal
    }

    // Phase 19 W-D state recording.
    if (!stateDisabled) {
      try {
        const stateStore = getStore('asana-tenant-bootstrap-state');
        const steps: Record<
          string,
          {
            name: string;
            state: 'done' | 'failed';
            updatedAtMs: number;
            error?: string;
          }
        > = {};
        if (threwError || !result?.ok) {
          steps['validate_inputs'] = {
            name: 'validate_inputs',
            state: 'done',
            updatedAtMs: nowMs,
          };
          steps['create_project_compliance'] = {
            name: 'create_project_compliance',
            state: 'failed',
            updatedAtMs: nowMs,
            error:
              threwError ?? 'provisionTenant reported ok=false. See summary for dispatcher detail.',
          };
        } else {
          for (const step of CANON) {
            steps[step] = { name: step, state: 'done', updatedAtMs: nowMs };
          }
        }
        await stateStore.setJSON(`tenant:${tenantId}.json`, {
          tenantId,
          startedAtMs: nowMs,
          steps,
        });
      } catch {
        // non-fatal
      }
    }

    if (threwError) {
      tenantOutcomes.push({ tenantId, ok: false, error: threwError });
    } else if (result) {
      tenantOutcomes.push({
        tenantId,
        ok: result.ok,
        projectGid: result.projectGid,
        webhookGid: result.webhookGid,
        summary: result.summary,
        stepCount: result.steps.length,
      });
    } else {
      tenantOutcomes.push({ tenantId, ok: false, error: 'unknown provisioner state' });
    }
  }

  const successes = tenantOutcomes.filter((t) => t.ok).length;
  const failures = tenantOutcomes.length - successes;

  return jsonResponse(
    {
      ok: failures === 0,
      tenantsRequested: v.req.tenantIds.length,
      successes,
      failures,
      tenantOutcomes,
    },
    { status: failures === 0 ? 200 : 207 }
  );
};

export const config: Config = {
  path: '/api/setup/asana-bootstrap-all',
  method: ['POST', 'OPTIONS'],
};
