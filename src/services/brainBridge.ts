/**
 * Brain Bridge — browser-side client for the compliance SUPER ULTRA BRAIN.
 *
 * Use this from any client module that detects a compliance-critical
 * event and wants the brain to route + escalate + publish. The server
 * side of this bridge lives in `netlify/functions/brain.mts`.
 *
 * Design rules (enforced by the server too, but kept here for fast-fail):
 *  - Free-text fields are length-capped to avoid log flood / blob abuse.
 *  - Newlines/control chars are stripped before transmission.
 *  - Never include raw PII — pass a ref id and let the brain look up
 *    the authoritative record server-side.
 *  - The bridge is fire-and-forget by default: compliance UI must never
 *    block on brain latency. Use `notifyBrainBlocking` only when the
 *    caller needs the decision.
 */

export type BrainEventKind =
  | 'str_saved'
  | 'sanctions_match'
  | 'threshold_breach'
  | 'deadline_missed'
  | 'cdd_overdue'
  | 'evidence_break'
  | 'manual';

export type BrainSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface BrainEvent {
  kind: BrainEventKind;
  severity: BrainSeverity;
  summary: string;
  subject?: string;
  matchScore?: number;
  refId?: string;
  meta?: Record<string, unknown>;
}

export interface BrainDecision {
  tool: 'screening' | 'workflow' | 'thresholds' | 'tfs' | 'regulatory' | 'reports' | null;
  purpose: string;
  autoActions: string[];
  escalate: boolean;
}

export interface BrainResponse {
  ok: boolean;
  actor?: string;
  decision?: BrainDecision;
  persistence?: { persisted: boolean; count?: number; reason?: string };
  cachet?: { published: boolean; reason?: string };
  error?: string;
  receivedAt?: string;
}

const BRAIN_ENDPOINT = '/api/brain';
const CAP_SUMMARY = 500;
const CAP_SUBJECT = 200;
const CAP_REFID = 64;

function sanitize(s: string, cap: number): string {
  // Strip newlines, tabs, and C0 control chars to defuse log-injection and
  // blob-key abuse. The control-char range is intentional.
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\r\n\t\u0000-\u001f]/g, ' ')
      .trim()
      .slice(0, cap)
  );
}

function clean(event: BrainEvent): BrainEvent {
  const out: BrainEvent = {
    kind: event.kind,
    severity: event.severity,
    summary: sanitize(event.summary, CAP_SUMMARY),
  };
  if (event.subject) out.subject = sanitize(event.subject, CAP_SUBJECT);
  if (event.refId) out.refId = sanitize(event.refId, CAP_REFID);
  if (typeof event.matchScore === 'number' && Number.isFinite(event.matchScore)) {
    out.matchScore = Math.max(0, Math.min(1, event.matchScore));
  }
  if (event.meta && typeof event.meta === 'object') out.meta = event.meta;
  return out;
}

/**
 * Resolve the auth token. The compliance app stores a hex bearer token
 * under `auth.token` in localStorage; we read it lazily so unit tests can
 * run without a DOM.
 */
function getToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('auth.token');
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget brain notification. Returns `true` if the request was
 * dispatched (not necessarily successful). Never throws.
 */
export function notifyBrain(event: BrainEvent): boolean {
  try {
    const token = getToken();
    if (!token) return false;
    const body = JSON.stringify(clean(event));
    // We can't use navigator.sendBeacon — it can't carry an Authorization
    // header, and the brain endpoint requires auth. Use fetch with
    // keepalive so the POST survives page navigation.
    void fetch(BRAIN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body,
      keepalive: true,
    }).catch(() => {
      /* intentionally swallowed — brain is best-effort */
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Blocking brain call — awaits the decision. Only use when the caller
 * needs to make a UX decision based on the brain's routing (e.g. "show
 * the four-eyes approval modal if decision.escalate === true").
 */
export async function notifyBrainBlocking(event: BrainEvent): Promise<BrainResponse> {
  const token = getToken();
  if (!token) return { ok: false, error: 'no_auth_token' };
  try {
    const res = await fetch(BRAIN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(clean(event)),
    });
    const json = (await res.json()) as BrainResponse;
    if (!res.ok) return { ok: false, error: json.error ?? `http_${res.status}` };
    return json;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Exposed for tests and for runtime injection into `global.*` in compliance-suite.js. */
export const __brain = { clean, sanitize };

// ---------------------------------------------------------------------------
// MEGA SUPER INTELLIGENCE BRAIN — weaponized runtime bridge
// ---------------------------------------------------------------------------
//
// The mega brain runs ENTIRELY browser-side (it's pure TS with no
// network calls) and then fires a single summarising event at the
// serverless brain endpoint for persistence + cachet publishing. This
// is the "weaponized" entry point that the autopilot, the UI, and the
// voice brain all call to get a complete multi-subsystem verdict.
import { runMegaBrain, type MegaBrainRequest, type MegaBrainResponse } from './megaBrain';

export function assessWithMegaBrain(req: MegaBrainRequest): MegaBrainResponse {
  return runMegaBrain(req);
}

/**
 * Run the mega brain AND notify the serverless brain endpoint with a
 * summarised event reflecting the verdict. Returns the full mega brain
 * response locally so the caller can render the reasoning chain and
 * subsystem reports immediately.
 */
export async function weaponizeMegaAssessment(
  req: MegaBrainRequest,
  options: { blocking?: boolean } = {}
): Promise<MegaBrainResponse> {
  const result = runMegaBrain(req);

  const bridgeEvent: BrainEvent = {
    kind: megaVerdictToBridgeKind(result.verdict),
    severity: megaVerdictToBridgeSeverity(result.verdict),
    summary:
      `MegaBrain: ${req.entity.name} → ${result.verdict} (${result.recommendedAction})`.slice(
        0,
        CAP_SUMMARY
      ),
    subject: req.entity.name.slice(0, CAP_SUBJECT),
    refId: req.entity.id.slice(0, CAP_REFID),
    meta: {
      confidence: result.confidence,
      requiresHumanReview: result.requiresHumanReview,
      strProbability: result.subsystems.strPrediction.probability,
      reflectionConfidence: result.subsystems.reflection.confidence,
      chainId: result.chain.id,
      topic: result.topic,
    },
  };

  if (options.blocking) {
    await notifyBrainBlocking(bridgeEvent);
  } else {
    notifyBrain(bridgeEvent);
  }

  return result;
}

function megaVerdictToBridgeKind(verdict: MegaBrainResponse['verdict']): BrainEventKind {
  switch (verdict) {
    case 'freeze':
      return 'sanctions_match';
    case 'escalate':
      return 'str_saved';
    case 'flag':
      return 'manual';
    case 'pass':
    default:
      return 'manual';
  }
}

function megaVerdictToBridgeSeverity(verdict: MegaBrainResponse['verdict']): BrainSeverity {
  switch (verdict) {
    case 'freeze':
      return 'critical';
    case 'escalate':
      return 'high';
    case 'flag':
      return 'medium';
    case 'pass':
    default:
      return 'info';
  }
}
