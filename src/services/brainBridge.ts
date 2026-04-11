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
import {
  runWeaponizedBrain,
  type WeaponizedBrainRequest,
  type WeaponizedBrainResponse,
  type AdvisorEscalationFn,
  type AdvisorEscalationInput,
  type AdvisorEscalationResult,
} from './weaponizedBrain';
import {
  callAdvisorAssisted,
  EXECUTOR_SONNET,
  ADVISOR_OPUS,
  type AdvisorCallDeps,
} from './advisorStrategy';

export function assessWithMegaBrain(req: MegaBrainRequest): MegaBrainResponse {
  return runMegaBrain(req);
}

// ---------------------------------------------------------------------------
// Default advisor escalation — wires weaponizedBrain to advisorStrategy.
// ---------------------------------------------------------------------------
//
// The advisor escalation function is created here (not in weaponizedBrain.ts)
// so that:
//   1. weaponizedBrain.ts stays free of network/fetch dependencies and can
//      run in tests, workers, and air-gapped builds.
//   2. Deployments that disable the advisor (offline mode, compliance teams
//      that forbid outbound LLM calls) simply pass `advisor: undefined` to
//      runWeaponizedAssessment — the brain runs identically without it.
//   3. Tests can inject a mock AdvisorEscalationFn without monkey-patching.
//
// The default advisor uses:
//   - Executor: Claude Sonnet 4.6 (worker)
//   - Advisor:  Claude Opus 4.6 (reviewer via server-side advisor tool)
//   - System prompt: COMPLIANCE_ADVISOR_SYSTEM_PROMPT (six mandatory triggers
//     + conciseness directive — <=100 words, enumerated steps)
//
// Regulatory basis: FDL No.10/2025 Art.20-21 (CO duty of care), Cabinet Res
// 134/2025 Art.19 (internal review before decision).

/**
 * Create a default advisor escalation function suitable for production.
 *
 * Returns null on transient errors (rate limit, overload, 5xx) so the
 * brain proceeds without advisor input. Never throws — compliance
 * decisions must never block on advisor availability.
 */
export function createDefaultAdvisorEscalation(deps: AdvisorCallDeps = {}): AdvisorEscalationFn {
  return async (input: AdvisorEscalationInput): Promise<AdvisorEscalationResult | null> => {
    const prompt = buildAdvisorPrompt(input);
    try {
      const result = await callAdvisorAssisted(
        {
          userMessage: prompt,
          executor: EXECUTOR_SONNET,
          advisor: ADVISOR_OPUS,
          // Cap at 1 advisor sub-inference per brain decision — single
          // high-quality second opinion, not a multi-turn debate.
          maxAdvisorUses: 1,
          maxTokens: 800,
          additionalSystemPrompt:
            'You are reviewing a compliance verdict produced by the Weaponized Brain. ' +
            'The verdict itself is already decided — do not attempt to change it. ' +
            'Your job is to produce a short (<=100 words) rationale the MLRO can paste ' +
            'into the case file, citing the specific UAE regulation that justifies the ' +
            'verdict. Enumerated steps, not prose.',
        },
        deps
      );
      return {
        text: result.text,
        advisorCallCount: result.advisorCallCount,
        modelUsed: ADVISOR_OPUS,
      };
    } catch (err) {
      // Never throw — log to console for ops visibility and return null.
      console.warn(`[brainBridge] advisor escalation failed: ${(err as Error).message}`);
      return null;
    }
  };
}

/** Build the advisor user prompt from an escalation input. */
function buildAdvisorPrompt(input: AdvisorEscalationInput): string {
  const clamps =
    input.clampReasons.length > 0
      ? input.clampReasons.map((r) => `  - ${r}`).join('\n')
      : '  (none)';
  return (
    `Compliance verdict review — ${input.reason}\n\n` +
    `Entity: ${input.entityName} (id: ${input.entityId})\n` +
    `Verdict: ${input.verdict}\n` +
    `Confidence: ${(input.confidence * 100).toFixed(1)}%\n\n` +
    `Clamp reasons:\n${clamps}\n\n` +
    `Full narrative:\n${input.narrative}\n\n` +
    `Produce a <=100 word rationale citing the specific UAE regulation that ` +
    `justifies this verdict. Enumerated steps, not prose. Do not attempt to ` +
    `change the verdict.`
  );
}

