/**
 * Asana Task Create — unified task-creation endpoint for the four
 * MLRO operational surfaces that each own a dedicated Asana project:
 *
 *   workbench       → ASANA_WORKBENCH_PROJECT_GID      (Workbench — MLRO Console)
 *   logistics       → ASANA_LOGISTICS_PROJECT_GID      (Logistics — Shipments)
 *   compliance-ops  → ASANA_CENTRAL_MLRO_PROJECT_GID   (HAWKEYE — tenant-a)
 *   routines        → ASANA_ROUTINES_PROJECT_GID       (Routines — Daily/Weekly/Monthly)
 *
 * POST /api/asana/task
 *   body = {
 *     source: 'workbench' | 'logistics' | 'compliance-ops' | 'routines' | 'screening',
 *     name: string,              // task title (max 512 chars)
 *     notes: string,              // task body (max 16 KiB)
 *     category?: string,          // free-form tag, max 64 chars
 *     priority?: 'low' | 'medium' | 'high' | 'critical',
 *     dueOn?: string,             // YYYY-MM-DD
 *     citation?: string,          // regulatory citation (max 256 chars)
 *     entity?: string,            // linked customer/counterparty (max 256 chars)
 *     assignee?: string,          // free-form display name, mirrored in notes
 *   }
 *
 * Auth: Bearer HAWKEYE_BRAIN_TOKEN.
 * Rate limit: 30 req / 15 min per IP, per surface.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO operational duties)
 *   FDL No.10/2025 Art.24    (10-year audit retention — every
 *                              surface task is an audit artefact)
 *   Cabinet Res 134/2025 Art.19 (internal reporting / escalation)
 */

import type { Context } from '@netlify/functions';
import { authenticate } from './middleware/auth.mts';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { createAsanaTask } from '../../src/services/asanaClient';

const MAX_BODY_SIZE = 32 * 1024;

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

type Surface = 'workbench' | 'logistics' | 'compliance-ops' | 'routines' | 'screening';

const SURFACE_CONFIG: Record<
  Surface,
  { envVar: string; projectName: string; prefix: string }
> = {
  workbench: {
    envVar: 'ASANA_WORKBENCH_PROJECT_GID',
    projectName: 'Workbench — MLRO Console',
    prefix: 'WB',
  },
  logistics: {
    // The legacy ASANA_LOGISTICS_PROJECT_GID slot was retired from
    // the 19-project catalog on 2026-04-21 (the MLRO confirmed
    // deletion from Netlify env on the same day). Its successor in
    // the locked catalog is "Shipments — Tracking" → ASANA_SHIPMENTS_PROJECT_GID.
    // Mapping the 'logistics' surface here keeps the /logistics
    // landing page's "Send to Asana" button working after the env
    // var rename, and avoids the HTTP 503 "LOGISTICS not configured"
    // failure mode that would otherwise blow up every click.
    envVar: 'ASANA_SHIPMENTS_PROJECT_GID',
    projectName: 'Shipments — Tracking',
    prefix: 'LOG',
  },
  'compliance-ops': {
    envVar: 'ASANA_CENTRAL_MLRO_PROJECT_GID',
    projectName: 'HAWKEYE — tenant-a',
    prefix: 'COMP',
  },
  routines: {
    envVar: 'ASANA_ROUTINES_PROJECT_GID',
    projectName: 'Routines — Daily / Weekly / Monthly',
    prefix: 'RTN',
  },
  // Added 2026-04-21 so the Screening Command "SEND TO ASANA" button
  // has a dedicated target. Previously the client shoehorned these
  // tasks into 'compliance-ops' (wrong project) via the wrong payload
  // key ('surface' instead of 'source'), producing HTTP 400. Now they
  // route cleanly to #1 in the 19-project catalog — the flagship
  // Screening & Adverse Media board.
  screening: {
    envVar: 'ASANA_SCREENINGS_PROJECT_GID',
    projectName: 'Screening — Sanctions & Adverse Media',
    prefix: 'SCR',
  },
};

function isSurface(v: unknown): v is Surface {
  return (
    v === 'workbench' ||
    v === 'logistics' ||
    v === 'compliance-ops' ||
    v === 'routines' ||
    v === 'screening'
  );
}

function isPriority(v: unknown): v is 'low' | 'medium' | 'high' | 'critical' {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical';
}

interface TaskInput {
  source: Surface;
  name: string;
  notes: string;
  category?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  dueOn?: string;
  citation?: string;
  entity?: string;
  assignee?: string;
}

