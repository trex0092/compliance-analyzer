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
  /**
   * Request an SSE-streamed response from /api/ai-proxy.
   *
   * Why enable this: Opus advisor sub-inferences routinely run 20-40s
   * end-to-end, during which no bytes flow over the socket. Intermediate
   * proxies (Netlify Edge, corporate TLS terminators, the browser) enforce
   * idle-read timeouts in the 30-60s range and will close an otherwise
   * healthy connection, surfacing as "Stream idle timeout - partial
   * response received". The /api/ai-proxy Netlify function injects
   * `: keepalive` SSE comments every 10s when it sees `stream: true`, so
   * the TCP write window never goes idle long enough to trip those
   * timers. Without this flag the caller gets the non-streaming path
   * and loses the keepalive protection.
   *
   * Default: undefined (non-streaming) to preserve backwards compat.
   * Production callers should set this to true — see
   * brainBridge.createDefaultAdvisorEscalation.
   */
  stream?: boolean;
}

/** Shape of the POST body that gets sent to /api/ai-proxy. */
export interface AiProxyBody {
  provider: 'anthropic';
  path: '/v1/messages';
  betas: string[];
  /**
   * Top-level stream flag read by /api/ai-proxy. When true, the proxy
   * uses its streaming code path (extended upstream timeout + SSE
   * keepalive comment injection). See ai-proxy.mts STREAM_KEEPALIVE_MS.
   */
  stream?: boolean;
  payload: {
    model: string;
    max_tokens: number;
    system: string;
    tools: Array<Record<string, unknown>>;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string | Array<Record<string, unknown>>;
    }>;
    /**
     * Inner stream flag read by Anthropic's /v1/messages. Must be
     * mirrored alongside the top-level flag above — the proxy only
     * controls its own connection behaviour, Anthropic only emits
     * SSE when its own payload asks for it.
     */
    stream?: boolean;
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

  const body: AiProxyBody = {
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

  if (input.stream) {
    body.stream = true;
    body.payload.stream = true;
  }

  return body;
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
 *
 * The optional `body` field is only consumed on the streaming path
 * (input.stream === true). Non-streaming callers can ignore it and
 * return `{ ok, status, json }` as before.
 */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  body?: ReadableStream<Uint8Array> | null;
}>;

/**
 * Accumulate an Anthropic SSE stream into the same `RawAnthropicResponse`
 * shape that parseAdvisorResponse understands. We reconstruct the content
 * blocks and the usage totals as the events arrive, so downstream parsing
 * stays identical between streaming and non-streaming callers.
 *
 * Events we care about (anthropic-sdk / API docs):
 *   message_start         → carries initial usage.input_tokens
 *   content_block_start   → opens a block (text, server_tool_use, etc.)
 *   content_block_delta   → appends to the current block (text_delta, input_json_delta)
 *   content_block_stop    → closes the block
 *   message_delta         → carries usage.output_tokens on completion
 *   message_stop          → end-of-stream marker (no payload of interest)
 *   error                 → stream-level error (surfaces as thrown error)
 *   ping / : keepalive    → ignored — these exist precisely to hold the
 *                           socket open during idle gaps
 *
 * Ignoring unknown events is deliberate: Anthropic has added new event
 * types over time (e.g. server_tool_use sub-events) and the advisor
 * transcript only needs the text + usage totals.
 */
/**
 * Maximum time we'll wait between any two bytes on an advisor stream.
 *
 * The server-side proxy emits `: keepalive` SSE comment frames every 10s
 * (see ai-proxy.mts STREAM_KEEPALIVE_MS). If 60s pass without ANY byte
 * — not even a keepalive — the upstream is not merely thinking, it's
 * gone. Without this watchdog the `reader.read()` loop can hang
 * indefinitely if a middlebox silently half-closes the socket, which
 * is the same failure mode reported upstream in anthropics/claude-code
 * issue #25979. Fail fast and let the caller fall back to the
 * deterministic advisor (anthropicAdvisor.ts handles this).
 */
const STREAM_IDLE_READ_TIMEOUT_MS = 60_000;

async function accumulateAdvisorStream(
  stream: ReadableStream<Uint8Array>
): Promise<RawAnthropicResponse> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const content: Array<{ type: string; text?: string; name?: string }> = [];
  const usage: RawAnthropicResponse['usage'] = { input_tokens: 0, output_tokens: 0 };

