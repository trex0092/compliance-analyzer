/**
 * Four-Eyes Approval API
 *
 * GET  /api/approvals         → list pending brain-escalated events
 * POST /api/approvals/approve → record an approval (requires approver key)
 * POST /api/approvals/reject  → record a rejection (requires approver key)
 *
 * Enforces the CLAUDE.md "four-eyes" invariant with TEETH:
 *   1. Auth via per-user keys (HAWKEYE_APPROVER_KEYS), NOT the shared
 *      brain token. Two distinct registered users must approve.
 *   2. Same user voting twice is idempotent (no-op).
 *   3. Single rejection is terminal.
 *   4. Malformed blob entries are skipped with a warning — one bad
 *      record cannot hide the entire queue.
 *
 * Storage:
 *   - brain-events store: one blob per event under events/YYYY-MM-DD/<ts>-<uuid>.json
 *     (see netlify/functions/brain.mts persistEvent — F-03/F-04 fix).
 *   - brain-approvals store: one blob per approval record keyed by event id.
 *
 * Review findings addressed:
 *   F-01/F-02 — uses authenticateApprover (per-user) instead of the
 *               shared-token authenticate. Two distinct approvers is
 *               now a real constraint.
 *   F-07     — per-entry try/catch + shape guard so a malformed entry
 *               doesn't crash listPending.
 *   F-08     — CORS Access-Control-Allow-Origin on every response.
 */

import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticateApprover } from "./middleware/auth.mts";

const EVENT_STORE = "brain-events";
const APPROVAL_STORE = "brain-approvals";
const REQUIRED_APPROVERS = 2;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":
    process.env.HAWKEYE_ALLOWED_ORIGIN ?? "https://compliance-analyzer.netlify.app",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

const FOUR_EYES_SEVERITY = new Set(["high", "critical"]);

function isStoredBrainEvent(x: unknown): x is StoredBrainEvent {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.at !== "string") return false;
  if (!o.event || typeof o.event !== "object") return false;
  if (!o.decision || typeof o.decision !== "object") return false;
  const ev = o.event as Record<string, unknown>;
  const dec = o.decision as Record<string, unknown>;
  return (
    typeof ev.kind === "string" &&
    typeof ev.severity === "string" &&
    typeof ev.summary === "string" &&
    typeof dec.escalate === "boolean" &&
    Array.isArray(dec.autoActions)
  );
}

function needsFourEyes(entry: StoredBrainEvent): boolean {
  if (FOUR_EYES_SEVERITY.has(entry.event.severity)) return true;
  if (entry.decision.escalate) return true;
  if (
    entry.event.kind === "sanctions_match" &&
    typeof entry.event.matchScore === "number" &&
    entry.event.matchScore >= 0.5
  ) {
    return true;
  }
  return false;
}

function makeEventIdFromKey(blobKey: string): string {
  // Stable id derived from the blob key (which is itself unique via
  // uuid). sha256 truncated to 32 chars. The key never leaks to the
  // client.
  return createHash("sha256").update(blobKey).digest("base64url").slice(0, 32);
}

// ---------------------------------------------------------------------------
// List pending approvals — GET /api/approvals
// ---------------------------------------------------------------------------

interface PendingItem extends StoredBrainEvent {
  id: string;
  approval: ApprovalEntry;
}

