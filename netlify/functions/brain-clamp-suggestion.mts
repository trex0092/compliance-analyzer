/**
 * Brain Clamp Suggestion — MLRO-reviewed threshold tuning endpoint.
 *
 * POST /api/brain/clamp-suggestion
 *
 * Actions:
 *   propose — feed evidence signals and receive a pending suggestion
 *   decide  — flip a suggestion status (accepted | rejected | deferred)
 *   list    — return every suggestion matching optional status filter
 *
 * Security:
 *   POST only + OPTIONS, authenticate against HAWKEYE_BRAIN_TOKEN,
 *   rate limit 100 / 15min / IP, strict input validation.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22, Art.24
 *   Cabinet Res 134/2025 Art.19
 *   NIST AI RMF 1.0 GOVERN-4
 *   EU AI Act Art.14
 */

import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { checkRateLimit } from './middleware/rate-limit.mts';
import { authenticate } from './middleware/auth.mts';
import {
  buildClampSuggestion,
  type ClampKey,
  type EvidenceSignal,
  type SuggestionStatus,
} from '../../src/services/clampSuggestionLog';
import { ClampSuggestionBlobStore } from '../../src/services/tierCBlobStores';
import { createNetlifyBlobHandle } from '../../src/services/brainMemoryBlobStore';
import { createTierCAsanaDispatcher } from '../../src/services/asana/tierCAsanaDispatch';
import { orchestrator as defaultOrchestrator } from '../../src/services/asana/orchestrator';

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

const store: ClampSuggestionBlobStore | null = (() => {
  try {
    const blob = getStore('brain-memory');
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => blob.get(key, opts),
      setJSON: (key, value) => blob.setJSON(key, value),
      delete: (key) => blob.delete(key),
    });
    return new ClampSuggestionBlobStore(handle);
  } catch {
    return null;
  }
})();

const CLAMP_KEYS: readonly ClampKey[] = [
  'sanctionsMatchMin',
  'ensembleStabilityThreshold',
  'uncertaintyCriticalWidth',
  'debateThreshold',
  'dpmsCashThresholdAED',
  'crossBorderCashThresholdAED',
];

const DECIDE_STATUSES: readonly SuggestionStatus[] = ['accepted', 'rejected', 'deferred'];

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function validate(
  raw: unknown
):
  | { ok: true; action: 'propose'; input: Parameters<typeof buildClampSuggestion>[0] }
  | { ok: true; action: 'decide'; id: string; status: SuggestionStatus }
  | { ok: true; action: 'list'; filter: SuggestionStatus | null }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be an object' };
  const r = raw as Record<string, unknown>;
  const action = r.action;

  if (action === 'list') {
    if (r.statusFilter !== undefined && typeof r.statusFilter !== 'string') {
      return { ok: false, error: 'statusFilter must be a string' };
    }
    const filter =
      typeof r.statusFilter === 'string' && r.statusFilter.length > 0
        ? (r.statusFilter as SuggestionStatus)
        : null;
    return { ok: true, action: 'list', filter };
  }

  if (action === 'decide') {
    if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 256) {
      return { ok: false, error: 'id must be a non-empty string (<=256)' };
    }
    if (typeof r.status !== 'string' || !DECIDE_STATUSES.includes(r.status as SuggestionStatus)) {
      return {
        ok: false,
        error: `status must be one of ${DECIDE_STATUSES.join(', ')}`,
      };
    }
    return { ok: true, action: 'decide', id: r.id, status: r.status as SuggestionStatus };
  }

  if (action === 'propose') {
    if (typeof r.clampKey !== 'string' || !CLAMP_KEYS.includes(r.clampKey as ClampKey)) {
      return { ok: false, error: `clampKey must be one of ${CLAMP_KEYS.join(', ')}` };
    }
    if (!isFiniteNum(r.currentValue)) return { ok: false, error: 'currentValue must be number' };
    if (!isFiniteNum(r.minValue)) return { ok: false, error: 'minValue must be number' };
    if (!isFiniteNum(r.maxValue)) return { ok: false, error: 'maxValue must be number' };
    if (!isFiniteNum(r.step) || r.step <= 0) {
      return { ok: false, error: 'step must be positive number' };
    }
    if (typeof r.regulatory !== 'string' || r.regulatory.length === 0) {
      return { ok: false, error: 'regulatory must be non-empty string' };
    }
    const ev = r.evidence as Record<string, unknown> | undefined;
    if (!ev || typeof ev !== 'object') {
      return { ok: false, error: 'evidence must be an object' };
    }
    const evidence: EvidenceSignal = {
      truePositive: isFiniteNum(ev.truePositive) ? ev.truePositive : 0,
      falsePositive: isFiniteNum(ev.falsePositive) ? ev.falsePositive : 0,
      falseNegative: isFiniteNum(ev.falseNegative) ? ev.falseNegative : 0,
      totalCases: isFiniteNum(ev.totalCases) ? ev.totalCases : 0,
    };
    return {
      ok: true,
      action: 'propose',
      input: {
        clampKey: r.clampKey as ClampKey,
        currentValue: r.currentValue as number,
        minValue: r.minValue as number,
        maxValue: r.maxValue as number,
        step: r.step as number,
        regulatory: r.regulatory as string,
        evidence,
      },
    };
  }

  return { ok: false, error: 'action must be propose | decide | list' };
}

export default async (req: Request, context: Context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: 'brain-clamp-suggestion',
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
  if (!v.ok) {
    console.warn(`[BRAIN-CLAMP-SUGGESTION] Rejected from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  if (!store) return jsonResponse({ error: 'clamp_store_unavailable' }, { status: 503 });

  if (v.action === 'propose') {
    const suggestion = buildClampSuggestion(v.input);
    if (!suggestion) {
      return jsonResponse({ ok: true, suggestion: null, reason: 'evidence_insufficient' });
    }
    store.append(suggestion);
    await store.flush();
    // Fire-and-forget dispatch to Asana so MLROs see the pending
    // suggestion without opening a separate dashboard. Dispatch
    // failures never roll back — the blob store is the source of
    // truth and the Asana task is a mirror.
    try {
      const dispatcher = createTierCAsanaDispatcher(defaultOrchestrator);
      const tenantId = (body as { tenantId?: string }).tenantId ?? 'default';
      await dispatcher.dispatchClampSuggestion(suggestion, tenantId);
    } catch (err) {
      console.warn(
        '[BRAIN-CLAMP-SUGGESTION] asana dispatch failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
    return jsonResponse({ ok: true, suggestion });
  }

  if (v.action === 'decide') {
    const ok = await store.decide(v.id, v.status);
    return jsonResponse({ ok }, { status: ok ? 200 : 404 });
  }

  // list
  const all = await store.all();
  const filtered = v.filter ? all.filter((e) => e.status === v.filter) : all;
  return jsonResponse({ ok: true, suggestions: filtered });
};

export const config: Config = {
  path: '/api/brain/clamp-suggestion',
  method: ['POST', 'OPTIONS'],
};

export const __test__ = { validate };