  /**
   * Race each read against a timer. If no byte arrives within
   * STREAM_IDLE_READ_TIMEOUT_MS, cancel the reader and throw a
   * diagnosable error. Keepalive comment frames count as bytes, so
   * this only fires on a truly silent connection.
   */
  const readWithIdleTimeout = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `advisor stream idle for >${STREAM_IDLE_READ_TIMEOUT_MS}ms — upstream stalled`
          )
        );
      }, STREAM_IDLE_READ_TIMEOUT_MS);
    });
    try {
      return await Promise.race([reader.read(), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  try {
    for (;;) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await readWithIdleTimeout();
      } catch (err) {
        // Watchdog fired — cancel the upstream read so we don't leak
        // the TCP socket, then rethrow so the caller can fall back.
        try {
          await reader.cancel(err instanceof Error ? err : new Error(String(err)));
        } catch {
          /* reader already detached */
        }
        throw err;
      }
      const { value, done } = result;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line. Split conservatively so
      // a partial frame at the tail of the buffer is kept for the next
      // chunk instead of dropped.
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');

        // Comment frames (":keepalive") are how the proxy prevents idle
        // timeouts — skip them before we try to parse as JSON.
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        const dataJson = dataLines.join('\n');
        if (!dataJson || dataJson === '[DONE]') continue;

        let event: {
          type?: string;
          index?: number;
          content_block?: { type?: string; text?: string; name?: string };
          delta?: { type?: string; text?: string };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          usage?: { input_tokens?: number; output_tokens?: number };
          error?: { message?: string; type?: string };
        };
        try {
          event = JSON.parse(dataJson);
        } catch {
          // Malformed frame — skip rather than throw, so a single bad
          // line can't tear down a long-running advisor transcript.
          continue;
        }

        if (event.type === 'error') {
          const msg = event.error?.message ?? 'advisor stream error';
          throw new Error(`advisor SSE error: ${msg}`);
        }

        if (event.type === 'message_start' && event.message?.usage) {
          usage.input_tokens = event.message.usage.input_tokens ?? usage.input_tokens;
          usage.output_tokens = event.message.usage.output_tokens ?? usage.output_tokens;
          continue;
        }

        if (event.type === 'content_block_start' && typeof event.index === 'number') {
          const block = event.content_block ?? { type: 'text' };
          content[event.index] = {
            type: block.type ?? 'text',
            text: block.type === 'text' ? '' : undefined,
            name: block.name,
          };
          continue;
        }

        if (event.type === 'content_block_delta' && typeof event.index === 'number') {
          const existing = content[event.index] ?? { type: 'text', text: '' };
          if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
            existing.text = (existing.text ?? '') + event.delta.text;
          }
          content[event.index] = existing;
          continue;
        }

        if (event.type === 'message_delta' && event.usage) {
          if (typeof event.usage.output_tokens === 'number') {
            usage.output_tokens = event.usage.output_tokens;
          }
          if (typeof event.usage.input_tokens === 'number') {
            usage.input_tokens = event.usage.input_tokens;
          }
          continue;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Drop undefined gaps in the sparse array (content blocks arrive in order
  // but via indexed events, so an in-flight disconnect could leave holes).
  return {
    content: content.filter((b) => b !== undefined),
    usage,
  };
}

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

  // Use || (not ??) so an explicit empty string falls through to the
  // localStorage fallback. An empty bearer token would always be rejected
  // upstream, so treating '' as "no token provided" is safer than sending
  // an empty Authorization header and getting a confusing 401.
  const token = deps.authToken || defaultAuthToken();
  if (!token) {
    throw new Error(
      'callAdvisorAssisted: no auth token (set deps.authToken or localStorage["auth.token"])'
    );
  }

  const endpoint = deps.endpoint ?? '/api/ai-proxy';
  const fetchImpl = deps.fetch ?? defaultFetch();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  // Signal SSE intent to any intermediary (Netlify Edge, corporate
  // proxies) so content negotiation and buffering flip to the
  // streaming path. The ai-proxy keepalive only works end-to-end
  // when every hop treats the response as text/event-stream.
  if (input.stream) headers['Accept'] = 'text/event-stream';

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`callAdvisorAssisted: proxy returned HTTP ${res.status}`);
  }

  if (input.stream) {
    if (!res.body) {
      throw new Error('callAdvisorAssisted: stream requested but proxy response has no body');
    }
    const raw = await accumulateAdvisorStream(res.body);
    return parseAdvisorResponse(raw);
  }

  const raw = await res.json();
  return parseAdvisorResponse(raw);
}
