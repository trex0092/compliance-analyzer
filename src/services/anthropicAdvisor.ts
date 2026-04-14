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
  ADVISOR_BETA_HEADER,
  COMPLIANCE_ADVISOR_SYSTEM_PROMPT,
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
  /** Request timeout ms. Default: 15000. */
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

async function callProxy(
  proxyUrl: string,
  bearer: string | undefined,
  body: Record<string, unknown>,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<AdvisorEscalationResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;

  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller !== null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetchImpl(proxyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    if (!res.ok) {
      throw new Error(`ai-proxy returned ${res.status}`);
    }
    const payload = (await res.json()) as AnthropicResponseShape;
    const text = extractText(payload);
    const lint = lintForTippingOff(text);
    if (!lint.clean && (lint.topSeverity === 'critical' || lint.topSeverity === 'high')) {
      throw new Error(
        `advisor response blocked by FDL Art.29 linter: ` +
          lint.findings.map((f) => f.patternId).join(',')
      );
    }
    return {
      text: text.slice(0, 1000), // hard cap just in case the model ignores <100 words
      advisorCallCount: 1,
      modelUsed: payload.model ?? 'claude-opus-4-6',
    };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
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
export function createAnthropicAdvisor(
  opts: AnthropicAdvisorOptions = {}
): AdvisorEscalationFn {
  const proxyUrl = opts.proxyUrl ?? '/api/ai-proxy';
  const executor = opts.executor ?? EXECUTOR_SONNET;
  const advisor = opts.advisor ?? ADVISOR_OPUS;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const warnOnFallback = opts.warnOnFallback ?? true;
  const fetchImpl =
    opts.fetchImpl ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  if (!fetchImpl) {
    // Environments without a fetch at all (very old Node) — always
    // fall back deterministically.
    return async (input) => deterministicAdvisor(input);
  }

  return async (input: AdvisorEscalationInput): Promise<AdvisorEscalationResult> => {
    const body = {
      provider: 'anthropic',
      path: '/v1/messages',
      betas: [ADVISOR_BETA_HEADER],
      body: {
        model: executor,
        max_tokens: 512,
        system: COMPLIANCE_ADVISOR_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildUserMessage(input),
          },
        ],
        metadata: {
          user_id: input.entityId,
        },
        // Advisor pairing declaration — the executor model above
        // uses this advisor as its back-channel reviewer.
        advisor: { model: advisor },
      },
    };

    try {
      return await callProxy(
        proxyUrl,
        opts.bearerToken,
        body,
        timeoutMs,
        fetchImpl
      );
    } catch (err) {
      if (warnOnFallback) {
        console.warn(
          '[anthropicAdvisor] falling back to deterministic advisor:',
          err instanceof Error ? err.message : String(err)
        );
      }
      return deterministicAdvisor(input);
    }
  };
}

// Exports for tests.
export const __test__ = { buildUserMessage, extractText };
