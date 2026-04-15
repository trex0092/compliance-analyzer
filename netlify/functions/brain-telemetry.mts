/**
 * Brain Telemetry — time-series query endpoint.
 *
 * POST /api/brain/telemetry
 *
 * Reads a per-tenant date range from the BrainTelemetryStore and
 * returns a rolled-up aggregate suitable for a Brain Console trend
 * chart. The endpoint never writes — writes happen implicitly
 * inside /api/brain/analyze on every decision.
 *
 * Request body:
 *   { tenantId: string, startIso: YYYY-MM-DD, endIso: YYYY-MM-DD }
 *
 * Response:
 *   { ok, aggregate: TelemetryAggregate }
 *
 * Security:
 *   - POST only (+ OPTIONS preflight)
 *   - authenticate() against HAWKEYE_BRAIN_TOKEN
 *   - Rate limit: general bucket (100 / 15min / IP)
 *   - Strict validation: tenantId ≤ 64 chars, ISO date parse
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO visibility)
 *   FDL No.10/2025 Art.24 (10-year retention — telemetry is a mirror)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   NIST AI RMF 1.0 MANAGE-2 (AI provenance over time)
 */

import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticate } from "./middleware/auth.mts";
import { BrainTelemetryStore } from "../../src/services/brainTelemetryStore";
import { createNetlifyBlobHandle } from "../../src/services/brainMemoryBlobStore";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.HAWKEYE_ALLOWED_ORIGIN ??
    "https://hawkeye-sterling-v2.netlify.app",
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

// Shared store — same Netlify Blob backend the analyze endpoint writes to.
const telemetryStore: BrainTelemetryStore | null = (() => {
  try {
    const store = getStore("brain-memory");
    const handle = createNetlifyBlobHandle({
      get: (key, opts) => store.get(key, opts),
      setJSON: (key, value) => store.setJSON(key, value),
      delete: (key) => store.delete(key),
    });
    return new BrainTelemetryStore(handle);
  } catch {
    return null;
  }
})();

interface TelemetryRequest {
  tenantId: string;
  startIso: string;
  endIso: string;
}

function validate(
  raw: unknown
): { ok: true; request: TelemetryRequest } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.tenantId !== "string" || r.tenantId.length === 0 || r.tenantId.length > 64) {
    return { ok: false, error: "tenantId must be a non-empty string (<=64)" };
  }
  if (typeof r.startIso !== "string" || isNaN(Date.parse(r.startIso))) {
    return { ok: false, error: "startIso must be a parseable ISO date" };
  }
  if (typeof r.endIso !== "string" || isNaN(Date.parse(r.endIso))) {
    return { ok: false, error: "endIso must be a parseable ISO date" };
  }
  // Clamp the max range to 365 days to prevent huge reads.
  const spanMs =
    Date.parse(r.endIso.slice(0, 10)) - Date.parse(r.startIso.slice(0, 10));
  if (spanMs < 0) {
    return { ok: false, error: "endIso must be >= startIso" };
  }
  if (spanMs > 365 * 86_400_000) {
    return { ok: false, error: "range exceeds 365 days" };
  }
  return {
    ok: true,
    request: {
      tenantId: r.tenantId,
      startIso: r.startIso.slice(0, 10),
      endIso: r.endIso.slice(0, 10),
    },
  };
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 100,
    clientIp: context.ip,
    namespace: "brain-telemetry",
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
    console.warn(`[BRAIN-TELEMETRY] Rejected input from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }

  if (!telemetryStore) {
    return jsonResponse(
      { error: "telemetry_store_unavailable" },
      { status: 503 }
    );
  }

  const started = Date.now();
  const aggregate = await telemetryStore.aggregate(
    v.request.tenantId,
    v.request.startIso,
    v.request.endIso
  );
  const durationMs = Date.now() - started;

  console.log(
    `[BRAIN-TELEMETRY] ${auth.userId} tenant=${v.request.tenantId} range=${v.request.startIso}..${v.request.endIso} decisions=${aggregate.totalDecisions} ms=${durationMs}`
  );

  return jsonResponse({ ok: true, aggregate, durationMs });
};

export const config: Config = {
  path: "/api/brain/telemetry",
  method: ["POST", "OPTIONS"],
};

export const __test__ = { validate };
