/**
 * Advisor Strategy — worker + advisor model pairing for compliance calls.
 *
 * Implements the pattern described in the Anthropic engineering post
 * "The advisor strategy: Give Sonnet an intelligence boost with Opus"
 * (https://claude.com/blog/the-advisor-strategy) and the formal API
 * reference at
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool
 *
 * Pattern summary:
 *   - A fast executor model (Sonnet 4.6 or Haiku 4.5) runs the task
 *     end-to-end: reads tool results, iterates, and produces the final
 *     user-facing output.
 *   - When the executor needs strategic guidance, it calls the
 *     server-side `advisor` tool. Anthropic runs a sub-inference on
 *     a more capable advisor model (Opus 4.6) with the full transcript,
 *     and returns 400-700 text tokens of advice back to the executor.
 *   - All of this happens inside a single /v1/messages request. No
 *     extra round trips on the client.
 *
 * Why it matters for this project:
 *   - Compliance-critical decisions (sanctions confirmations, STR
 *     narrative drafts, threshold edge cases, freeze protocol entry)
 *     need frontier-level reasoning, but the bulk of a compliance
 *     session is mechanical (file reads, search, status checks).
 *   - The advisor strategy lets us pay Sonnet rates for the routine
 *     work and only escalate to Opus when the model itself decides
 *     it needs help — matching the "Model Routing: Worker + Advisor"
 *     rule in CLAUDE.md "Claude Code Harness Patterns" §1.
 *
 * Regulatory basis for the escalation prompt:
 *   - FDL No.10/2025 Art.20-21 (Compliance Officer duty of care)
 *   - Cabinet Res 134/2025 Art.19 (internal review before decision)
 *   - FATF Rec 18 (internal controls proportionate to risk)
 *
 * This module is browser-safe: it uses the fetch API and has no Node
 * dependencies. The HTTP transport is injectable so tests can run
 * without real network calls.
 */

// ---------------------------------------------------------------------------
// Constants — authoritative spec values from Anthropic's API docs.
// ---------------------------------------------------------------------------

/** Beta header value that enables the advisor tool on /v1/messages. */
export const ADVISOR_BETA_HEADER = 'advisor-tool-2026-03-01';

/** Tool type identifier required by the advisor tool definition. */
export const ADVISOR_TOOL_TYPE = 'advisor_20260301';

/** Canonical executor model IDs recognised by the advisor tool. */
export const EXECUTOR_SONNET = 'claude-sonnet-4-6';
export const EXECUTOR_HAIKU = 'claude-haiku-4-5-20251001';
export const EXECUTOR_OPUS = 'claude-opus-4-6';

/** Canonical advisor model ID (must be at least as capable as executor). */
export const ADVISOR_OPUS = 'claude-opus-4-6';

/**
 * Valid executor → advisor pairings as documented at
 * platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool.
 * Any other combination returns 400 invalid_request_error from the API.
 */
export const VALID_PAIRS: ReadonlyArray<{ executor: string; advisor: string }> = [
  { executor: EXECUTOR_HAIKU, advisor: ADVISOR_OPUS },
  { executor: EXECUTOR_SONNET, advisor: ADVISOR_OPUS },
  { executor: EXECUTOR_OPUS, advisor: ADVISOR_OPUS },
] as const;

// ---------------------------------------------------------------------------
// Compliance-specific system prompt
// ---------------------------------------------------------------------------

/**
 * Base advisor timing + treatment block, adapted verbatim from Anthropic's
 * suggested coding-task prompt with two additions for compliance work:
 *
 *   1. Explicit escalation triggers tied to UAE AML/CFT/CPF decisions.
 *   2. Conciseness directive (advisor responds in <100 words, enumerated
 *      steps) — per Anthropic's finding that this cuts advisor output by
 *      35-45% without changing call frequency.
 */
