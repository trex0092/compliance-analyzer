/**
 * Brain Hydrate — on-demand memory warm-up endpoint.
 *
 * POST /api/brain/hydrate
 *
 * Forces a BlobBrainMemoryStore to reload a specific tenant's full
 * case history from Netlify Blobs into the in-process cache. Useful
 * right after a deploy (all function instances are cold) or when an
 * MLRO has bulk-loaded historical snapshots into the blob store via
 * tfs-refresh.js and wants the next brain-analyze call to see them
 * immediately without waiting for lazy hydration.
 *
 * Security:
 *   - POST only, CORS preflight allowed
 *   - authenticate() against HAWKEYE_BRAIN_TOKEN (fails closed)
 *   - Rate limit: auth-tier (5 / 15 min / IP) because hydrate
 *     pays a proportional blob read cost per tenant
 *   - Strict payload: only tenantId, max 64 chars
 *
 * Response:
 *   { ok: true, tenantId, hydrated, cacheSizeAfter, durationMs }
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty — cross-case visibility)
 *   FDL No.10/2025 Art.24    (10-year retention — memory is
 *                             an audit artifact)
 *   Cabinet Res 134/2025 Art.19 (internal review visibility)
 */

import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticate } from "./middleware/auth.mts";
import {
  BlobBrainMemoryStore,
  createNetlifyBlobHandle,
} from "../../src/services/brainMemoryBlobStore";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.HAWKEYE_ALLOWED_ORIGIN ??
    "https://compliance-analyzer.netlify.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
} as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, ...(init.headers ?? {}) },
  });
}

// Singleton per function instance — same pattern as brain-analyze.
const memoryStore: BlobBrainMemoryStore | null = (() => {
  try {
    const store = getStore("brain-memory");
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    return new BlobBrainMemoryStore(handle);
  } catch {
    return null;
  }
})();

function validate(
  input: unknown
): { ok: true; tenantId: string } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const raw = input as Record<string, unknown>;
  if (
    typeof raw.tenantId !== "string" ||
    raw.tenantId.length === 0 ||
    raw.tenantId.length > 64
  ) {
    return { ok: false, error: "tenantId must be a non-empty string (<=64)" };
  }
  return { ok: true, tenantId: raw.tenantId };
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  // Tighter rate limit — hydrate is expensive.
  const rl = await checkRateLimit(req, {
    max: 5,
    clientIp: context.ip,
    namespace: "brain-hydrate",
  });
  if (rl) return rl;

  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const v = validate(body);
  if (!v.ok) {
    console.warn(
      `[BRAIN-HYDRATE] Rejected input from ${auth.userId}: ${v.error}`
    );
    return jsonResponse({ error: v.error }, { status: 400 });
  }
  const tenantId = v.tenantId;

  if (!memoryStore) {
    return jsonResponse(
      {
        ok: false,
        error: "blob_store_unavailable",
        reason:
          "Netlify Blob store is not reachable from this function instance.",
      },
      { status: 503 }
    );
  }

  const started = Date.now();
  let hydrated: number;
  try {
    hydrated = await memoryStore.hydrate(tenantId);
  } catch (err) {
    console.error(
      `[BRAIN-HYDRATE] hydrate failed for ${tenantId}:`,
      err instanceof Error ? err.message : String(err)
    );
    return jsonResponse(
      { error: "hydrate_failed", reason: "blob read error" },
      { status: 500 }
    );
  }

  const cacheSizeAfter = memoryStore.sizeForTenant(tenantId);
  const durationMs = Date.now() - started;

  console.log(
    `[BRAIN-HYDRATE] ${auth.userId} tenant=${tenantId} hydrated=${hydrated} cache=${cacheSizeAfter} ms=${durationMs}`
  );

  return jsonResponse({
    ok: true,
    tenantId,
    hydrated,
    cacheSizeAfter,
    durationMs,
  });
};

export const config: Config = {
  path: "/api/brain/hydrate",
  method: ["POST", "OPTIONS"],
};

export const __test__ = { validate };
