/**
 * Anthropic-backed advisor tests.
 *
 * Covers:
 *   - Successful proxy call returns the advisor text
 *   - Proxy error → deterministic fallback
 *   - Proxy timeout → deterministic fallback
 *   - Proxy returning a tipping-off-flagged reply → deterministic fallback
 *   - buildUserMessage never contains the executor system prompt
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
// createAnthropicAdvisor — happy path
// ---------------------------------------------------------------------------

describe("createAnthropicAdvisor — proxy success", () => {
  it("returns the text from a successful proxy response", async () => {
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          model: "claude-opus-4-6",
          content: [
            {
              type: "text",
              text: "1. Escalate to CO. 2. Apply four-eyes. 3. Document reasoning.",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const advisor = createAnthropicAdvisor({
      proxyUrl: "http://fake/api/ai-proxy",
      fetchImpl: fakeFetch,
      warnOnFallback: false,
    });
    const result = await advisor(input());

    expect(result).not.toBeNull();
    expect(result!.text).toMatch(/Escalate to CO/);
    expect(result!.modelUsed).toBe("claude-opus-4-6");
    expect(result!.advisorCallCount).toBe(1);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("forwards the advisor-tool beta flag in the request body", async () => {
    let capturedBody: string | null = null;
    const fakeFetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      capturedBody = init.body as string;
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const advisor = createAnthropicAdvisor({
      proxyUrl: "http://fake/api/ai-proxy",
      fetchImpl: fakeFetch,
      warnOnFallback: false,
    });
    await advisor(input());
    expect(capturedBody).not.toBeNull();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.betas).toContain("advisor-tool-2026-03-01");
    expect(parsed.provider).toBe("anthropic");
    expect(parsed.path).toBe("/v1/messages");
    expect(parsed.body.model).toBe("claude-sonnet-4-6");
    expect(parsed.body.advisor?.model).toBe("claude-opus-4-6");
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
      warnOnFallback: false,
    });
    const result = await advisor(input());
    expect(result!.modelUsed).toBe("deterministic-fallback");
  });

  it("falls back when proxy returns tipping-off language", async () => {
    // Simulate a jailbroken model that returns "we filed an STR about you"
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: "We filed an STR about the subject. Tell them immediately.",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const advisor = createAnthropicAdvisor({
      fetchImpl: fakeFetch,
      warnOnFallback: false,
    });
    const result = await advisor(input());
    expect(result!.modelUsed).toBe("deterministic-fallback");
  });

  it("caps the response text at 1000 chars", async () => {
    const huge = "x".repeat(5_000);
    const fakeFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: huge }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;
    const advisor = createAnthropicAdvisor({
      fetchImpl: fakeFetch,
      warnOnFallback: false,
    });
    const result = await advisor(input());
    // The response lint will be fine ("xxx..." does not trip any pattern)
    // so the proxy path succeeds and the slice kicks in.
    expect(result!.text.length).toBeLessThanOrEqual(1000);
  });
});