/**
 * Run the Weaponized Brain (all 19 subsystems) with the default advisor
 * escalation pre-wired. This is the production entry point for any
 * compliance decision that wants the full multi-subsystem treatment plus
 * Opus-backed second opinion on high-stakes verdicts.
 *
 * Pass `advisor: null` in options to disable the advisor (offline mode).
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21, Cabinet Res 134/2025 Art.19.
 */
export async function runWeaponizedAssessment(
  req: Omit<WeaponizedBrainRequest, 'advisor'>,
  options: { advisor?: AdvisorEscalationFn | null } = {}
): Promise<WeaponizedBrainResponse> {
  const advisor =
    options.advisor === null ? undefined : (options.advisor ?? createDefaultAdvisorEscalation());
  return runWeaponizedBrain({ ...req, advisor });
}

/**
 * Run the Weaponized Brain AND notify the serverless brain endpoint with a
 * summary event reflecting the final verdict. Returns the full response
 * locally so the caller can render the reasoning chain, extension outputs,
 * and advisor rationale immediately.
 *
 * This is the one-call entry point for UI code that needs both the decision
 * and the audit-trail persistence in a single await.
 */
export async function weaponizeFullAssessment(
  req: Omit<WeaponizedBrainRequest, 'advisor'>,
  options: { blocking?: boolean; advisor?: AdvisorEscalationFn | null } = {}
): Promise<WeaponizedBrainResponse> {
  const result = await runWeaponizedAssessment(req, { advisor: options.advisor });

  const megaBridge: BrainEvent = {
    kind: weaponizedVerdictToBridgeKind(result.finalVerdict),
    severity: weaponizedVerdictToBridgeSeverity(result.finalVerdict),
    summary:
      `WeaponizedBrain: ${req.mega.entity.name} → ${result.finalVerdict} ` +
      `(${result.mega.recommendedAction})`.slice(0, CAP_SUMMARY),
    subject: req.mega.entity.name.slice(0, CAP_SUBJECT),
    refId: req.mega.entity.id.slice(0, CAP_REFID),
    meta: {
      megaVerdict: result.mega.verdict,
      finalVerdict: result.finalVerdict,
      confidence: result.confidence,
      requiresHumanReview: result.requiresHumanReview,
      clampCount: result.clampReasons.length,
      subsystemFailures: result.subsystemFailures,
      advisorCalls: result.advisorResult?.advisorCallCount ?? 0,
      extensions: {
        adverseMedia: result.extensions.adverseMedia
          ? {
              totalHits: result.extensions.adverseMedia.ranked.length,
              topCategory: result.extensions.adverseMedia.topCategory,
              critical: result.extensions.adverseMedia.counts.critical,
            }
          : null,
        ubo: result.extensions.ubo
          ? {
              hasSanctionedUbo: result.extensions.ubo.summary.hasSanctionedUbo,
              undisclosedPercentage: result.extensions.ubo.summary.undisclosedPercentage,
              layeringDepth: result.extensions.ubo.layering.maxDepth,
              shellCompanyVerdict: result.extensions.ubo.shellCompany.verdict,
            }
          : null,
        wallets: result.extensions.wallets
          ? {
              total: result.extensions.wallets.total,
              confirmedHits: result.extensions.wallets.confirmedHits,
              highestScore: result.extensions.wallets.highestScore,
            }
          : null,
        transactionAnomalies: result.extensions.transactionAnomalies
          ? {
              findings: result.extensions.transactionAnomalies.findings.length,
              detectorStats: result.extensions.transactionAnomalies.detectorStats,
            }
          : null,
        explainableScore: result.extensions.explanation
          ? {
              score: result.extensions.explanation.score,
              rating: result.extensions.explanation.rating,
              cddLevel: result.extensions.explanation.cddLevel,
            }
          : null,
        proofBundle: result.extensions.proofBundle
          ? {
              rootHash: result.extensions.proofBundle.rootHash.slice(0, 16),
              recordCount: result.extensions.proofBundle.recordCount,
              sealedAt: result.extensions.proofBundle.sealedAt,
            }
          : null,
      },
      chainId: result.mega.chain.id,
      topic: result.mega.topic,
    },
  };

  if (options.blocking) {
    await notifyBrainBlocking(megaBridge);
  } else {
    notifyBrain(megaBridge);
  }

  return result;
}

function weaponizedVerdictToBridgeKind(
  verdict: WeaponizedBrainResponse['finalVerdict']
): BrainEventKind {
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

function weaponizedVerdictToBridgeSeverity(
  verdict: WeaponizedBrainResponse['finalVerdict']
): BrainSeverity {
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
