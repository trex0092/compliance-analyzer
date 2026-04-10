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
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
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
    await callAdvisorAssisted(
      { userMessage: 'test' },
      { fetch: fake.fn, authToken: 'tok-123' }
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe('/api/ai-proxy');
    expect(fake.calls[0].init.method).toBe('POST');
    expect(fake.calls[0].init.headers.Authorization).toBe('Bearer tok-123');
    expect(fake.calls[0].init.headers['Content-Type']).toBe('application/json');
  });

  it('sends a body with the advisor tool and beta header in payload', async () => {
    const fake = fakeFetch({ content: [{ type: 'text', text: 'ok' }] });
    await callAdvisorAssisted(
      { userMessage: 'test' },
      { fetch: fake.fn, authToken: 'tok-123' }
    );
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
