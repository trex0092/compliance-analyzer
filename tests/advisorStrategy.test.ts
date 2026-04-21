/**
 * Tests for the Advisor Strategy helper module.
 *
 * These tests exercise:
 *   - Request-building purity (buildAdvisorRequest)
 *   - Executor/advisor pair validation (validateExecutorAdvisorPair)
 *   - Response parsing (parseAdvisorResponse)
 *   - End-to-end call with an injected fake fetch (callAdvisorAssisted)
 *
 * No real network calls. The transport is injected via AdvisorCallDeps
 * so the tests stay hermetic.
 */
import { describe, it, expect } from 'vitest';
import {
  ADVISOR_BETA_HEADER,
  ADVISOR_TOOL_TYPE,
  EXECUTOR_SONNET,
  EXECUTOR_HAIKU,
  EXECUTOR_OPUS,
  ADVISOR_OPUS,
  COMPLIANCE_ADVISOR_SYSTEM_PROMPT,
  VALID_PAIRS,
  validateExecutorAdvisorPair,
  buildAdvisorRequest,
  parseAdvisorResponse,
  callAdvisorAssisted,
  AdvisorStreamError,
  type FetchLike,
} from '@/services/advisorStrategy';

// ---------------------------------------------------------------------------
// Spec constants — lock them in so the API shape cannot silently drift.
// ---------------------------------------------------------------------------

describe('advisorStrategy — spec constants', () => {
  it('exposes the exact beta header value from Anthropic docs', () => {
    expect(ADVISOR_BETA_HEADER).toBe('advisor-tool-2026-03-01');
  });

  it('exposes the exact tool type identifier', () => {
    expect(ADVISOR_TOOL_TYPE).toBe('advisor_20260301');
  });

  it('declares the canonical executor and advisor model IDs', () => {
    expect(EXECUTOR_SONNET).toBe('claude-sonnet-4-6');
    expect(EXECUTOR_HAIKU).toBe('claude-haiku-4-5-20251001');
    expect(EXECUTOR_OPUS).toBe('claude-opus-4-6');
    expect(ADVISOR_OPUS).toBe('claude-opus-4-6');
  });

  it('VALID_PAIRS contains the three documented combinations', () => {
    expect(VALID_PAIRS).toHaveLength(3);
    const asKeys = VALID_PAIRS.map((p) => `${p.executor}->${p.advisor}`);
    expect(asKeys).toContain('claude-haiku-4-5-20251001->claude-opus-4-6');
    expect(asKeys).toContain('claude-sonnet-4-6->claude-opus-4-6');
    expect(asKeys).toContain('claude-opus-4-6->claude-opus-4-6');
  });

  it('compliance system prompt names the mandatory escalation triggers', () => {
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('sanctions match');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('threshold edge case');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('STR');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('freeze');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('CDD level');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('never tip off');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('under 100 words');
    // Extended triggers (#7 layering, #8 shell-company, #9 cross-
    // border structuring, #10 adverse-media peer anomaly, #11
    // sanctions-by-association, #12 structured false-positive).
    // FDL Art.20-21, Cabinet Res 74/2020, Cabinet Res 134/2025
    // Art.14-16, Cabinet Decision 109/2023, FATF Rec 3/7/10/24.
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('layering pattern');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('shell-company indicator');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('cross-border structuring');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('peer-group anomaly');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('sanctions-by-association');
    expect(COMPLIANCE_ADVISOR_SYSTEM_PROMPT).toContain('false positive');
  });
});

// ---------------------------------------------------------------------------
// Pair validation
// ---------------------------------------------------------------------------

