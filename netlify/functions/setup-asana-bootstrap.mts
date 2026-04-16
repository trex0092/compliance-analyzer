/**
 * Setup Asana Bootstrap — runs the idempotent per-tenant Asana
 * provisioning plan via an HTTP endpoint so operators can do it
 * from the browser-only setup.html wizard.
 *
 * POST /api/setup/asana-bootstrap
 *
 * Body:
 *   { tenantId: "tenant-a" }
 *
 * What it does:
 *   1. Reads ASANA_ACCESS_TOKEN + ASANA_WORKSPACE_GID from env
 *   2. Builds the tenantProvisioningPlan (pure)
 *   3. Walks the plan via an injected Asana HTTP dispatcher
 *   4. Returns the per-step audit trail + the final project GID
 *
 * Idempotent: safe to re-run. Existing projects/sections/fields are
 * reused, not duplicated.
 *
 * Security:
 *   POST + OPTIONS
 *   Bearer HAWKEYE_BRAIN_TOKEN required
 *   Rate limited 5 / 15 min (write-heavy endpoint)
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility)
 *   FDL No.10/2025 Art.24    (provisioning audit trail)
 *   Cabinet Res 134/2025 Art.12-14, Art.19
 *   Cabinet Res 74/2020 Art.4-7
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

// ---------------------------------------------------------------------------
// Asana HTTP dispatcher — thin wrapper over fetch
// ---------------------------------------------------------------------------

function makeAsanaDispatcher(accessToken: string): AsanaProvisionDispatcher {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  async function asanaRequest<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<T> {
    const res = await fetch(ASANA_BASE + path, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Asana ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data: T };
    return json.data;
  }

  return {
    async ensureProject({ workspaceGid, name, color, layout }) {
      // Look for existing project by name under the workspace.
      const existing = await asanaRequest<Array<{ gid: string; name: string }>>(
        `/projects?workspace=${encodeURIComponent(workspaceGid)}&opt_fields=name`
      );
      const match = existing.find((p) => p.name === name);
      if (match) return { projectGid: match.gid, created: false };

      const created = await asanaRequest<{ gid: string }>('/projects', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            workspace: workspaceGid,
            name,
            color: mapColor(color),
            layout,
          },
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
        {
          method: 'POST',
          body: JSON.stringify({ data: { name } }),
        }
      );
      return { sectionGid: created.gid, created: true };
    },

    async ensureCustomField({ workspaceGid, field }) {
      // Look for existing workspace custom field by name.
      const existing = await asanaRequest<Array<{ gid: string; name: string }>>(
        `/workspaces/${encodeURIComponent(workspaceGid)}/custom_fields?opt_fields=name`
      );
      const match = existing.find((f) => f.name === field.name);
      if (match) return { fieldGid: match.gid, created: false };

      // Build the data payload — the shape depends on the field type.
      // Asana rejects unrecognised colors (e.g. `light-gray`) with 403,
      // and rejects number fields without `precision` with 400 — so we
      // omit color entirely (Asana picks a default) and always pass
      // precision for number fields.
      const data: Record<string, unknown> = {
        workspace: workspaceGid,
        name: field.name,
        resource_subtype: mapFieldType(field),
      };
      if (field.type === 'enum') {
        data.enum_options = (field.enumValues ?? []).map((v) => ({
          name: v,
          // Use 'cool-gray' — the only neutral gray Asana actually
          // accepts. Omitting color entirely also works but the API
          // is undocumented on what it picks; cool-gray is explicit.
          color: 'cool-gray',
        }));
      } else if (field.type === 'number') {
        // Asana requires precision (decimal places) on number fields.
        // 2 covers Confidence (0.00..1.00) and Power Score (0.00..100.00)
        // and any other 2-decimal metric we currently use.
        data.precision = 2;
      }

      const created = await asanaRequest<{ gid: string }>('/custom_fields', {
        method: 'POST',
        body: JSON.stringify({ data }),
      });
      return { fieldGid: created.gid, created: true };
    },

    async ensureWebhook({ projectGid, target }) {
      // Check for existing webhook pointing at the target.
      const existing = await asanaRequest<Array<{ gid: string; resource: { gid: string }; target: string }>>(
        `/webhooks?workspace=${encodeURIComponent(process.env.ASANA_WORKSPACE_GID ?? '')}&opt_fields=target,resource`
      ).catch(() => [] as Array<{ gid: string; resource: { gid: string }; target: string }>);
      const match = existing.find(
        (w) => w.resource.gid === projectGid && w.target === target
      );
      if (match) return { webhookGid: match.gid, created: false };

      const created = await asanaRequest<{ gid: string }>('/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          data: {
            resource: projectGid,
            target,
          },
        }),
      });
      return { webhookGid: created.gid, created: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers — map our internal types to Asana's API enums
// ---------------------------------------------------------------------------

function mapColor(hex: string): string {
  // Asana accepts a fixed palette. Map the nearest.
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
      // Asana custom fields don't support task_reference natively — fall back to text.
      return 'text';
    default:
      return 'text';
  }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

interface BootstrapRequest {
  tenantId: string;
}

function validate(raw: unknown): { ok: true; req: BootstrapRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== 'string' || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: 'tenantId must be 1..64 chars' };
  }
  if (!/^[a-z0-9-]+$/.test(r.tenantId)) {
    return { ok: false, error: 'tenantId must contain only lowercase letters, digits, and hyphens' };
  }
  return { ok: true, req: { tenantId: r.tenantId } };
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
    max: 5,
    clientIp: context.ip,
    namespace: 'setup-asana-bootstrap',
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
    return jsonResponse(
      { error: 'ASANA_WORKSPACE_GID env var missing' },
      { status: 503 }
    );
  }

  // The receiver function lives at /api/asana/webhook (see
  // netlify/functions/asana-webhook.mts) and expects ?workspaceGid=<gid>
  // as a query param so it can look up the right webhook secret per
  // workspace. The previous /api/asana-webhook URL was a 404 →
  // Asana's handshake POST got 404 → registration failed.
  //
  // Asana requires an absolute https:// URL for the webhook target.
  // If HAWKEYE_ALLOWED_ORIGIN is missing or relative, the request will
  // 404 on Asana's side with an opaque error. Fail fast here so the
  // operator sees a clear diagnostic instead of a mysterious Asana
  // rejection during tenant bootstrap.
  const rawOrigin = (process.env.HAWKEYE_ALLOWED_ORIGIN ?? '').trim();
  if (!rawOrigin) {
    return jsonResponse(
      {
        error: 'HAWKEYE_ALLOWED_ORIGIN env var missing',
        hint:
          'Asana webhook targets must be absolute https:// URLs. Set HAWKEYE_ALLOWED_ORIGIN to the public origin of this deployment (e.g. https://hawkeye-sterling-v2.netlify.app) before running tenant bootstrap.',
      },
      { status: 503 }
    );
  }
  let originUrl: URL;
  try {
    originUrl = new URL(rawOrigin);
  } catch {
    return jsonResponse(
      {
        error: 'HAWKEYE_ALLOWED_ORIGIN is not a valid URL',
        value: rawOrigin,
      },
      { status: 503 }
    );
  }
  if (originUrl.protocol !== 'https:') {
    return jsonResponse(
      {
        error: 'HAWKEYE_ALLOWED_ORIGIN must use https scheme',
        value: rawOrigin,
        hint: 'Asana webhook handshakes require TLS. Non-https origins are rejected.',
      },
      { status: 503 }
    );
  }
  const origin = rawOrigin.replace(/\/+$/, '');
  const webhookTarget = `${origin}/api/asana/webhook?workspaceGid=${encodeURIComponent(workspaceGid)}`;

  // Build the plan (pure).
  const plan = tenantProvisioningPlan(v.req.tenantId, {
    workspaceGid,
    webhookTarget,
  });

  // Run the dispatcher.
  let result;
  try {
    const dispatcher = makeAsanaDispatcher(accessToken);
    result = await provisionTenant(plan, dispatcher);
  } catch (err) {
    return jsonResponse(
      {
        error: 'asana_bootstrap_failed',
        reason: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // Audit log.
  try {
    const audit = getStore('setup-audit');
    await audit.setJSON(
      `asana-bootstrap/${v.req.tenantId}/${Date.now()}.json`,
      {
        tsIso: new Date().toISOString(),
        userId: auth.userId,
        tenantId: v.req.tenantId,
        projectGid: result.projectGid,
        webhookGid: result.webhookGid,
        ok: result.ok,
        stepCount: result.steps.length,
      }
    );
  } catch {
    // non-fatal
  }

  return jsonResponse(
    {
      ok: result.ok,
      tenantId: v.req.tenantId,
      projectGid: result.projectGid,
      webhookGid: result.webhookGid,
      summary: result.summary,
      stepCount: result.steps.length,
      steps: result.steps,
      plan: {
        projectName: plan.projectName,
        sectionCount: plan.sections.length,
        customFieldCount: plan.customFields.length,
        webhookTarget: plan.webhookTarget,
      },
      regulatory: plan.regulatory,
    },
    { status: result.ok ? 200 : 502 }
  );
};

export const config: Config = {
  path: '/api/setup/asana-bootstrap',
  method: ['POST', 'OPTIONS'],
};

// Exported for tests.
export const __test__ = { validate, mapColor, mapFieldType };
