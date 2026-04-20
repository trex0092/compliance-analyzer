/**
 * Anthropic-backed advisor tests.
 *
 * Covers:
 *   - Request shape matches `/api/ai-proxy` (payload, stream, betas)
 *   - Successful SSE proxy response returns the advisor text
 *   - Proxy non-2xx → deterministic fallback
 *   - Network error → deterministic fallback
 *   - Tipping-off-flagged advisor reply → deterministic fallback
 *   - 1000-char response cap
 *   - buildUserMessage carries every input field
 *   - extractText concatenates multi-part text arrays
 */
import { describe, it, expect, vi } from "vitest";
import {
  createAnthropicAdvisor,
  __test__,
} from "../src/services/anthropicAdvisor";
import type { AdvisorEscalationInput } from "../src/services/weaponizedBrain";

const { buildUserMessage, extractText } = __test__;

function input(
  overrides: Partial<AdvisorEscalationInput> = {}
): AdvisorEscalationInput {
  return {
    reason: "confidence below 0.7",
    entityId: "ent-1",
    entityName: "Opaque Label 42",
    verdict: "escalate",
    confidence: 0.42,
    clampReasons: ["PEP detected"],
    narrative: "Multi-subsystem narrative text without any subject name.",
    ...overrides,
  };
}

/**
 * Build a mock SSE Response whose body streams a minimal Anthropic
 * transcript: message_start, one text block, message_delta, message_stop.
 * The advisor SSE parser consumes these exact event shapes.
 */
function sseResponse(
  text: string,
  init: {
    status?: number;
    advisorCalls?: number;
    inputTokens?: number;
    outputTokens?: number;
  } = {}
): Response {
  const status = init.status ?? 200;
  const inputTokens = init.inputTokens ?? 10;
  const outputTokens = init.outputTokens ?? 20;
  const advisorCalls = init.advisorCalls ?? 0;

  const frames: string[] = [];
  // Proxy advisory frame — emitted first by /api/ai-proxy.
  frames.push(
    `event: proxy_ready\ndata: ${JSON.stringify({
      serverTime: new Date().toISOString(),
    })}\n\n`
  );
  // Anthropic stream events.
  frames.push(
    `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { usage: { input_tokens: inputTokens, output_tokens: 0 } },
    })}\n\n`
  );
  // Emit `advisorCalls` server_tool_use blocks named "advisor" so the
  // parser counts them correctly.
  let blockIdx = 0;
  for (let i = 0; i < advisorCalls; i++) {
    frames.push(
      `event: content_block_start\ndata: ${JSON.stringify({
        type: "content_block_start",
        index: blockIdx,
        content_block: { type: "server_tool_use", name: "advisor" },
      })}\n\n`
    );
    frames.push(
      `event: content_block_stop\ndata: ${JSON.stringify({
        type: "content_block_stop",
        index: blockIdx,
      })}\n\n`
    );
    blockIdx++;
  }
  // One text block with the advisor's visible reply.
  frames.push(
    `event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start",
      index: blockIdx,
      content_block: { type: "text", text: "" },
    })}\n\n`
  );
  frames.push(
    `event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta",
      index: blockIdx,
      delta: { type: "text_delta", text },
    })}\n\n`
  );
  frames.push(
    `event: content_block_stop\ndata: ${JSON.stringify({
      type: "content_block_stop",
      index: blockIdx,
    })}\n\n`
  );
  frames.push(
    `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    })}\n\n`
  );
  frames.push(
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  );

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });

  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("buildUserMessage", () => {
  it("carries every input field", () => {
    const msg = buildUserMessage(input());
    expect(msg).toMatch(/confidence below 0.7/);
    expect(msg).toMatch(/escalate/);
    expect(msg).toMatch(/0\.420/);
    expect(msg).toMatch(/ent-1/);
    expect(msg).toMatch(/Opaque Label 42/);
    expect(msg).toMatch(/PEP detected/);
    expect(msg).toMatch(/under 100 words/);
  });

  it("formats zero clamps as 'none'", () => {
    const msg = buildUserMessage(input({ clampReasons: [] }));
    expect(msg).toMatch(/Safety clamps fired: none/);
  });
});

describe("extractText", () => {
  it("concatenates multi-part text arrays", () => {
    expect(
      extractText({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] })
    ).toBe("one\ntwo");
  });

  it("skips non-text blocks", () => {
    expect(
      extractText({
        content: [
          { type: "text", text: "keep" },
          { type: "tool_use", text: "drop" } as unknown as { type?: string; text?: string },
        ],
      })
    ).toBe("keep");
  });

  it("returns empty string for missing content", () => {
    expect(extractText({})).toBe("");
  });
});

// ---------------------------------------------------------------------------
// createAnthropicAdvisor — request shape + happy path
// ---------------------------------------------------------------------------

