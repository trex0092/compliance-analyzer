/**
 * SUPER ULTRA BRAIN — Compliance Event Ingress
 *
 * Serverless endpoint that receives compliance events from the browser
 * (STR saved, sanctions match, threshold breached, deadline missed) and
 * weaponizes them:
 *
 *  1. Validates + auths + rate-limits the event.
 *  2. Routes it deterministically to the correct tool (same rules as
 *     scripts/brain.mjs — duplicated here because Netlify Functions can't
 *     easily import from scripts/ outside the functions dir).
 *  3. For CRITICAL events (confirmed sanctions match, missed deadline,
 *     evidence-chain break) publishes a Cachet incident if configured.
 *  4. Persists the event to Netlify Blobs so the autopilot and the
 *     morning briefing can consume it.
 *  5. Returns the routing decision + any immediate auto-actions taken.
 *
 * This is a DEFENSIVE weaponization: the brain only escalates, logs,
 * and publishes. It never silences an alert, never bypasses the
 * four-eyes gate, and never tips off a subject (FDL Art.29).
 */

import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticate } from "./middleware/auth.mts";

// CORS headers applied to both preflight and actual responses. Single
// allow-origin per env var so cross-site requests can't forge identity.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? "https://compliance-analyzer.netlify.app",
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type EventKind =
  | "str_saved"
  | "sanctions_match"
  | "threshold_breach"
  | "deadline_missed"
  | "cdd_overdue"
  | "evidence_break"
  | "manual";

type Severity = "info" | "low" | "medium" | "high" | "critical";

interface BrainEvent {
  kind: EventKind;
  severity: Severity;
  subject?: string;
  summary: string;
  /** Optional numeric hit score for sanctions matches (0..1). */
  matchScore?: number;
  /** Optional entity/case id for traceability. */
  refId?: string;
  /** Free-form metadata. Never include PII beyond what the event needs. */
  meta?: Record<string, unknown>;
}

interface RouteDecision {
  tool:
    | "screening"
    | "workflow"
    | "thresholds"
    | "tfs"
    | "regulatory"
    | "reports"
    | null;
  purpose: string;
  autoActions: string[];
  escalate: boolean;
}

// ---------------------------------------------------------------------------
// Routing (deterministic — mirrors scripts/brain.mjs)
// ---------------------------------------------------------------------------
function route(event: BrainEvent): RouteDecision {
  const autoActions: string[] = [];
  let tool: RouteDecision["tool"] = null;
  let purpose = "No deterministic route. Escalate to CO.";
  let escalate = false;

  switch (event.kind) {
    case "sanctions_match": {
      tool = "screening";
      const score = event.matchScore ?? 0;
      if (score >= 0.9) {
        // Cabinet Res 74/2020 Art.4-7: freeze within 24h.
        purpose = "CONFIRMED sanctions match — execute 24h freeze protocol.";
        autoActions.push("freeze_assets:immediate");
        autoActions.push("start_eocn_countdown:24h");
        autoActions.push("schedule_cnmr_filing:5bd");
        autoActions.push("suppress_subject_notification:FDL_Art29");
        // F-05 fix: confirmed freeze is exactly the case that MUST
        // reach the public status page.
        autoActions.push("publish_cachet_incident");
        escalate = true;
      } else if (score >= 0.5) {
        purpose = "POTENTIAL match — escalate to Compliance Officer.";
        autoActions.push("escalate_to_co");
        autoActions.push("require_four_eyes_review");
        escalate = true;
      } else {
        purpose = "LOW-confidence hit — document and dismiss.";
        autoActions.push("log_dismissal_with_rationale");
      }
      break;
    }
    case "str_saved": {
      tool = "workflow";
      purpose = "STR drafted — begin filing deadline tracking (FDL Art.26-27).";
      autoActions.push("start_deadline_tracker:str");
      autoActions.push("apply_confidentiality_lock:FDL_Art29");
      autoActions.push("append_to_evidence_chain");
      escalate = event.severity === "critical" || event.severity === "high";
      break;
    }
    case "threshold_breach": {
      tool = "thresholds";
      purpose =
        "Threshold breach — AED 55K (DPMSR) or AED 60K (cross-border BNI) crossed.";
      autoActions.push("queue_ctr_or_dpmsr");
      autoActions.push("freeze_transaction_pending_review");
      escalate = true;
      break;
    }
    case "deadline_missed": {
      tool = "workflow";
      purpose = "Filing deadline missed — regulatory penalty exposure.";
      autoActions.push("alert_mlro:critical");
      autoActions.push("append_to_evidence_chain");
      autoActions.push("publish_cachet_incident");
      escalate = true;
      break;
    }
    case "cdd_overdue": {
      tool = "regulatory";
      purpose = "CDD review overdue — Cabinet Res 134/2025 Art.7-10.";
      autoActions.push("lock_entity_transactions");
      autoActions.push("alert_co");
      escalate = true;
      break;
    }
    case "evidence_break": {
      tool = "reports";
      purpose = "Evidence chain break detected — forensic integrity at risk.";
      autoActions.push("freeze_all_new_records");
      autoActions.push("alert_mlro:critical");
      autoActions.push("publish_cachet_incident");
      escalate = true;
      break;
    }
    default: {
      tool = null;
      purpose = "Manual / unclassified event — escalate to CO.";
      escalate = true;
    }
  }

  return { tool, purpose, autoActions, escalate };
}

