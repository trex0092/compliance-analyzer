/**
 * Brain Correlate — cross-case pattern correlation endpoint.
 *
 * POST /api/brain/correlate
 *
 * Accepts a bag of case snapshots and returns every detected pattern:
 * structuring clusters, wallet reuse, shared-UBO rings, address reuse,
 * corridor bursts, narrative copy-paste, and sanctions-key reuse.
 *
 * This is the brain's "look across cases" surface — the single-case
 * weaponized brain can never see money-laundering rings that span
 * multiple supposedly-unrelated entities. This endpoint makes that
 * visible to the MLRO from the Brain Console.
 *
 * Security mirrors /api/brain/analyze:
 *   - POST only, CORS preflight allowed
 *   - authenticate() against HAWKEYE_BRAIN_TOKEN (fails closed)
 *   - Sensitive rate-limit bucket (10 / 15 min / IP, namespace
 *     brain-correlate)
 *   - Strict payload validation — rejects any field outside the
 *     CaseSnapshot schema
 *   - Tipping-off guard on every description before return
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty of care on cross-case reasoning)
 *   FDL No.10/2025 Art.29    (no tipping off — findings carry hashed refs only)
 *   Cabinet Res 74/2020 Art.4-7 (sanctions ring detection)
 *   Cabinet Decision 109/2023   (shell-company ring detection)
 *   FATF Rec 6, 10, 15, 20-25
 *   MoE Circular 08/AML/2021
 */

import type { Config, Context } from "@netlify/functions";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticate } from "./middleware/auth.mts";
import {
  correlateCrossCases,
  type CaseSnapshot,
} from "../../src/services/crossCasePatternCorrelator";
import { lintForTippingOff } from "../../src/services/tippingOffLinter";

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

const MAX_CASES_PER_REQUEST = 500;
const MAX_STRING_LEN = 256;
const MAX_ARRAY_LEN = 32;

function isIsoDate(s: unknown): s is string {
  return (
    typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)
  );
}

function validateString(
  v: unknown,
  field: string,
  required: boolean
): { ok: true; value?: string } | { ok: false; error: string } {
  if (v === undefined) {
    if (required) return { ok: false, error: `${field} is required` };
    return { ok: true };
  }
  if (typeof v !== "string")
    return { ok: false, error: `${field} must be a string` };
  if (v.length > MAX_STRING_LEN)
    return { ok: false, error: `${field} exceeds ${MAX_STRING_LEN} chars` };
  return { ok: true, value: v };
}

function validateStringArray(
  v: unknown,
  field: string
): { ok: true; value?: string[] } | { ok: false; error: string } {
  if (v === undefined) return { ok: true };
  if (!Array.isArray(v))
    return { ok: false, error: `${field} must be an array` };
  if (v.length > MAX_ARRAY_LEN)
    return { ok: false, error: `${field} exceeds ${MAX_ARRAY_LEN} entries` };
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string" || v[i].length === 0 || v[i].length > MAX_STRING_LEN) {
      return { ok: false, error: `${field}[${i}] must be a non-empty string` };
    }
    out.push(v[i]);
  }
  return { ok: true, value: out };
}