describe("createAnthropicAdvisor — proxy success", () => {
  it("returns the text from a successful SSE proxy response", async () => {
    const fakeFetch = vi.fn(async () =>
      sseResponse(
        "1. Escalate to CO. 2. Apply four-eyes. 3. Document reasoning.",
        { advisorCalls: 1 }
      )
    ) as unknown as typeof fetch;

    const advisor = createAnthropicAdvisor({
      proxyUrl: "http://fake/api/ai-proxy",
      fetchImpl: fakeFetch,
      bearerToken: "test-token",
      warnOnFallback: false,
    });
    const result = await advisor(input());

    expect(result).not.toBeNull();
    expect(result!.text).toMatch(/Escalate to CO/);
    expect(result!.modelUsed).toBe("claude-opus-4-6");
    expect(result!.advisorCallCount).toBe(1);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("posts the correct ai-proxy request shape (payload, stream, advisor tool)", async () => {
    let capturedBody: string | null = null;
    const fakeFetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      return sseResponse("ok");
    }) as unknown as typeof fetch;

    const advisor = createAnthropicAdvisor({
      proxyUrl: "http://fake/api/ai-proxy",
      fetchImpl: fakeFetch,
      bearerToken: "test-token",
      warnOnFallback: false,
    });
    await advisor(input());
    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);

    // Proxy envelope.
    expect(parsed.provider).toBe("anthropic");
    expect(parsed.path).toBe("/v1/messages");
    expect(parsed.betas).toContain("advisor-tool-2026-03-01");
    // Stream flag must be set at BOTH the proxy envelope level and
    // the Anthropic payload level — the proxy reads its own flag to
    // enable keepalive injection, and Anthropic reads its payload
    // flag to actually emit SSE.
    expect(parsed.stream).toBe(true);
    expect(parsed.payload.stream).toBe(true);

    // Payload — note the field name is `payload`, NOT `body`. The old
    // code sent `body` which the proxy silently dropped, producing
    // "Stream idle timeout - partial response received" on every call.
    expect(parsed.payload.model).toBe("claude-sonnet-4-6");
    expect(parsed.payload.max_tokens).toBe(512);
    expect(typeof parsed.payload.system).toBe("string");
    expect(Array.isArray(parsed.payload.tools)).toBe(true);

    const advisorTool = parsed.payload.tools.find(
      (t: { type?: string; name?: string }) =>
        t.type === "advisor_20260301" && t.name === "advisor"
    );
    expect(advisorTool).toBeDefined();
    expect(advisorTool.model).toBe("claude-opus-4-6");
    expect(advisorTool.max_uses).toBe(1);
  });

  it("sends an Authorization: Bearer header derived from bearerToken", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const fakeFetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return sseResponse("ok");
    }) as unknown as typeof fetch;

    const advisor = createAnthropicAdvisor({
      proxyUrl: "http://fake/api/ai-proxy",
      fetchImpl: fakeFetch,
      bearerToken: "svc-token-xyz",
      warnOnFallback: false,
    });
    await advisor(input());
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!["Authorization"]).toBe("Bearer svc-token-xyz");
    // Signals SSE intent so intermediaries flip to the streaming path.
    expect(capturedHeaders!["Accept"]).toBe("text/event-stream");
  });
});

// ---------------------------------------------------------------------------
// Fallback paths
// ---------------------------------------------------------------------------

describe("createAnthropicAdvisor — deterministic fallback", () => {
  it("falls back on non-ok proxy response", async () => {
    const fakeFetch = vi.fn(
      async () => new Response("upstream error", { status: 502 })
    ) as unknown as typeof fetch;
    const advisor = createAnthropicAdvisor({
      fetchImpl: fakeFetch,
      bearerToken: "test-token",
      warnOnFallback: false,
    });
    const result = await advisor(input({ verdict: "freeze", confidence: 0.9 }));
    expect(result).not.toBeNull();
    expect(result!.modelUsed).toBe("deterministic-fallback");
    expect(result!.text).toMatch(/24h EOCN/);
  });

  it("falls back on fetch throwing (network error)", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch;
    const advisor = createAnthropicAdvisor({
      fetchImpl: fakeFetch,
      bearerToken: "test-token",
      warnOnFallback: false,
    });
    const result = await advisor(input());
    expect(result!.modelUsed).toBe("deterministic-fallback");
  });

  it("falls back when proxy returns tipping-off language", async () => {
    // Simulate a jailbroken model that returns "we filed an STR about you"
    const fakeFetch = vi.fn(async () =>
      sseResponse(
        "We filed an STR about the subject. Tell them immediately."
      )
    ) as unknown as typeof fetch;

    const advisor = createAnthropicAdvisor({
      fetchImpl: fakeFetch,
      bearerToken: "test-token",
      warnOnFallback: false,
    });
    const result = await advisor(input());
    expect(result!.modelUsed).toBe("deterministic-fallback");
  });

  it("caps the response text at 1000 chars", async () => {
    const huge = "x".repeat(5_000);
    const fakeFetch = vi.fn(async () =>
      sseResponse(huge)
    ) as unknown as typeof fetch;
    const advisor = createAnthropicAdvisor({
      fetchImpl: fakeFetch,
      bearerToken: "test-token",
      warnOnFallback: false,
    });
    const result = await advisor(input());
    // The response lint will be fine ("xxx..." does not trip any pattern)
    // so the proxy path succeeds and the slice kicks in.
    expect(result!.text.length).toBeLessThanOrEqual(1000);
  });
});
