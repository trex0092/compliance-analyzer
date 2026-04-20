/**
 * Anthropic-backed advisor runner.
 *
 * Builds an AdvisorEscalationFn that calls the real Claude Opus 4.6
 * via the existing `/api/ai-proxy` Netlify function. When the proxy
 * is unreachable or the environment is offline, the function falls
 * back to the deterministic advisor from brainSuperRunner so the
 * decision path never blocks.
 *
 * Why not call api.anthropic.com directly?
 *   - Keys live server-side in Netlify env vars; the browser and
 *     the src/ modules never see them
 *   - ai-proxy already validates the request + rate-limits + auths
 *   - Forwarding happens once, in a single request, with the
 *     correct beta header (advisor-tool-2026-03-01) already in the
 *     allowlist
 *
 * Why still provide a fallback?
 *   - Tests run offline (no fetch)
 *   - Air-gapped deployments that cannot reach the Claude API must
 *     still produce an auditable advisor decision
 *   - Anthropic API outages must not freeze the compliance pipeline
 *
 * Prompt discipline:
 *   The request builder uses COMPLIANCE_ADVISOR_SYSTEM_PROMPT
 *   from advisorStrategy.ts, which bakes in the six mandatory
 *   escalation triggers and the <100-words response directive.
 *   We do NOT pass entity legal names into the system prompt —
 *   only the deterministic evidence fields (verdict, confidence,
 *   clampReasons, narrative). The Art.29 tipping-off linter runs
 *   on the response text before it is returned.
 *
 * Transport discipline (stream idle timeout fix):
 *   This module used to hand-roll a non-streaming POST whose body
 *   shape also did not match what `/api/ai-proxy` destructures
 *   (`{ body: {...} }` vs the proxy's `{ payload: {...} }`). That
 *   bug had two consequences in production:
 *     1. The proxy forwarded `undefined` as the request body, so
 *        Anthropic rejected every call and the MLRO silently saw
 *        deterministic-fallback advice on every escalation.
 *     2. On the paths where it did reach upstream, the non-stream
 *        proxy timeout (22s) fired mid-Opus-call (Opus advisor
 *        sub-inferences routinely run 20-40s) and the caller saw
 *        "Stream idle timeout - partial response received".
 *   We now route through `callAdvisorAssisted`, which builds the
 *   correct `payload` shape, uses the official advisor tool type,
 *   and enables SSE streaming so the proxy's `: keepalive` comment
 *   frames hold the socket open during quiet thinking windows.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO duty — advisor escalation)
 *   FDL No.10/2025 Art.29    (no tipping off — linter on response)
 *   Cabinet Res 134/2025 Art.14, Art.19
 *   NIST AI RMF 1.0 MANAGE-2 (AI decision provenance)
 */

import type {
  AdvisorEscalationFn,
  AdvisorEscalationInput,
  AdvisorEscalationResult,
} from './weaponizedBrain';
import { deterministicAdvisor } from './brainSuperRunner';
import {
  EXECUTOR_SONNET,
  ADVISOR_OPUS,
  callAdvisorAssisted,
  type FetchLike,
} from './advisorStrategy';
import { lintForTippingOff } from './tippingOffLinter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnthropicAdvisorOptions {
  /** Base URL of the ai-proxy. Default: `/api/ai-proxy`. */
  proxyUrl?: string;
  /** Executor model. Default: claude-sonnet-4-6. */
  executor?: string;
  /** Advisor model. Default: claude-opus-4-6. */
  advisor?: string;
  /**
   * Wall-clock cap on a single advisor call, in ms. Default: 120_000.
   *
   * This is deliberately larger than the proxy's own streaming
   * wall-clock (STREAM_WALL_CLOCK_MS = 24s) and the inter-byte
   * watchdog (STREAM_IDLE_READ_TIMEOUT_MS = 30s) so that the
   * tighter server-side limits fire first and surface structured
   * errors. The client-side timer exists only as a backstop for
   * a genuinely wedged network. Callers that need a tighter bound
   * (e.g. synchronous UI paths) can still pass a smaller value;
   * the deterministic fallback keeps the decision path unblocked.
   */
  timeoutMs?: number;
  /** HAWKEYE bearer token for the proxy. Default: from window or env. */
  bearerToken?: string;
  /**
   * Optional fetch override — inject for tests. If omitted, uses
   * globalThis.fetch so the module stays browser + edge-runtime
   * safe without a Node-specific import.
   */
  fetchImpl?: typeof fetch;
  /**
   * When true, log a console.warn on fallback to deterministic.
   * Default true — MLROs need to see when the live advisor is
   * unreachable.
   */
  warnOnFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function buildUserMessage(input: AdvisorEscalationInput): string {
  // Deterministic, entity-name-free prompt body. All fields pass
  // through the tipping-off linter upstream (in runComplianceDecision)
  // so the advisor never sees subject-identifying language from
  // other subsystems.
  return [
    'A compliance decision needs your second opinion.',
    '',
    `Reason for escalation: ${input.reason}`,
    `Current verdict: ${input.verdict}`,
    `Confidence: ${input.confidence.toFixed(3)}`,
    `Entity reference (opaque): ${input.entityId}`,
    `Entity label (opaque): ${input.entityName}`,
    '',
    input.clampReasons.length > 0
      ? `Safety clamps fired:\n${input.clampReasons.map((r) => '  - ' + r).join('\n')}`
      : 'Safety clamps fired: none',
    '',
    'Audit narrative so far:',
    input.narrative,
    '',
    'Respond in under 100 words with enumerated steps. No explanations.',
  ].join('\n');
}