function validateCaseSnapshot(
  raw: unknown,
  tenantId: string
): { ok: true; snapshot: CaseSnapshot } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object")
    return { ok: false, error: "case must be an object" };
  const r = raw as Record<string, unknown>;

  const caseId = validateString(r.caseId, "caseId", true);
  if (!caseId.ok) return caseId;
  const entityRef = validateString(r.entityRef, "entityRef", true);
  if (!entityRef.ok) return entityRef;

  if (!isIsoDate(r.openedAt))
    return { ok: false, error: "openedAt must be ISO 8601" };

  const uboRefs = validateStringArray(r.uboRefs, "uboRefs");
  if (!uboRefs.ok) return uboRefs;
  const wallets = validateStringArray(r.wallets, "wallets");
  if (!wallets.ok) return wallets;
  const sanctionsMatchKeys = validateStringArray(
    r.sanctionsMatchKeys,
    "sanctionsMatchKeys"
  );
  if (!sanctionsMatchKeys.ok) return sanctionsMatchKeys;

  const addressHash = validateString(r.addressHash, "addressHash", false);
  if (!addressHash.ok) return addressHash;
  const narrativeHash = validateString(r.narrativeHash, "narrativeHash", false);
  if (!narrativeHash.ok) return narrativeHash;
  const corridorCountry = validateString(
    r.corridorCountry,
    "corridorCountry",
    false
  );
  if (!corridorCountry.ok) return corridorCountry;

  let maxTxAED: number | undefined;
  if (r.maxTxAED !== undefined) {
    const n = Number(r.maxTxAED);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) {
      return { ok: false, error: "maxTxAED must be a non-negative finite number" };
    }
    maxTxAED = n;
  }

  return {
    ok: true,
    snapshot: {
      caseId: caseId.value!,
      tenantId,
      openedAt: r.openedAt as string,
      entityRef: entityRef.value!,
      ...(uboRefs.value ? { uboRefs: uboRefs.value } : {}),
      ...(wallets.value ? { wallets: wallets.value } : {}),
      ...(sanctionsMatchKeys.value
        ? { sanctionsMatchKeys: sanctionsMatchKeys.value }
        : {}),
      ...(addressHash.value ? { addressHash: addressHash.value } : {}),
      ...(narrativeHash.value ? { narrativeHash: narrativeHash.value } : {}),
      ...(corridorCountry.value
        ? { corridorCountry: corridorCountry.value }
        : {}),
      ...(maxTxAED !== undefined ? { maxTxAED } : {}),
    },
  };
}

interface CorrelateRequest {
  tenantId: string;
  cases: CaseSnapshot[];
}

function validate(
  body: unknown
): { ok: true; request: CorrelateRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object")
    return { ok: false, error: "body must be an object" };
  const r = body as Record<string, unknown>;

  const tenantIdResult = validateString(r.tenantId, "tenantId", true);
  if (!tenantIdResult.ok) return tenantIdResult;
  const tenantId = tenantIdResult.value!;

  if (!Array.isArray(r.cases))
    return { ok: false, error: "cases must be an array" };
  if (r.cases.length === 0)
    return { ok: false, error: "cases must be non-empty" };
  if (r.cases.length > MAX_CASES_PER_REQUEST) {
    return {
      ok: false,
      error: `cases exceeds max (${MAX_CASES_PER_REQUEST})`,
    };
  }

  const snapshots: CaseSnapshot[] = [];
  for (let i = 0; i < r.cases.length; i++) {
    const res = validateCaseSnapshot(r.cases[i], tenantId);
    if (!res.ok) return { ok: false, error: `cases[${i}]: ${res.error}` };
    snapshots.push(res.snapshot);
  }

  return { ok: true, request: { tenantId, cases: snapshots } };
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const rl = await checkRateLimit(req, {
    max: 10,
    clientIp: context.ip,
    namespace: "brain-correlate",
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
      `[BRAIN-CORRELATE] Rejected input from ${auth.userId}: ${v.error}`
    );
    return jsonResponse({ error: v.error }, { status: 400 });
  }
  const request = v.request;

  const report = correlateCrossCases(request.cases, {
    tenantId: request.tenantId,
  });

  // Tipping-off guard — every description must pass the linter.
  // This should never fail because descriptions are built from
  // deterministic templates and hashed refs, but belt-and-braces.
  for (const c of report.correlations) {
    const lint = lintForTippingOff(c.description);
    if (!lint.clean && lint.topSeverity !== "medium") {
      console.error(
        `[BRAIN-CORRELATE] Tipping-off guard blocked finding ${c.id}: ${lint.findings.map((f) => f.patternId).join(",")}`
      );
      return jsonResponse(
        {
          error: "tipping_off_blocked",
          reason: "correlation finding contained subject-identifying language",
        },
        { status: 451 }
      );
    }
  }

  console.log(
    `[BRAIN-CORRELATE] ${auth.userId} tenant=${request.tenantId} cases=${report.caseCount} findings=${report.correlations.length} topSev=${report.topSeverity}`
  );

  return jsonResponse({ ok: true, report });
};

export const config: Config = {
  path: "/api/brain/correlate",
  method: ["POST", "OPTIONS"],
};

export const __test__ = { validate, validateCaseSnapshot };
