/**
 * Hawkeye Skill MCP server tests.
 *
 * Exercises the JSON-RPC handlers directly (no real stdio) and
 * verifies the stdio driver via an async iterable + capture array.
 */
import { describe, it, expect } from "vitest";
import {
  handleMcpRequest,
  runStdioLoop,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  JSON_RPC_ERROR,
  __test__,
  type JsonRpcRequest,
} from "../src/mcp/skillMcpServer";
import { SKILL_CATALOGUE } from "../src/services/asanaCommentSkillRouter";
import type { StrFeatures } from "../src/services/predictiveStr";

const { toMcpTool, invokeSkillOverMcp } = __test__;

function f(overrides: Partial<StrFeatures> = {}): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 50_000,
    nearThresholdCount30d: 0,
    crossBorderRatio30d: 0,
    isPep: false,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 365,
    sanctionsMatchScore: 0,
    cashRatio30d: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// toMcpTool
// ---------------------------------------------------------------------------

describe("toMcpTool", () => {
  it("prefixes every tool name with 'skill.'", () => {
    const tool = toMcpTool(SKILL_CATALOGUE[0]);
    expect(tool.name).toMatch(/^skill\./);
  });

  it("description carries the regulatory citation", () => {
    const skill = SKILL_CATALOGUE.find((s) => s.name === "risk-score")!;
    const tool = toMcpTool(skill);
    expect(tool.description).toMatch(/Regulatory:/);
    expect(tool.description).toMatch(/Cabinet Res 134\/2025/);
  });

  it("inputSchema requires entityRef", () => {
    const tool = toMcpTool(SKILL_CATALOGUE[0]);
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      required: ["entityRef"],
    });
  });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe("handleMcpRequest — initialize", () => {
  it("returns server info + protocol version", async () => {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    };
    const response = await handleMcpRequest(request);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();
    const result = response.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: { tools: Record<string, unknown> };
      instructions: string;
    };
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe(MCP_SERVER_NAME);
    expect(result.serverInfo.version).toBe(MCP_SERVER_VERSION);
    expect(result.capabilities.tools).toBeDefined();
    expect(result.instructions).toMatch(/FDL No\.?10\/2025 Art\.?29/);
  });
});

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

describe("handleMcpRequest — tools/list", () => {
  it("returns one tool per skill catalogue entry", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const result = response.result as { tools: Array<{ name: string }> };
    expect(result.tools.length).toBe(SKILL_CATALOGUE.length);
    // Check every expected skill is present.
    const names = result.tools.map((t) => t.name);
    for (const skill of SKILL_CATALOGUE) {
      expect(names).toContain(`skill.${skill.name}`);
    }
  });

  it("every tool has a description + inputSchema", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const result = response.result as {
      tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }>;
    };
    for (const tool of result.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

describe("handleMcpRequest — tools/call", () => {
  it("invokes a real skill runner and returns the reply", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "skill.brain-status",
        arguments: { entityRef: "test", tenantId: "t1" },
      },
    });
    expect(response.error).toBeUndefined();
    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      _meta: Record<string, unknown>;
    };
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toMatch(/Brain status/);
    expect(result._meta.real).toBe(true);
  });

  it("forwards features to analytics-flavoured skills", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "skill.risk-score",
        arguments: {
          entityRef: "ent1",
          tenantId: "t1",
          features: f({ sanctionsMatchScore: 0.9 }),
        },
      },
    });
    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      _meta: Record<string, unknown>;
    };
    expect(result.content[0].text).toMatch(/probability/);
    expect(typeof result._meta.probability).toBe("number");
  });

  it("/caveman forwards the intensity arg", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "skill.caveman",
        arguments: {
          entityRef: "ent1",
          features: f({ sanctionsMatchScore: 0.9 }),
          args: ["ultra"],
        },
      },
    });
    const result = response.result as {
      content: Array<{ type: string; text: string }>;
      _meta: Record<string, unknown>;
    };
    expect(result._meta.intensity).toBe("ultra");
    expect(result.content[0].text.length).toBeLessThanOrEqual(120);
  });

  it("returns an error content block for unknown skill names", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "skill.does-not-exist",
        arguments: { entityRef: "e" },
      },
    });
    const result = response.result as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Unknown skill/);
  });

  it("rejects tools/call without params.name", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { arguments: {} },
    });
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(JSON_RPC_ERROR.INVALID_PARAMS);
  });
});