export const COMPLIANCE_ADVISOR_SYSTEM_PROMPT = `You have access to an \`advisor\` tool backed by a stronger reviewer model. It takes NO parameters — when you call advisor(), your entire conversation history is automatically forwarded. The advisor sees the task, every tool call you've made, every result you've seen.

Call advisor BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. If the task requires orientation first (finding records, fetching a source, seeing what's there), do that, then call advisor. Orientation is not substantive work. Declaring a verdict, drafting a filing, and confirming a match are.

MANDATORY compliance triggers — always call advisor before:
  1. Confirming a sanctions match at confidence >= 0.5 (FDL Art.20, Cabinet Res 74/2020 Art.4-7)
  2. Interpreting a threshold edge case (AED 55K CTR, AED 60K cross-border, 25% UBO)
  3. Drafting an STR / SAR / CTR / DPMSR / CNMR narrative (FDL Art.26-27)
  4. Committing to a verdict of "freeze" or "escalate"
  5. Changing the recommended CDD level (SDD → CDD → EDD)
  6. Finalising any decision that would be visible to the subject (never tip off — FDL Art.29)

Also call advisor:
  - When you believe the task is complete. BEFORE this call, make your deliverable durable: persist the case record, stage the filing, commit the evidence. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.
  - When stuck — errors recurring, interpretation unclear, results that don't fit.
  - When considering a change of approach.

Give the advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim (the record says X, the regulation states Y), adapt. A passing self-test is not evidence the advice is wrong — it's evidence your test doesn't check what the advice is checking.

If you've already retrieved data pointing one way and the advisor points another: don't silently switch. Surface the conflict in one more advisor call — "I found X, you suggest Y, which Article breaks the tie?" The advisor saw your evidence but may have underweighted it; a reconcile call is cheaper than committing to the wrong branch.

The advisor should respond in under 100 words and use enumerated steps, not explanations.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Inputs required to build a single advisor-enabled API request. */
export interface AdvisorRequestInput {
  /** The user's task / question. Free-text. */
  userMessage: string;
  /** Executor model. Defaults to Sonnet 4.6. Must be a valid pair with advisor. */
  executor?: string;
  /** Advisor model. Defaults to Opus 4.6. */
  advisor?: string;
  /** Max tokens for the executor's output. Defaults to 4096. */
  maxTokens?: number;
  /** Additional system prompt appended AFTER the compliance timing block. */
  additionalSystemPrompt?: string;
  /** Cap on advisor calls per request (optional — unlimited by default). */
  maxAdvisorUses?: number;
  /** Enable ephemeral caching of the advisor transcript. Only helpful at 3+ calls. */
  advisorCaching?: { type: 'ephemeral'; ttl: '5m' | '1h' };
  /** Any extra client-side tools to include alongside the advisor tool. */
  additionalTools?: ReadonlyArray<Record<string, unknown>>;
}

/** Shape of the POST body that gets sent to /api/ai-proxy. */
export interface AiProxyBody {
  provider: 'anthropic';
  path: '/v1/messages';
  betas: string[];
  payload: {
    model: string;
    max_tokens: number;
    system: string;
    tools: Array<Record<string, unknown>>;
    messages: Array<{ role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }>;
  };
}

/** Advisor-aware response result extracted from the Anthropic API. */
export interface AdvisorCallResult {
  /** Combined executor output text. */
  text: string;
  /** Number of advisor sub-inferences that actually ran in this turn. */
  advisorCallCount: number;
  /** Aggregated executor + advisor token usage. */
  usage: {
    executorInputTokens: number;
    executorOutputTokens: number;
    advisorInputTokens: number;
    advisorOutputTokens: number;
  };
  /** Raw API response — passed through for callers that need full fidelity. */
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Throws a descriptive Error if the given executor/advisor pair is not on
 * the allowlist documented at
 * platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool.
 *
 * We check locally because the API error is 400 invalid_request_error
 * with a generic message, and by the time it comes back we've already
 * burnt a round trip. Fail fast in the client.
 */
export function validateExecutorAdvisorPair(executor: string, advisor: string): void {
  const ok = VALID_PAIRS.some((p) => p.executor === executor && p.advisor === advisor);
  if (!ok) {
    const valid = VALID_PAIRS.map((p) => `${p.executor} -> ${p.advisor}`).join(', ');
    throw new Error(
      `Invalid executor/advisor pair: ${executor} -> ${advisor}. Valid pairs: ${valid}`
    );
  }
}

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

/**
 * Build an ai-proxy request body for an advisor-enabled /v1/messages call.
 *
 * The result is suitable for POSTing to /api/ai-proxy, which will forward
 * `betas` as the `anthropic-beta` header (see netlify/functions/ai-proxy.mts).
 *
 * Pure function — does no I/O, does not throw except on validation errors.
 */
export function buildAdvisorRequest(input: AdvisorRequestInput): AiProxyBody {
  const executor = input.executor ?? EXECUTOR_SONNET;
  const advisor = input.advisor ?? ADVISOR_OPUS;
  validateExecutorAdvisorPair(executor, advisor);

  const systemPrompt = input.additionalSystemPrompt
    ? `${COMPLIANCE_ADVISOR_SYSTEM_PROMPT}\n\n${input.additionalSystemPrompt}`
    : COMPLIANCE_ADVISOR_SYSTEM_PROMPT;

  const advisorTool: Record<string, unknown> = {
    type: ADVISOR_TOOL_TYPE,
    name: 'advisor',
    model: advisor,
  };
  if (typeof input.maxAdvisorUses === 'number' && input.maxAdvisorUses > 0) {
    advisorTool.max_uses = input.maxAdvisorUses;
  }
  if (input.advisorCaching) {
    advisorTool.caching = input.advisorCaching;
  }

  const tools: Array<Record<string, unknown>> = [advisorTool];
  if (input.additionalTools && input.additionalTools.length > 0) {
    tools.push(...input.additionalTools);
  }

  return {
    provider: 'anthropic',
    path: '/v1/messages',
    betas: [ADVISOR_BETA_HEADER],
    payload: {
      model: executor,
      max_tokens: input.maxTokens ?? 4096,
      system: systemPrompt,
      tools,
      messages: [{ role: 'user', content: input.userMessage }],
    },
  };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface RawAnthropicResponse {
  content?: Array<{ type: string; text?: string; name?: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    iterations?: Array<{
      type: string;
      input_tokens?: number;
      output_tokens?: number;
    }>;
  };
}

/**
 * Parse a raw Anthropic response into our condensed AdvisorCallResult.
 *
 * Rules:
 *   - Concatenate all text blocks (the executor's final written output).
 *   - Count the number of server_tool_use blocks named "advisor" — that's
 *     the number of advisor sub-inferences the executor invoked.
 *   - Roll up executor vs advisor token usage from usage.iterations per
 *     the spec (iterations with type "advisor_message" are advisor, rest
 *     are executor).
 */
export function parseAdvisorResponse(raw: unknown): AdvisorCallResult {
  const response = (raw ?? {}) as RawAnthropicResponse;
  const content = Array.isArray(response.content) ? response.content : [];

  const text = content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  const advisorCallCount = content.filter(
    (block) => block.type === 'server_tool_use' && block.name === 'advisor'
  ).length;

  const usage = {
    executorInputTokens: 0,
    executorOutputTokens: 0,
    advisorInputTokens: 0,
    advisorOutputTokens: 0,
  };

  const iterations = response.usage?.iterations ?? [];
  for (const it of iterations) {
    if (it.type === 'advisor_message') {
      usage.advisorInputTokens += it.input_tokens ?? 0;
      usage.advisorOutputTokens += it.output_tokens ?? 0;
    } else {
      usage.executorInputTokens += it.input_tokens ?? 0;
      usage.executorOutputTokens += it.output_tokens ?? 0;
    }
  }

  // If iterations are absent, fall back to top-level usage as executor-only.
  if (iterations.length === 0 && response.usage) {
    usage.executorInputTokens = response.usage.input_tokens ?? 0;
    usage.executorOutputTokens = response.usage.output_tokens ?? 0;
  }

  return { text, advisorCallCount, usage, raw };
}

// ---------------------------------------------------------------------------
// Transport — injectable so tests can run without touching the network.
// ---------------------------------------------------------------------------

/**
 * Minimal fetch-like transport. Matches the subset of the global fetch
 * surface we actually use, which makes it trivial to mock in tests.
 */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface AdvisorCallDeps {
  /** HTTP transport. Defaults to the global fetch at call time. */
  fetch?: FetchLike;
  /** Endpoint to POST to. Defaults to the project's own ai-proxy. */
  endpoint?: string;
  /** Bearer token for the proxy. If omitted, reads `auth.token` from
   *  localStorage (matching the existing brainBridge.ts pattern). */
  authToken?: string;
}

function defaultFetch(): FetchLike {
  return ((input, init) => fetch(input, init)) as FetchLike;
}

function defaultAuthToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem('auth.token');
  } catch {
    return null;
  }
}

/**
 * Execute an advisor-enabled call end-to-end: build the request, POST to
 * the ai-proxy, and parse the response.
 *
 * Throws on:
 *   - Invalid executor/advisor pair (validation error, local — no round trip)
 *   - Missing auth token
 *   - Non-2xx response from the proxy
 *   - Invalid JSON from the proxy
 *
 * Does NOT throw on advisor sub-inference errors (overloaded, rate limited,
 * prompt_too_long) — those come back inside the advisor_tool_result and the
 * executor continues without advice. The result's `advisorCallCount` will
 * reflect only successful calls.
 */
export async function callAdvisorAssisted(
  input: AdvisorRequestInput,
  deps: AdvisorCallDeps = {}
): Promise<AdvisorCallResult> {
  const body = buildAdvisorRequest(input);

  const token = deps.authToken ?? defaultAuthToken();
  if (!token) {
    throw new Error('callAdvisorAssisted: no auth token (set deps.authToken or localStorage["auth.token"])');
  }

  const endpoint = deps.endpoint ?? '/api/ai-proxy';
  const fetchImpl = deps.fetch ?? defaultFetch();

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`callAdvisorAssisted: proxy returned HTTP ${res.status}`);
  }

  const raw = await res.json();
  return parseAdvisorResponse(raw);
}
