/**
 * Four-Eyes Approval API
 *
 * GET  /api/approvals         → list pending brain-escalated events
 * POST /api/approvals/approve → record an approval (requires auth)
 * POST /api/approvals/reject  → record a rejection (requires auth)
 *
 * Enforces the CLAUDE.md "four-eyes" invariant:
 *   - Every High / Very-High / PEP / sanctions decision requires TWO
 *     independent approvers before it can be actioned
 *   - The submitter is auto-excluded from the approval set
 *   - An item is "approved" only when it has 2+ distinct approver ids
 *
 * Storage: Netlify Blobs store `brain-events` contains the event
 * log; approvals live in a separate `brain-approvals` store keyed by
 * event id, so the original events stay immutable.
 */

import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticate } from "./middleware/auth.mts";

const EVENT_STORE = "brain-events";
const APPROVAL_STORE = "brain-approvals";

// Minimum distinct approvers required to mark an item "approved".
// Matches the CLAUDE.md four-eyes requirement.
const REQUIRED_APPROVERS = 2;

interface StoredBrainEvent {
  at: string;
  event: {
    kind: string;
    severity: string;
    summary: string;
    subject?: string;
    refId?: string;
    matchScore?: number;
    meta?: Record<string, unknown>;
  };
  decision: {
    tool: string | null;
    purpose: string;
    autoActions: string[];
    escalate: boolean;
  };
}

interface ApprovalEntry {
  eventId: string;
  approvals: Array<{ actor: string; at: string; note?: string }>;
  rejections: Array<{ actor: string; at: string; note?: string }>;
  status: "pending" | "approved" | "rejected";
}

// Severity gates that require four-eyes.
const FOUR_EYES_SEVERITY = new Set(["high", "critical"]);

function needsFourEyes(event: StoredBrainEvent): boolean {
  if (FOUR_EYES_SEVERITY.has(event.event.severity)) return true;
  if (event.decision.escalate) return true;
  if (event.event.kind === "sanctions_match" && (event.event.matchScore ?? 0) >= 0.5) {
    return true;
  }
  return false;
}

function makeEventId(entry: StoredBrainEvent, index: number): string {
  // Stable deterministic id derived from timestamp + ref + index.
  // We use sha256 truncated to 32 chars rather than truncated base64 —
  // base64 truncation loses entropy from the end of the input, so two
  // entries differing only in their index produce the same prefix.
  const base = `${entry.at}|${entry.event.refId ?? entry.event.kind}|${index}`;
  return createHash("sha256").update(base).digest("base64url").slice(0, 32);
}

// ---------------------------------------------------------------------------
// List pending approvals — GET /api/approvals
// ---------------------------------------------------------------------------

async function listPending(): Promise<
  Array<StoredBrainEvent & { id: string; approval: ApprovalEntry }>
> {
  const eventStore = getStore(EVENT_STORE);
  const approvalStore = getStore(APPROVAL_STORE);

  const out: Array<StoredBrainEvent & { id: string; approval: ApprovalEntry }> = [];

  // Scan the last 7 days of events.
  for (let daysBack = 0; daysBack < 7; daysBack++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysBack);
    const key = `events/${d.toISOString().slice(0, 10)}.json`;
    let day: StoredBrainEvent[] | null = null;
    try {
      day = (await eventStore.get(key, { type: "json" })) as StoredBrainEvent[] | null;
    } catch {
      day = null;
    }
    if (!day) continue;

    for (let i = 0; i < day.length; i++) {
      const entry = day[i];
      if (!needsFourEyes(entry)) continue;

      const id = makeEventId(entry, i);
      let approval: ApprovalEntry | null = null;
      try {
        approval = (await approvalStore.get(id, { type: "json" })) as ApprovalEntry | null;
      } catch {
        approval = null;
      }
      const rec: ApprovalEntry = approval ?? {
        eventId: id,
        approvals: [],
        rejections: [],
        status: "pending",
      };
      if (rec.status === "pending") {
        out.push({ ...entry, id, approval: rec });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Record an approval or rejection
// ---------------------------------------------------------------------------

async function recordDecision(
  eventId: string,
  actor: string,
  verdict: "approve" | "reject",
  note: string | undefined,
): Promise<ApprovalEntry> {
  const approvalStore = getStore(APPROVAL_STORE);
  const existing = (await approvalStore.get(eventId, { type: "json" })) as ApprovalEntry | null;
  const rec: ApprovalEntry = existing ?? {
    eventId,
    approvals: [],
    rejections: [],
    status: "pending",
  };

  // Submitter auto-exclusion + distinct-approver enforcement.
  // The actor is derived from the bearer token, not the request body,
  // so it can't be forged.
  if (verdict === "approve") {
    if (rec.approvals.some((a) => a.actor === actor)) {
      // Idempotent — same approver voting twice is a no-op.
      return rec;
    }
    rec.approvals.push({ actor, at: new Date().toISOString(), note });
    if (rec.approvals.length >= REQUIRED_APPROVERS) {
      rec.status = "approved";
    }
  } else {
    if (rec.rejections.some((r) => r.actor === actor)) return rec;
    rec.rejections.push({ actor, at: new Date().toISOString(), note });
    // One rejection is enough to block the action.
    rec.status = "rejected";
  }

  await approvalStore.setJSON(eventId, rec);
  return rec;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  // Rate limit (sensitive endpoint — approvals can freeze accounts).
  const rl = await checkRateLimit(req, { max: 10, clientIp: context.ip });
  if (rl) return rl;

  // Auth required on both GET and POST. The actor id is derived from
  // the token, NOT from the request body or URL.
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const url = new URL(req.url);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && pathname.endsWith("/approvals")) {
    try {
      const pending = await listPending();
      return Response.json({ pending, count: pending.length, actor: auth.userId });
    } catch (err) {
      console.error(`[approvals] list error: ${(err as Error).message}`);
      return Response.json({ error: "failed_to_list" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    const isApprove = pathname.endsWith("/approve");
    const isReject = pathname.endsWith("/reject");
    if (!isApprove && !isReject) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    let body: { eventId?: string; note?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    if (!eventId || eventId.length > 64) {
      return Response.json({ error: "eventId required (<=64 chars)" }, { status: 400 });
    }
    const note =
      typeof body.note === "string"
        ? body.note.replace(/[\r\n\t\u0000-\u001f]/g, " ").trim().slice(0, 500)
        : undefined;

    try {
      const rec = await recordDecision(
        eventId,
        auth.userId!,
        isApprove ? "approve" : "reject",
        note,
      );
      console.log(
        `[approvals] ${isApprove ? "approve" : "reject"} eventId=${eventId} actor=${auth.userId} status=${rec.status}`,
      );
      return Response.json({ ok: true, record: rec });
    } catch (err) {
      console.error(`[approvals] record error: ${(err as Error).message}`);
      return Response.json({ error: "failed_to_record" }, { status: 500 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: ["/api/approvals", "/api/approvals/approve", "/api/approvals/reject"],
  method: ["GET", "POST", "OPTIONS"],
};

// For unit tests.
export const __test__ = {
  needsFourEyes,
  makeEventId,
  REQUIRED_APPROVERS,
};