// ---------------------------------------------------------------------------
// Error paths
// ---------------------------------------------------------------------------

describe("handleMcpRequest — error paths", () => {
  it("returns METHOD_NOT_FOUND for unknown methods", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "not/a/method",
    });
    expect(response.error!.code).toBe(JSON_RPC_ERROR.METHOD_NOT_FOUND);
  });

  it("returns INVALID_REQUEST for wrong jsonrpc version", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "1.0" as unknown as "2.0",
      id: 9,
      method: "initialize",
    });
    expect(response.error!.code).toBe(JSON_RPC_ERROR.INVALID_REQUEST);
  });

  it("ping returns empty result", async () => {
    const response = await handleMcpRequest({
      jsonrpc: "2.0",
      id: 10,
      method: "ping",
    });
    expect(response.error).toBeUndefined();
    expect(response.result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// invokeSkillOverMcp
// ---------------------------------------------------------------------------

describe("invokeSkillOverMcp", () => {
  it("strips the skill. prefix and routes to the right runner", async () => {
    const { defaultSkillRegistry } = await import(
      "../src/services/asana/skillRunnerRegistry"
    );
    const result = await invokeSkillOverMcp(
      defaultSkillRegistry,
      "skill.brain-status",
      { entityRef: "ent", tenantId: "t1" }
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/Brain status/);
  });

  it("defaults tenantId to 'mcp' when omitted", async () => {
    const { defaultSkillRegistry } = await import(
      "../src/services/asana/skillRunnerRegistry"
    );
    const result = await invokeSkillOverMcp(
      defaultSkillRegistry,
      "skill.brain-status",
      { entityRef: "ent" }
    );
    // No throw means the runner accepted the default context.
    expect(result.content[0]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runStdioLoop — integration with a fake transport
// ---------------------------------------------------------------------------

describe("runStdioLoop", () => {
  it("processes one request per line and writes one response per line", async () => {
    const lines = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
    ];
    const reader = (async function* () {
      for (const line of lines) yield line;
    })();
    const outputs: string[] = [];
    await runStdioLoop(reader, (line) => {
      outputs.push(line);
    });
    expect(outputs).toHaveLength(3);
    const parsed = outputs.map((o) => JSON.parse(o));
    expect(parsed[0].id).toBe(1);
    expect(parsed[0].result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(parsed[1].id).toBe(2);
    expect(parsed[1].result.tools.length).toBe(SKILL_CATALOGUE.length);
    expect(parsed[2].id).toBe(3);
  });

  it("skips blank lines without producing a response", async () => {
    const reader = (async function* () {
      yield "   ";
      yield "";
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    })();
    const outputs: string[] = [];
    await runStdioLoop(reader, (line) => {
      outputs.push(line);
    });
    expect(outputs).toHaveLength(1);
  });

  it("responds with PARSE_ERROR on malformed JSON without stalling", async () => {
    const reader = (async function* () {
      yield "not valid json";
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    })();
    const outputs: string[] = [];
    await runStdioLoop(reader, (line) => {
      outputs.push(line);
    });
    expect(outputs).toHaveLength(2);
    const first = JSON.parse(outputs[0]);
    expect(first.error.code).toBe(JSON_RPC_ERROR.PARSE_ERROR);
    const second = JSON.parse(outputs[1]);
    expect(second.id).toBe(1);
  });

  it("responds with INVALID_REQUEST for non-object payloads", async () => {
    const reader = (async function* () {
      yield '"just a string"';
    })();
    const outputs: string[] = [];
    await runStdioLoop(reader, (line) => {
      outputs.push(line);
    });
    expect(outputs).toHaveLength(1);
    const parsed = JSON.parse(outputs[0]);
    expect(parsed.error.code).toBe(JSON_RPC_ERROR.INVALID_REQUEST);
  });
});