describe('advisorStrategy — validateExecutorAdvisorPair', () => {
  it('accepts Sonnet → Opus', () => {
    expect(() => validateExecutorAdvisorPair(EXECUTOR_SONNET, ADVISOR_OPUS)).not.toThrow();
  });

  it('accepts Haiku → Opus', () => {
    expect(() => validateExecutorAdvisorPair(EXECUTOR_HAIKU, ADVISOR_OPUS)).not.toThrow();
  });

  it('accepts Opus → Opus (self-advisor case)', () => {
    expect(() => validateExecutorAdvisorPair(EXECUTOR_OPUS, ADVISOR_OPUS)).not.toThrow();
  });

  it('rejects Sonnet → Sonnet (advisor must be at least as capable)', () => {
    expect(() => validateExecutorAdvisorPair(EXECUTOR_SONNET, EXECUTOR_SONNET)).toThrow(
      /Invalid executor\/advisor pair/
    );
  });

  it('rejects unknown model IDs', () => {
    expect(() => validateExecutorAdvisorPair('claude-3-opus-20240229', ADVISOR_OPUS)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Request builder
// ---------------------------------------------------------------------------

describe('advisorStrategy — buildAdvisorRequest', () => {
  it('defaults to Sonnet executor + Opus advisor with the beta header', () => {
    const body = buildAdvisorRequest({ userMessage: 'Assess entity X.' });
    expect(body.provider).toBe('anthropic');
    expect(body.path).toBe('/v1/messages');
    expect(body.betas).toEqual([ADVISOR_BETA_HEADER]);
    expect(body.payload.model).toBe(EXECUTOR_SONNET);
    expect(body.payload.max_tokens).toBe(4096);
  });

  it('includes the compliance system prompt verbatim', () => {
    const body = buildAdvisorRequest({ userMessage: 'Assess entity X.' });
    expect(body.payload.system).toBe(COMPLIANCE_ADVISOR_SYSTEM_PROMPT);
  });

  it('appends additionalSystemPrompt after the compliance block', () => {
    const body = buildAdvisorRequest({
      userMessage: 'Assess entity X.',
      additionalSystemPrompt: 'Extra context about Sharia-compliant gold accounts.',
    });
    expect(body.payload.system).toContain(COMPLIANCE_ADVISOR_SYSTEM_PROMPT);
    expect(body.payload.system).toContain('Sharia-compliant gold accounts');
    // The compliance prompt must come FIRST.
    expect(body.payload.system.indexOf(COMPLIANCE_ADVISOR_SYSTEM_PROMPT)).toBe(0);
  });

  it('declares the advisor tool with the correct type and name', () => {
    const body = buildAdvisorRequest({ userMessage: 'Assess entity X.' });
    expect(body.payload.tools).toHaveLength(1);
    const advisor = body.payload.tools[0];
    expect(advisor.type).toBe(ADVISOR_TOOL_TYPE);
    expect(advisor.name).toBe('advisor');
    expect(advisor.model).toBe(ADVISOR_OPUS);
  });

  it('honors maxAdvisorUses', () => {
    const body = buildAdvisorRequest({
      userMessage: 'Assess entity X.',
      maxAdvisorUses: 3,
    });
    expect(body.payload.tools[0].max_uses).toBe(3);
  });

  it('ignores maxAdvisorUses when <= 0', () => {
    const body = buildAdvisorRequest({
      userMessage: 'Assess entity X.',
      maxAdvisorUses: 0,
    });
    expect(body.payload.tools[0].max_uses).toBeUndefined();
  });

  it('forwards advisorCaching when set', () => {
    const body = buildAdvisorRequest({
      userMessage: 'Assess entity X.',
      advisorCaching: { type: 'ephemeral', ttl: '5m' },
    });
    expect(body.payload.tools[0].caching).toEqual({ type: 'ephemeral', ttl: '5m' });
  });

  it('appends additional tools after the advisor tool', () => {
    const body = buildAdvisorRequest({
      userMessage: 'Assess entity X.',
      additionalTools: [{ name: 'lookup_customer', description: 'Look up customer by id' }],
    });
    expect(body.payload.tools).toHaveLength(2);
    expect(body.payload.tools[0].name).toBe('advisor');
    expect(body.payload.tools[1].name).toBe('lookup_customer');
  });

  it('wraps the user message as a single user turn', () => {
    const body = buildAdvisorRequest({ userMessage: 'Assess entity X.' });
    expect(body.payload.messages).toHaveLength(1);
    expect(body.payload.messages[0].role).toBe('user');
    expect(body.payload.messages[0].content).toBe('Assess entity X.');
  });

  it('throws on an invalid executor/advisor pair', () => {
    expect(() =>
      buildAdvisorRequest({
        userMessage: 'x',
        executor: EXECUTOR_SONNET,
        advisor: EXECUTOR_SONNET,
      })
    ).toThrow(/Invalid executor\/advisor pair/);
  });
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe('advisorStrategy — parseAdvisorResponse', () => {
  it('extracts text from multiple text blocks', () => {
    const raw = {
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world.' },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
    const parsed = parseAdvisorResponse(raw);
    expect(parsed.text).toBe('Hello world.');
  });

  it('counts advisor server_tool_use blocks', () => {
    const raw = {
      content: [
        { type: 'text', text: 'Thinking...' },
        { type: 'server_tool_use', name: 'advisor' },
        { type: 'text', text: 'Got advice. ' },
        { type: 'server_tool_use', name: 'advisor' },
        { type: 'text', text: 'Done.' },
      ],
    };
    const parsed = parseAdvisorResponse(raw);
    expect(parsed.advisorCallCount).toBe(2);
    expect(parsed.text).toBe('Thinking...Got advice. Done.');
  });

  it('does not count non-advisor server_tool_use blocks as advisor calls', () => {
    const raw = {
      content: [
        { type: 'server_tool_use', name: 'web_search' },
        { type: 'server_tool_use', name: 'advisor' },
      ],
    };
    const parsed = parseAdvisorResponse(raw);
    expect(parsed.advisorCallCount).toBe(1);
  });

  it('rolls up usage.iterations into executor vs advisor token totals', () => {
    const raw = {
      content: [{ type: 'text', text: 'done' }],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        iterations: [
          { type: 'message', input_tokens: 100, output_tokens: 50 },
          { type: 'advisor_message', input_tokens: 800, output_tokens: 1600 },
          { type: 'message', input_tokens: 150, output_tokens: 150 },
        ],
      },
    };
    const parsed = parseAdvisorResponse(raw);
    expect(parsed.usage.executorInputTokens).toBe(250);
    expect(parsed.usage.executorOutputTokens).toBe(200);
    expect(parsed.usage.advisorInputTokens).toBe(800);
    expect(parsed.usage.advisorOutputTokens).toBe(1600);
  });

  it('falls back to top-level usage as executor-only when iterations missing', () => {
    const raw = {
      content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 55, output_tokens: 77 },
    };
    const parsed = parseAdvisorResponse(raw);
    expect(parsed.usage.executorInputTokens).toBe(55);
    expect(parsed.usage.executorOutputTokens).toBe(77);
    expect(parsed.usage.advisorInputTokens).toBe(0);
    expect(parsed.usage.advisorOutputTokens).toBe(0);
  });

  it('handles empty / null response gracefully', () => {
    const parsed = parseAdvisorResponse(null);
    expect(parsed.text).toBe('');
    expect(parsed.advisorCallCount).toBe(0);
    expect(parsed.usage.executorInputTokens).toBe(0);
  });

  it('exposes the raw response for callers that need full fidelity', () => {
    const raw = { content: [{ type: 'text', text: 'x' }] };
    const parsed = parseAdvisorResponse(raw);
    expect(parsed.raw).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// End-to-end call with injected fake fetch
// ---------------------------------------------------------------------------

describe('advisorStrategy — callAdvisorAssisted', () => {
  /** Build a fake fetch that records the request and returns a canned response. */
  function fakeFetch(response: unknown, ok = true, status = 200) {
    const calls: Array<{
      url: string;
      init: { method: string; headers: Record<string, string>; body: string };
    }> = [];
    const fn: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok,
        status,
        json: async () => response,
      };
    };
    return { fn, calls };
  }

  it('POSTs to /api/ai-proxy by default with Authorization header', async () => {
    const fake = fakeFetch({ content: [{ type: 'text', text: 'ok' }] });
    await callAdvisorAssisted({ userMessage: 'test' }, { fetch: fake.fn, authToken: 'tok-123' });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe('/api/ai-proxy');
    expect(fake.calls[0].init.method).toBe('POST');
    expect(fake.calls[0].init.headers.Authorization).toBe('Bearer tok-123');
    expect(fake.calls[0].init.headers['Content-Type']).toBe('application/json');
  });

  it('sends a body with the advisor tool and beta header in payload', async () => {
    const fake = fakeFetch({ content: [{ type: 'text', text: 'ok' }] });
    await callAdvisorAssisted({ userMessage: 'test' }, { fetch: fake.fn, authToken: 'tok-123' });
    const body = JSON.parse(fake.calls[0].init.body);
    expect(body.betas).toEqual([ADVISOR_BETA_HEADER]);
    expect(body.payload.tools[0].type).toBe(ADVISOR_TOOL_TYPE);
    expect(body.payload.model).toBe(EXECUTOR_SONNET);
  });

  it('returns the parsed result on success', async () => {
    const fake = fakeFetch({
      content: [
        { type: 'text', text: 'The ' },
        { type: 'server_tool_use', name: 'advisor' },
        { type: 'text', text: 'plan.' },
      ],
    });
    const result = await callAdvisorAssisted(
      { userMessage: 'plan for me' },
      { fetch: fake.fn, authToken: 'tok' }
    );
    expect(result.text).toBe('The plan.');
    expect(result.advisorCallCount).toBe(1);
  });

  it('throws on non-2xx response from the proxy', async () => {
    const fake = fakeFetch({ error: 'bad request' }, false, 400);
    await expect(
      callAdvisorAssisted({ userMessage: 'x' }, { fetch: fake.fn, authToken: 'tok' })
    ).rejects.toThrow(/HTTP 400/);
  });

  it('throws when no auth token is available', async () => {
    const fake = fakeFetch({});
    await expect(
      callAdvisorAssisted({ userMessage: 'x' }, { fetch: fake.fn, authToken: undefined })
    ).rejects.toThrow(/no auth token/);
  });

  it('respects custom endpoint', async () => {
    const fake = fakeFetch({ content: [] });
    await callAdvisorAssisted(
      { userMessage: 'x' },
      { fetch: fake.fn, authToken: 'tok', endpoint: '/custom/advisor' }
    );
    expect(fake.calls[0].url).toBe('/custom/advisor');
  });
});

// ---------------------------------------------------------------------------
// Streaming path — SSE + keepalive
// ---------------------------------------------------------------------------

describe('advisorStrategy — streaming mode', () => {
  it('buildAdvisorRequest sets stream on both proxy-level and payload-level', () => {
    const body = buildAdvisorRequest({ userMessage: 'x', stream: true });
    expect(body.stream).toBe(true);
    expect(body.payload.stream).toBe(true);
  });

  it('buildAdvisorRequest omits stream flags by default', () => {
    const body = buildAdvisorRequest({ userMessage: 'x' });
    expect(body.stream).toBeUndefined();
    expect(body.payload.stream).toBeUndefined();
  });

  /**
   * Build a ReadableStream of SSE bytes for a canonical Anthropic
   * streamed /v1/messages response. Interleaves a `: keepalive` comment
   * frame to prove the accumulator skips idle-gap fillers.
   */
  function sseStream(frames: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(encoder.encode(f));
        controller.close();
      },
    });
  }

  function frameEvent(type: string, data: Record<string, unknown>): string {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function fakeStreamingFetch(frames: string[]): {
    fn: FetchLike;
    calls: Array<{
      url: string;
      init: { method: string; headers: Record<string, string>; body: string };
    }>;
  } {
    const calls: Array<{
      url: string;
      init: { method: string; headers: Record<string, string>; body: string };
    }> = [];
    const fn: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        body: sseStream(frames),
      };
    };
    return { fn, calls };
  }

  it('sends Accept: text/event-stream when streaming', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 5, output_tokens: 0 } },
      }),
      frameEvent('message_stop', { type: 'message_stop' }),
    ]);
    await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    );
    expect(fake.calls[0].init.headers['Accept']).toBe('text/event-stream');
  });

  it('accumulates text_delta events into the executor text output', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 10, output_tokens: 0 } },
      }),
      frameEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      frameEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello ' },
      }),
      ': keepalive\n\n',
      frameEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'world.' },
      }),
      frameEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frameEvent('message_delta', { type: 'message_delta', usage: { output_tokens: 42 } }),
      frameEvent('message_stop', { type: 'message_stop' }),
    ]);
    const result = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    );
    expect(result.text).toBe('Hello world.');
    expect(result.usage.executorInputTokens).toBe(10);
    expect(result.usage.executorOutputTokens).toBe(42);
  });

  it('counts server_tool_use blocks named "advisor" in a streamed response', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      frameEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'server_tool_use', name: 'advisor' },
      }),
      frameEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frameEvent('content_block_start', {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' },
      }),
      frameEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'done' },
      }),
      frameEvent('content_block_stop', { type: 'content_block_stop', index: 1 }),
      frameEvent('message_stop', { type: 'message_stop' }),
    ]);
    const result = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    );
    expect(result.advisorCallCount).toBe(1);
    expect(result.text).toBe('done');
  });

  it('handles SSE frames split across multiple chunks', async () => {
    // Split a single frame across three TCP chunks to prove the
    // buffer-accumulation logic does not drop or duplicate bytes.
    const full = frameEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'chunked' },
    });
    const third = Math.floor(full.length / 3);
    const chunkA = full.slice(0, third);
    const chunkB = full.slice(third, 2 * third);
    const chunkC = full.slice(2 * third);
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      frameEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      chunkA,
      chunkB,
      chunkC,
      frameEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frameEvent('message_stop', { type: 'message_stop' }),
    ]);
    const result = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    );
    expect(result.text).toBe('chunked');
  });

  it('throws when a stream-level error frame arrives', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      frameEvent('error', {
        type: 'error',
        error: { type: 'overloaded_error', message: 'overloaded' },
      }),
    ]);
    await expect(
      callAdvisorAssisted({ userMessage: 'x', stream: true }, { fetch: fake.fn, authToken: 'tok' })
    ).rejects.toThrow(/advisor SSE error: overloaded/);
  });

  it('throws when stream is requested but the response has no body', async () => {
    const fn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      body: null,
    });
    await expect(
      callAdvisorAssisted({ userMessage: 'x', stream: true }, { fetch: fn, authToken: 'tok' })
    ).rejects.toThrow(/no body/);
  });

  it('ignores malformed JSON frames and keeps accumulating', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      frameEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      'data: {not valid json\n\n',
      frameEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'survived' },
      }),
      frameEvent('message_stop', { type: 'message_stop' }),
    ]);
    const result = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    );
    expect(result.text).toBe('survived');
  });

  // --- Proxy-level event recognition -------------------------------------
  // Proves the client recognises the structured frames that the ai-proxy
  // emits when IT runs into a timeout / wall-clock / upstream failure,
  // instead of treating them as silent Anthropic frames. This is the
  // core defence against "API Error: Stream idle timeout - partial
  // response received" — the proxy tells us exactly what went wrong
  // and we surface it as a typed, retryable error.

  it('surfaces event: proxy_wall_clock as a retryable AdvisorStreamError', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      frameEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      frameEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'partial' },
      }),
      'event: proxy_wall_clock\ndata: {"message":"proxy stream closed","wallClockMs":24000}\n\n',
    ]);
    const err = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdvisorStreamError);
    expect((err as AdvisorStreamError).kind).toBe('proxy_wall_clock');
    expect((err as AdvisorStreamError).retryable).toBe(true);
  });

  it('surfaces event: upstream_error as an AdvisorStreamError with retryable flag', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      'event: upstream_error\ndata: {"message":"upstream aborted","retryable":true,"name":"TimeoutError"}\n\n',
    ]);
    const err = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdvisorStreamError);
    expect((err as AdvisorStreamError).kind).toBe('proxy_upstream_error');
    expect((err as AdvisorStreamError).retryable).toBe(true);
  });

  it('treats upstream_error with retryable:false as non-retryable', async () => {
    const fake = fakeStreamingFetch([
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 0, output_tokens: 0 } },
      }),
      'event: upstream_error\ndata: {"message":"fatal","retryable":false}\n\n',
    ]);
    const err = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdvisorStreamError);
    expect((err as AdvisorStreamError).retryable).toBe(false);
  });

  it('ignores the advisory event: proxy_ready frame', async () => {
    const fake = fakeStreamingFetch([
      'event: proxy_ready\ndata: {"serverTime":"2026-04-18T00:00:00Z","wallClockMs":24000,"keepaliveMs":10000}\n\n',
      frameEvent('message_start', {
        type: 'message_start',
        message: { usage: { input_tokens: 3, output_tokens: 0 } },
      }),
      frameEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      frameEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      }),
      frameEvent('message_stop', { type: 'message_stop' }),
    ]);
    const result = await callAdvisorAssisted(
      { userMessage: 'x', stream: true },
      { fetch: fake.fn, authToken: 'tok' }
    );
    expect(result.text).toBe('ok');
  });
});
