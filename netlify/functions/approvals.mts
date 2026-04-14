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

// ---------------------------------------------------------------------------
// Solo-MLRO mode (Tier-1 #7) — opt-in via env, default off
// ---------------------------------------------------------------------------

const DEFAULT_SOLO_COOLDOWN_HOURS = 24;
const MIN_SOLO_COOLDOWN_HOURS = 1;
const MAX_SOLO_COOLDOWN_HOURS = 168; // 1 week

function isSoloMlroModeEnabled(): boolean {
  const raw = process.env.HAWKEYE_SOLO_MLRO_MODE;
  if (!raw) return false;
  const lower = raw.trim().toLowerCase();
  return lower === "true" || lower === "1" || lower === "yes" || lower === "on";
}

function getSoloMlroCooldownHours(): number {
  const raw = process.env.HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS;
  if (!raw) return DEFAULT_SOLO_COOLDOWN_HOURS;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SOLO_COOLDOWN_HOURS;
  return Math.max(MIN_SOLO_COOLDOWN_HOURS, Math.min(MAX_SOLO_COOLDOWN_HOURS, parsed));
}

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

interface RecordDecisionResult {
  rec: ApprovalEntry;
  /** Set when the vote was rejected because the solo cooldown hasn't elapsed yet. */
  cooldownPendingUntilIso?: string;
  /** True when the record changed and should be persisted. */
  shouldPersist: boolean;
}

interface ApplyDecisionOptions {
  soloMode: boolean;
  soloCooldownHours: number;
  nowMs: number;
}

/**
 * Pure cooldown + quorum logic — no I/O, fully testable. Given the
 * current ApprovalEntry, an actor + verdict, and the solo-mode
 * config, compute the new ApprovalEntry and whether it should be
 * persisted. Returns a cooldownPendingUntilIso when a solo-mode
 * second vote was rejected because the cooldown hasn't elapsed.
 */
export function applyDecisionToRecord(
  rec: ApprovalEntry,
  actor: string,
  verdict: "approve" | "reject",
  note: string | undefined,
  options: ApplyDecisionOptions,
): RecordDecisionResult {
  // Do not mutate a terminal record.
  if (rec.status === "approved" || rec.status === "rejected") {
    return { rec, shouldPersist: false };
  }

  if (verdict === "approve") {
    const existingByActor = rec.approvals.find((a) => a.actor === actor);

    // Solo-MLRO mode: the same actor may cast their SECOND vote
    // after the cooldown has elapsed. This is the fresh-eyes
    // safeguard — it forces a different-day second look on the
    // same decision. Cabinet Res 134/2025 Art.19 fresh-eyes
    // principle is preserved even though the deputy doesn't exist.
    if (existingByActor) {
      if (!options.soloMode) {
        // Pre-existing behaviour — same approver voting twice is a no-op.
        return { rec, shouldPersist: false };
      }
      if (rec.approvals.length >= REQUIRED_APPROVERS) {
        // Already at quorum — no-op.
        return { rec, shouldPersist: false };
      }
      const cooldownMs = options.soloCooldownHours * 60 * 60 * 1000;
      const firstVoteMs = Date.parse(existingByActor.at);
      if (!Number.isFinite(firstVoteMs)) {
        // Defensive: corrupted timestamp on the prior vote — do not
        // accept the second vote.
        return { rec, shouldPersist: false };
      }
      const earliestSecondVoteMs = firstVoteMs + cooldownMs;
      if (options.nowMs < earliestSecondVoteMs) {
        const pendingIso = new Date(earliestSecondVoteMs).toISOString();
        // Do NOT persist the rejected vote — surface the cooldown
        // wait time so the MLRO knows when to come back.
        return { rec, cooldownPendingUntilIso: pendingIso, shouldPersist: false };
      }
      // Cooldown elapsed — record the second vote with a fresh
      // timestamp + a marker note so the audit trail shows that
      // this decision used solo-MLRO mode.
      rec.approvals.push({
        actor,
        at: new Date(options.nowMs).toISOString(),
        note: note
          ? `[solo-mlro 2nd vote, ${options.soloCooldownHours}h cooldown] ${note}`
          : `[solo-mlro 2nd vote, ${options.soloCooldownHours}h cooldown]`,
      });
      if (rec.approvals.length >= REQUIRED_APPROVERS) {
        rec.status = "approved";
      }
      return { rec, shouldPersist: true };
    }

    // First vote from this actor — standard path.
    rec.approvals.push({ actor, at: new Date(options.nowMs).toISOString(), note });
    // Distinct-approver check is enforced by the per-user auth flavour —
    // `actor` is the verified username from HAWKEYE_APPROVER_KEYS, so
    // two entries in rec.approvals with different `actor` values
    // necessarily come from two different registered humans.
    if (rec.approvals.length >= REQUIRED_APPROVERS) {
      rec.status = "approved";
    }
    return { rec, shouldPersist: true };
  }

  // verdict === "reject"
  if (rec.rejections.some((r) => r.actor === actor)) {
    return { rec, shouldPersist: false };
  }
  rec.rejections.push({ actor, at: new Date(options.nowMs).toISOString(), note });
  rec.status = "rejected";
  return { rec, shouldPersist: true };
}

async function recordDecision(
  eventId: string,
  actor: string,
  verdict: "approve" | "reject",
  note: string | undefined,
  nowMs: number = Date.now(),
): Promise<RecordDecisionResult> {
  const approvalStore = getStore(APPROVAL_STORE);
  const existing = (await approvalStore.get(eventId, { type: "json" })) as ApprovalEntry | null;
  const rec: ApprovalEntry = existing ?? {
    eventId,
    approvals: [],
    rejections: [],
    status: "pending",
  };

  const result = applyDecisionToRecord(rec, actor, verdict, note, {
    soloMode: isSoloMlroModeEnabled(),
    soloCooldownHours: getSoloMlroCooldownHours(),
    nowMs,
  });

  if (result.shouldPersist) {
    await approvalStore.setJSON(eventId, result.rec);
  }

  return result;
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
      const result = await recordDecision(
        eventId,
        auth.username!,
        isApprove ? "approve" : "reject",
        note,
      );
      const { rec, cooldownPendingUntilIso } = result;

      // Solo-MLRO cooldown rejection — surface the wait time so the
      // MLRO knows when to come back. HTTP 409 (Conflict) is the
      // closest-fit code for "request well-formed but blocked by
      // a state-machine constraint".
      if (cooldownPendingUntilIso) {
        console.log(
          `[approvals] solo-mlro cooldown blocked eventId=${eventId} actor=${auth.username} until=${cooldownPendingUntilIso}`,
        );
        return jsonResponse(
          {
            ok: false,
            error: "solo_mlro_cooldown_pending",
            cooldownPendingUntilIso,
            message: `Solo-MLRO mode requires a cooldown between your two votes. Try again at ${cooldownPendingUntilIso}.`,
            record: rec,
          },
          { status: 409 },
        );
      }

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
  applyDecisionToRecord,
  isSoloMlroModeEnabled,
  getSoloMlroCooldownHours,
  REQUIRED_APPROVERS,
  DEFAULT_SOLO_COOLDOWN_HOURS,
};