interface AnthropicResponseShape {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function extractText(payload: AnthropicResponseShape): string {
  if (!payload || !Array.isArray(payload.content)) return '';
  const parts = payload.content
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => (c.text ?? '').trim());
  return parts.join('\n').trim();
}

/**
 * Build an AdvisorEscalationFn bound to the Anthropic API via the
 * ai-proxy Netlify function. Falls back to the deterministic
 * advisor when the proxy is unreachable, the request times out,
 * or the response fails the FDL Art.29 linter.
 */
export function createAnthropicAdvisor(opts: AnthropicAdvisorOptions = {}): AdvisorEscalationFn {
  const proxyUrl = opts.proxyUrl ?? '/api/ai-proxy';
  const executor = opts.executor ?? EXECUTOR_SONNET;
  const advisor = opts.advisor ?? ADVISOR_OPUS;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const warnOnFallback = opts.warnOnFallback ?? true;
  const fetchImpl =
    opts.fetchImpl ??
    (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  if (!fetchImpl) {
    // Environments without a fetch at all (very old Node) — always
    // fall back deterministically.
    return async (input) => deterministicAdvisor(input);
  }

  return async (input: AdvisorEscalationInput): Promise<AdvisorEscalationResult> => {
    // Wall-clock backstop. The proxy's own stream wall-clock (24s)
    // and inter-byte watchdog (30s) fire first in normal operation;
    // this exists only to rescue the fallback path when the network
    // itself is wedged and the server-side timers can't reach us.
    const wallClock =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const wallClockTimer =
      wallClock !== null ? setTimeout(() => wallClock.abort(), timeoutMs) : null;

    const abortableFetch: FetchLike = (async (url, init) => {
      const res = await fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: wallClock?.signal,
      });
      return {
        ok: res.ok,
        status: res.status,
        json: () => res.json(),
        body: res.body,
      };
    }) as FetchLike;

    try {
      const result = await callAdvisorAssisted(
        {
          userMessage: buildUserMessage(input),
          executor,
          advisor,
          maxAdvisorUses: 1,
          maxTokens: 512,
          // Stream so `/api/ai-proxy` injects `: keepalive\n\n` SSE
          // comments during Opus thinking windows. Without this the
          // caller sees "Stream idle timeout - partial response
          // received" whenever the advisor pauses mid-flight.
          stream: true,
        },
        {
          endpoint: proxyUrl,
          authToken: opts.bearerToken,
          fetch: abortableFetch,
        }
      );

      const text = extractText({
        content: [{ type: 'text', text: result.text }],
      });
      const lint = lintForTippingOff(text);
      if (!lint.clean && (lint.topSeverity === 'critical' || lint.topSeverity === 'high')) {
        throw new Error(
          `advisor response blocked by FDL Art.29 linter: ` +
            lint.findings.map((f) => f.patternId).join(',')
        );
      }

      return {
        text: text.slice(0, 1000),
        advisorCallCount: result.advisorCallCount > 0 ? result.advisorCallCount : 1,
        modelUsed: advisor,
      };
    } catch (err) {
      if (warnOnFallback) {
        console.warn(
          '[anthropicAdvisor] falling back to deterministic advisor:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return deterministicAdvisor(input);
    } finally {
      if (wallClockTimer !== null) clearTimeout(wallClockTimer);
    }
  };
}

// Exports for tests.
export const __test__ = { buildUserMessage, extractText };