// ---------------------------------------------------------------------------
// Validation — reject any payload that doesn't match the schema exactly.
// ---------------------------------------------------------------------------
const VALID_KINDS = new Set<EventKind>([
  "str_saved",
  "sanctions_match",
  "threshold_breach",
  "deadline_missed",
  "cdd_overdue",
  "evidence_break",
  "manual",
]);
const VALID_SEVERITIES = new Set<Severity>([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

function validate(input: unknown): { ok: true; event: BrainEvent } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const raw = input as Record<string, unknown>;

  if (typeof raw.kind !== "string" || !VALID_KINDS.has(raw.kind as EventKind)) {
    return { ok: false, error: "invalid kind" };
  }
  if (
    typeof raw.severity !== "string" ||
    !VALID_SEVERITIES.has(raw.severity as Severity)
  ) {
    return { ok: false, error: "invalid severity" };
  }
  if (typeof raw.summary !== "string" || raw.summary.length === 0 || raw.summary.length > 500) {
    return { ok: false, error: "summary must be a non-empty string (<=500 chars)" };
  }
  if (raw.subject !== undefined && (typeof raw.subject !== "string" || raw.subject.length > 200)) {
    return { ok: false, error: "subject must be a string (<=200 chars)" };
  }
  if (raw.refId !== undefined && (typeof raw.refId !== "string" || raw.refId.length > 64)) {
    return { ok: false, error: "refId must be a string (<=64 chars)" };
  }
  if (raw.matchScore !== undefined) {
    const n = Number(raw.matchScore);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return { ok: false, error: "matchScore must be a number in [0,1]" };
    }
  }
  if (raw.meta !== undefined && (typeof raw.meta !== "object" || raw.meta === null)) {
    return { ok: false, error: "meta must be an object" };
  }

  // Strip newlines/control chars from free-text fields to block log-injection.
  const clean = (s: string) => s.replace(/[\r\n\t\u0000-\u001f]/g, " ").trim();

  const event: BrainEvent = {
    kind: raw.kind as EventKind,
    severity: raw.severity as Severity,
    summary: clean(raw.summary),
    ...(typeof raw.subject === "string" ? { subject: clean(raw.subject) } : {}),
    ...(typeof raw.refId === "string" ? { refId: clean(raw.refId) } : {}),
    ...(typeof raw.matchScore === "number" ? { matchScore: raw.matchScore } : {}),
    ...(raw.meta ? { meta: raw.meta as Record<string, unknown> } : {}),
  };

  return { ok: true, event };
}

