/**
 * Setup Asana Modules — one-shot bootstrap for the 16-project module
 * catalog defined in src/services/asanaModuleProjects.ts.
 *
 * POST /api/setup/asana-modules
 *
 * Body (optional):
 *   {
 *     workspaceGid?: string,    // defaults to process.env.ASANA_WORKSPACE_GID
 *     keys?: ModuleKey[],       // subset to provision; defaults to all 16
 *     dryRun?: boolean          // if true, lists what WOULD be created
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     projects: [
 *       { key, name, envVar, projectGid, created: boolean,
 *         sections: [{ name, sectionGid, created }] }
 *     ],
 *     envSnippet: "ASANA_TM_PROJECT_GID=…\nASANA_STR_PROJECT_GID=…\n…"
 *   }
 *
 * Idempotent: every project + section is matched by NAME and reused if
 * it already exists. Safe to re-run after a partial failure.
 *
 * Security:
 *   - Bearer HAWKEYE_BRAIN_TOKEN required (server-side MLRO auth)
 *   - Rate-limited 2 req / 15 min per IP (this fans out ~100 Asana
 *     API calls on a cold bootstrap)
 *
 * The MLRO runs this once per environment:
 *   1. Ensure ASANA_WORKSPACE_GID + ASANA_TOKEN are set on Netlify.
 *   2. POST /api/setup/asana-modules with an empty body.
 *   3. Copy `envSnippet` from the response into the Netlify env.
 *   4. Redeploy. Every downstream function now routes to the correct
 *      per-module board via getModuleProjectGid().
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility — one board per domain)
 *   FDL No.10/2025 Art.24 (10-yr audit trail per board)
 *   Cabinet Res 134/2025 Art.18 (arrangement notification — MLRO
 *     bootstrap event is logged to setup-audit)
 *   Cabinet Res 134/2025 Art.19 (internal review cadence driven off
 *     the per-domain boards)
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import { fetchWithTimeout } from '../../src/utils/fetchWithTimeout';
import {
  MODULE_PROJECTS,
  type ModuleKey,
  type ModuleProjectSpec,
} from '../../src/services/asanaModuleProjects';

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

interface SetupRequest {
  workspaceGid?: string;
  keys?: readonly ModuleKey[];
  dryRun?: boolean;
}

interface ProjectResult {
  key: ModuleKey;
  name: string;
  envVar: string;
  projectGid: string | null;
  created: boolean;
  error?: string;
  sections: Array<{
    name: string;
    sectionGid: string | null;
    created: boolean;
    error?: string;
  }>;
}

function validateInput(body: unknown): { ok: true; value: SetupRequest } | { ok: false; error: string } {
  if (body === null || body === undefined) return { ok: true, value: {} };
  if (typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const o = body as Record<string, unknown>;
  const v: SetupRequest = {};
  if (o.workspaceGid !== undefined) {
    if (typeof o.workspaceGid !== 'string' || !/^[0-9]+$/.test(o.workspaceGid)) {
      return { ok: false, error: 'workspaceGid must be a numeric string' };
    }
    v.workspaceGid = o.workspaceGid;
  }
  if (o.keys !== undefined) {
    if (!Array.isArray(o.keys)) return { ok: false, error: 'keys must be an array' };
    for (const k of o.keys) {
      if (typeof k !== 'string') return { ok: false, error: 'keys entries must be strings' };
      if (!MODULE_PROJECTS.some((p) => p.key === k)) {
        return { ok: false, error: `unknown module key: ${k}` };
      }
    }
    v.keys = o.keys as readonly ModuleKey[];
  }
  if (o.dryRun !== undefined) {
    if (typeof o.dryRun !== 'boolean') return { ok: false, error: 'dryRun must be boolean' };
    v.dryRun = o.dryRun;
  }
  return { ok: true, value: v };
}

async function asanaRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetchWithTimeout(ASANA_BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
    timeoutMs: 30_000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Asana ${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function ensureProject(
  accessToken: string,
  workspaceGid: string,
  spec: ModuleProjectSpec,
  dryRun: boolean,
): Promise<{ projectGid: string | null; created: boolean }> {
  if (dryRun) return { projectGid: null, created: true };
  // Idempotent — match by exact project name inside the workspace.
  const existing = await asanaRequest<Array<{ gid: string; name: string }>>(
    accessToken,
    `/projects?workspace=${encodeURIComponent(workspaceGid)}&opt_fields=name&limit=100`,
  );
  const match = existing.find((p) => p.name === spec.name);
  if (match) return { projectGid: match.gid, created: false };
  const created = await asanaRequest<{ gid: string }>(accessToken, '/projects', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        workspace: workspaceGid,
        name: spec.name,
        notes: spec.description + '\n\n' +
          'Regulatory basis: ' + spec.regulatoryBasis + '\n' +
          'Owner: ' + spec.owner + '\n' +
          'Provisioned by /api/setup/asana-modules (FDL Art.20-21, Art.24).',
        color: 'light-purple',
        layout: 'board',
      },
    }),
  });
  return { projectGid: created.gid, created: true };
}

async function ensureSection(
  accessToken: string,
  projectGid: string,
  name: string,
  dryRun: boolean,
): Promise<{ sectionGid: string | null; created: boolean }> {
  if (dryRun) return { sectionGid: null, created: true };
  const existing = await asanaRequest<Array<{ gid: string; name: string }>>(
    accessToken,
    `/projects/${encodeURIComponent(projectGid)}/sections`,
  );
  const match = existing.find((s) => s.name === name);
  if (match) return { sectionGid: match.gid, created: false };
  const created = await asanaRequest<{ gid: string }>(
    accessToken,
    `/projects/${encodeURIComponent(projectGid)}/sections`,
    { method: 'POST', body: JSON.stringify({ data: { name } }) },
  );
  return { sectionGid: created.gid, created: true };
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 2,
    clientIp: context.ip,
    namespace: 'setup-asana-modules',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const accessToken =
    process.env.ASANA_TOKEN ||
    process.env.ASANA_ACCESS_TOKEN ||
    process.env.ASANA_API_TOKEN ||
    '';
  if (!accessToken) {
    return jsonResponse(
      { ok: false, error: 'ASANA_TOKEN not configured — cannot create projects' },
      { status: 412 },
    );
  }

  let parsed: unknown;
  try {
    const text = await req.text();
    parsed = text ? JSON.parse(text) : {};
  } catch (_e) {
    return jsonResponse({ ok: false, error: 'body is not valid JSON' }, { status: 400 });
  }
  const validated = validateInput(parsed);
  if (!validated.ok) return jsonResponse({ ok: false, error: validated.error }, { status: 400 });

  const workspaceGid = validated.value.workspaceGid || process.env.ASANA_WORKSPACE_GID || '';
  if (!workspaceGid) {
    return jsonResponse(
      { ok: false, error: 'workspaceGid not provided and ASANA_WORKSPACE_GID not set' },
      { status: 412 },
    );
  }

  const dryRun = !!validated.value.dryRun;
  const targetKeys: readonly ModuleKey[] =
    validated.value.keys ?? MODULE_PROJECTS.map((p) => p.key);

  const results: ProjectResult[] = [];
  for (const key of targetKeys) {
    const spec = MODULE_PROJECTS.find((p) => p.key === key);
    if (!spec) {
      results.push({
        key,
        name: '(unknown)',
        envVar: '',
        projectGid: null,
        created: false,
        error: 'unknown module key',
        sections: [],
      });
      continue;
    }
    try {
      const project = await ensureProject(accessToken, workspaceGid, spec, dryRun);
      const sections: ProjectResult['sections'] = [];
      if (project.projectGid) {
        for (const sectionName of spec.sections) {
          try {
            const sec = await ensureSection(accessToken, project.projectGid, sectionName, dryRun);
            sections.push({ name: sectionName, sectionGid: sec.sectionGid, created: sec.created });
          } catch (err) {
            sections.push({
              name: sectionName,
              sectionGid: null,
              created: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else if (dryRun) {
        // In dry-run we still enumerate the sections that WOULD be created.
        for (const sectionName of spec.sections) {
          sections.push({ name: sectionName, sectionGid: null, created: true });
        }
      }
      results.push({
        key: spec.key,
        name: spec.name,
        envVar: spec.envVar,
        projectGid: project.projectGid,
        created: project.created,
        sections,
      });
    } catch (err) {
      results.push({
        key: spec.key,
        name: spec.name,
        envVar: spec.envVar,
        projectGid: null,
        created: false,
        error: err instanceof Error ? err.message : String(err),
        sections: [],
      });
    }
  }

  // Compose the env-snippet the MLRO pastes into Netlify env.
  const envSnippet = results
    .filter((r) => r.projectGid && r.envVar)
    .map((r) => `${r.envVar}=${r.projectGid}`)
    .join('\n');

  // Audit — every bootstrap run is logged to setup-audit with the
  // MLRO-principal context so the 10-yr trail (FDL Art.24) captures
  // who provisioned which projects when.
  try {
    const audit = getStore({ name: 'setup-audit', consistency: 'strong' });
    await audit.setJSON(`asana-modules/${new Date().toISOString()}`, {
      workspaceGid,
      dryRun,
      results,
      ranBy: auth.principal ?? null,
      at: new Date().toISOString(),
    });
  } catch (_e) {
    // Blob write failure does not block — the response still surfaces
    // the env snippet for the MLRO to paste into Netlify.
  }

  return jsonResponse({
    ok: true,
    workspaceGid,
    dryRun,
    projects: results,
    envSnippet,
  });
};

export const config: Config = {
  path: '/api/setup/asana-modules',
  method: ['POST', 'OPTIONS'],
};