async function listPending(): Promise<{
  items: PendingItem[];
  scanned: number;
  skipped: number;
}> {
  const eventStore = getStore(EVENT_STORE);
  const approvalStore = getStore(APPROVAL_STORE);
  let scanned = 0;
  let skipped = 0;
  const items: PendingItem[] = [];

  // Scan the last 7 days of events via prefix. Netlify Blobs `list`
  // is paginated — we walk all pages.
  const today = new Date();
  for (let daysBack = 0; daysBack < 7; daysBack++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - daysBack);
    const prefix = `events/${d.toISOString().slice(0, 10)}/`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let listResult: any;
    try {
      // @ts-expect-error — Netlify Blobs .list() signature varies by SDK version
      listResult = await eventStore.list({ prefix });
    } catch (err) {
      console.warn(`[approvals] list ${prefix} failed: ${(err as Error).message}`);
      continue;
    }

    // @netlify/blobs `list` returns { blobs: [{ key }], directories: [] }
    // but shape varies across runtime versions. Normalise to an array
    // of keys.
    const keys: string[] =
      (listResult?.blobs?.map((b: { key: string }) => b.key) as string[] | undefined) ??
      (Array.isArray(listResult) ? listResult.map((b: { key: string }) => b.key) : []);

    for (const key of keys) {
      scanned++;
      let raw: unknown;
      try {
        raw = await eventStore.get(key, { type: "json" });
      } catch (err) {
        console.warn(`[approvals] read ${key} failed: ${(err as Error).message}`);
        skipped++;
        continue;
      }
      if (!isStoredBrainEvent(raw)) {
        skipped++;
        continue;
      }
      const entry = raw;

      try {
        if (!needsFourEyes(entry)) continue;
      } catch (err) {
        console.warn(`[approvals] needsFourEyes ${key}: ${(err as Error).message}`);
        skipped++;
        continue;
      }

      const id = makeEventIdFromKey(key);
      let approval: ApprovalEntry | null = null;
      try {
        approval = (await approvalStore.get(id, { type: "json" })) as ApprovalEntry | null;
      } catch (err) {
        console.warn(`[approvals] approval-read ${id}: ${(err as Error).message}`);
        approval = null;
      }
      const rec: ApprovalEntry = approval ?? {
        eventId: id,
        approvals: [],
        rejections: [],
        status: "pending",
      };
      if (rec.status === "pending") {
        items.push({ ...entry, id, approval: rec });
      }
    }
  }

  return { items, scanned, skipped };
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

  // Do not mutate a terminal record.
  if (rec.status === "approved" || rec.status === "rejected") {
    return rec;
  }

  if (verdict === "approve") {
    // Idempotent: same approver voting twice is a no-op.
    if (rec.approvals.some((a) => a.actor === actor)) return rec;
    rec.approvals.push({ actor, at: new Date().toISOString(), note });
    // Distinct-approver check is enforced by the per-user auth flavour —
    // `actor` is the verified username from HAWKEYE_APPROVER_KEYS, so
    // two entries in rec.approvals with different `actor` values
    // necessarily come from two different registered humans.
    if (rec.approvals.length >= REQUIRED_APPROVERS) {
      rec.status = "approved";
    }
  } else {
    if (rec.rejections.some((r) => r.actor === actor)) return rec;
    rec.rejections.push({ actor, at: new Date().toISOString(), note });
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
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Rate limit (sensitive endpoint — approvals can freeze accounts).
  const rl = await checkRateLimit(req, { max: 10, clientIp: context.ip });
  if (rl) return rl;

  // Auth required on both GET and POST. The actor is the username
  // matched from HAWKEYE_APPROVER_KEYS — verified, unforgeable.
  const auth = authenticateApprover(req);
  if (!auth.ok) return auth.response!;

  const url = new URL(req.url);
  const pathname = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && pathname.endsWith("/approvals")) {
    try {
      const { items, scanned, skipped } = await listPending();
      return jsonResponse({
        pending: items,
        count: items.length,
        scanned,
        skipped,
        actor: auth.username,
      });
    } catch (err) {
      console.error(`[approvals] list error: ${(err as Error).message}`);
      return jsonResponse({ error: "failed_to_list" }, { status: 500 });
    }
  }

  if (req.method === "POST") {
    const isApprove = pathname.endsWith("/approve");
    const isReject = pathname.endsWith("/reject");
    if (!isApprove && !isReject) {
      return jsonResponse({ error: "Not found" }, { status: 404 });
    }

    let body: { eventId?: string; note?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }

    const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
    if (!eventId || eventId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(eventId)) {
      return jsonResponse(
        { error: "eventId required (<=64 url-safe chars)" },
        { status: 400 },
      );
    }
    const note =
      typeof body.note === "string"
        ? body.note.replace(/[\r\n\t\u0000-\u001f]/g, " ").trim().slice(0, 500)
        : undefined;

    try {
      const rec = await recordDecision(
        eventId,
        auth.username!,
        isApprove ? "approve" : "reject",
        note,
      );
      console.log(
        `[approvals] ${isApprove ? "approve" : "reject"} eventId=${eventId} actor=${auth.username} status=${rec.status}`,
      );
      return jsonResponse({ ok: true, record: rec });
    } catch (err) {
      console.error(`[approvals] record error: ${(err as Error).message}`);
      return jsonResponse({ error: "failed_to_record" }, { status: 500 });
    }
  }

  return jsonResponse({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: ["/api/approvals", "/api/approvals/approve", "/api/approvals/reject"],
  method: ["GET", "POST", "OPTIONS"],
};

// Exports for unit tests.
export const __test__ = {
  needsFourEyes,
  makeEventIdFromKey,
  isStoredBrainEvent,
  REQUIRED_APPROVERS,
};