// ---------------------------------------------------------------------------
// Cachet publishing (optional — only if env is configured).
// ---------------------------------------------------------------------------
async function publishCachet(event: BrainEvent, decision: RouteDecision): Promise<
  { published: boolean; reason?: string }
> {
  const base = process.env.CACHET_BASE_URL;
  const token = process.env.CACHET_API_TOKEN;
  if (!base || !token) return { published: false, reason: "cachet_not_configured" };

  const status = event.severity === "critical" ? 2 /* Identified */ : 1 /* Investigating */;
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/v1/incidents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cachet-Token": token,
      },
      body: JSON.stringify({
        name: `[${event.severity.toUpperCase()}] ${event.kind}`,
        message: `${event.summary}\n\nBrain decision: ${decision.purpose}\nActions: ${decision.autoActions.join(", ") || "none"}`,
        status,
        visible: 1,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { published: false, reason: `cachet_http_${res.status}` };
    }
    return { published: true };
  } catch (err) {
    return { published: false, reason: `cachet_error:${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Persistence — one blob per event (no read-modify-write race, no eviction).
//
// Review findings addressed:
//   F-03 — silent eviction of oldest events when a day exceeded 1000.
//          FDL Art.24 mandates 5-year retention — slicing was a data
//          loss bug disguised as "flood protection".
//   F-04 — concurrent writes to the same day blob raced each other and
//          silently lost events.
//
// Fix: each event gets its own blob keyed by `events/YYYY-MM-DD/<iso>-<uuid>.json`.
// No shared mutable state, so no race. Consumers (listPending in
// approvals.mts, autopilot, MLRO agent) list by prefix.
// ---------------------------------------------------------------------------
const EVENT_STORE = "brain-events";

async function persistEvent(event: BrainEvent, decision: RouteDecision) {
  try {
    const store = getStore(EVENT_STORE);
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    // Millisecond timestamp + uuid ensures unique keys even under
    // massive concurrent load.
    const key = `events/${day}/${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    await store.setJSON(key, {
      at: now.toISOString(),
      event,
      decision,
    });
    return { persisted: true, key };
  } catch (err) {
    console.error(`[BRAIN] persist failed: ${(err as Error).message}`);
    return { persisted: false, reason: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  // Rate limit: sensitive endpoint per CLAUDE.md (10 req / 15 min per IP).
  const rl = await checkRateLimit(req, { max: 10, clientIp: context.ip });
  if (rl) return rl;

  // Auth required — brain MUST compare against HAWKEYE_BRAIN_TOKEN.
  // Fails closed (503) if server-side env is misconfigured.
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
    console.warn(`[BRAIN] Rejected input from ${auth.userId}: ${v.error}`);
    return jsonResponse({ error: v.error }, { status: 400 });
  }
  const event = v.event;

  const decision = route(event);

  // Structured log — never logs PII beyond summary/subject already validated.
  console.log(
    `[BRAIN] ${event.kind} severity=${event.severity} tool=${decision.tool ?? "none"} escalate=${decision.escalate} actor=${auth.userId}`,
  );

  const persistence = await persistEvent(event, decision);

  // F-05 fix: any escalated event with `publish_cachet_incident` in
  // autoActions publishes. Severity-critical alone is no longer a
  // condition — the route() function is the source of truth for which
  // events surface on the public status page.
  let cachet: { published: boolean; reason?: string } = { published: false, reason: "not_triggered" };
  if (decision.autoActions.includes("publish_cachet_incident")) {
    cachet = await publishCachet(event, decision);
  }

  return jsonResponse({
    ok: true,
    actor: auth.userId,
    decision,
    persistence,
    cachet,
    receivedAt: new Date().toISOString(),
  });
};

export const config: Config = {
  path: "/api/brain",
  method: ["POST", "OPTIONS"],
};

// Exports for unit tests.
export const __test__ = { route, validate };