function validateInput(raw: unknown): { ok: true; input: TaskInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const o = raw as Record<string, unknown>;

  if (!isSurface(o.source)) {
    return {
      ok: false,
      error: 'source must be one of: workbench, logistics, compliance-ops, routines, screening',
    };
  }
  if (typeof o.name !== 'string' || o.name.trim().length === 0 || o.name.length > 512) {
    return { ok: false, error: 'name is required (1..512 chars)' };
  }
  if (typeof o.notes !== 'string' || o.notes.length > 16 * 1024) {
    return { ok: false, error: 'notes must be a string (max 16 KiB)' };
  }
  if (o.category !== undefined && (typeof o.category !== 'string' || o.category.length > 64)) {
    return { ok: false, error: 'category must be a string (max 64 chars)' };
  }
  if (o.priority !== undefined && !isPriority(o.priority)) {
    return { ok: false, error: 'priority must be low|medium|high|critical' };
  }
  if (o.dueOn !== undefined) {
    if (typeof o.dueOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.dueOn)) {
      return { ok: false, error: 'dueOn must be YYYY-MM-DD' };
    }
  }
  if (o.citation !== undefined && (typeof o.citation !== 'string' || o.citation.length > 256)) {
    return { ok: false, error: 'citation must be a string (max 256 chars)' };
  }
  if (o.entity !== undefined && (typeof o.entity !== 'string' || o.entity.length > 256)) {
    return { ok: false, error: 'entity must be a string (max 256 chars)' };
  }
  if (o.assignee !== undefined && (typeof o.assignee !== 'string' || o.assignee.length > 128)) {
    return { ok: false, error: 'assignee must be a string (max 128 chars)' };
  }

  return {
    ok: true,
    input: {
      source: o.source,
      name: o.name.trim(),
      notes: typeof o.notes === 'string' ? o.notes : '',
      category: o.category ? (o.category as string).trim() : undefined,
      priority: o.priority,
      dueOn: o.dueOn as string | undefined,
      citation: o.citation ? (o.citation as string).trim() : undefined,
      entity: o.entity ? (o.entity as string).trim() : undefined,
      assignee: o.assignee ? (o.assignee as string).trim() : undefined,
    },
  };
}

function buildTaskNotes(input: TaskInput, projectName: string): string {
  const lines: string[] = [];
  lines.push(input.notes.trim());
  lines.push('');
  lines.push('— Metadata —');
  lines.push(`Source: /api/asana/task (${input.source})`);
  lines.push(`Destination: ${projectName}`);
  if (input.category) lines.push(`Category: ${input.category}`);
  if (input.priority) lines.push(`Priority: ${input.priority}`);
  if (input.assignee) lines.push(`Assignee (display): ${input.assignee}`);
  if (input.entity) lines.push(`Linked entity: ${input.entity}`);
  if (input.citation) lines.push(`Regulatory basis: ${input.citation}`);
  lines.push(`Created at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push(
    'Audit: recorded under FDL No.(10)/2025 Art.24 (10yr retention). Do NOT disclose to the subject — Art.29.'
  );
  return lines.join('\n');
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method not allowed' }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 30,
    clientIp: context.ip,
    namespace: 'asana-task-create',
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_BODY_SIZE) {
      return jsonResponse({ ok: false, error: 'request body too large' }, { status: 413 });
    }
  }

  let parsed: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_SIZE) {
      return jsonResponse({ ok: false, error: 'request body too large' }, { status: 413 });
    }
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const v = validateInput(parsed);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, { status: 400 });

  const input = v.input;
  const surface = SURFACE_CONFIG[input.source];
  const projectGid = process.env[surface.envVar];

  if (!projectGid) {
    return jsonResponse(
      {
        ok: false,
        error: `${surface.envVar} not configured — set the project GID in Netlify environment`,
        source: input.source,
      },
      { status: 503 }
    );
  }
  if (
    !process.env.ASANA_TOKEN &&
    !process.env.ASANA_ACCESS_TOKEN &&
    !process.env.ASANA_API_TOKEN
  ) {
    return jsonResponse(
      { ok: false, error: 'ASANA_TOKEN not configured', source: input.source },
      { status: 503 }
    );
  }

  const title =
    input.priority && (input.priority === 'high' || input.priority === 'critical')
      ? `[${surface.prefix}:${input.priority.toUpperCase()}] ${input.name}`
      : `[${surface.prefix}] ${input.name}`;

  const tags = ['mlro-surface', input.source];
  if (input.category) tags.push(input.category);
  if (input.priority) tags.push(input.priority);

  const result = await createAsanaTask({
    name: title,
    notes: buildTaskNotes(input, surface.projectName),
    projects: [projectGid],
    due_on: input.dueOn,
    tags,
  });

  if (!result.ok) {
    return jsonResponse(
      {
        ok: false,
        error: result.error ?? 'Asana task creation failed',
        source: input.source,
        projectGid,
        projectName: surface.projectName,
      },
      { status: 502 }
    );
  }

  return jsonResponse({
    ok: true,
    source: input.source,
    gid: result.gid,
    projectGid,
    projectName: surface.projectName,
    url: result.gid ? `https://app.asana.com/0/${projectGid}/${result.gid}` : null,
  });
};

export const __test__ = { validateInput, buildTaskNotes, SURFACE_CONFIG };
