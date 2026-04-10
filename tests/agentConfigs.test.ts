/**
 * Agent config safety invariants.
 *
 * These tests lock in the hard rules that every managed agent YAML
 * under agents/ MUST satisfy. They also enforce the Managed Agents
 * API schema (POST /v1/agents, beta managed-agents-2026-04-01):
 *  - model is a real Claude ID
 *  - mcp_servers only use {type: "url", name, url} (no stdio)
 *  - tools are agent_toolset_20260401 | custom | mcp_toolset
 *  - no "type: http" (doesn't exist)
 *  - no tool name that implies subject notification
 *  - no portal submission tool
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const AGENT_FILES = ['agents/incident-commander.yml', 'agents/hawkeye-mlro.yml'];

type McpServer = { type: string; name: string; url?: string };
type ToolBase = { type: string; name?: string };
type CustomTool = ToolBase & {
  type: 'custom';
  name: string;
  description: string;
  input_schema: { type: 'object'; required?: string[]; properties: Record<string, unknown> };
};
type AgentToolset = ToolBase & { type: 'agent_toolset_20260401' };
type Tool = CustomTool | AgentToolset | ToolBase;

interface AgentDoc {
  name: string;
  description: string;
  model: string;
  system: string;
  mcp_servers?: McpServer[];
  tools: Tool[];
  skills?: Array<{ type: 'anthropic' | 'custom'; skill_id: string; version?: string }>;
}

function loadAgent(path: string): AgentDoc {
  const content = readFileSync(resolve(__dirname, '..', path), 'utf8');
  return YAML.parse(content) as AgentDoc;
}

describe.each(AGENT_FILES)('agent config: %s', (file) => {
  const agent = loadAgent(file);

  it('has a name, description, model, and system prompt', () => {
    expect(agent.name).toBeTruthy();
    expect(agent.description).toBeTruthy();
    expect(agent.model).toMatch(/^claude-/);
    expect(agent.system.length).toBeGreaterThan(200);
  });

  it('pins Claude Opus 4.6 (the latest Opus)', () => {
    expect(agent.model).toBe('claude-opus-4-6');
  });

  it('name length is within API limits (1-256 chars)', () => {
    expect(agent.name.length).toBeGreaterThanOrEqual(1);
    expect(agent.name.length).toBeLessThanOrEqual(256);
  });

  it('description is within API limit (<=2048 chars)', () => {
    expect(agent.description.length).toBeLessThanOrEqual(2048);
  });

  it('system prompt is within API limit (<=100000 chars)', () => {
    expect(agent.system.length).toBeLessThanOrEqual(100_000);
  });

  it('includes the FDL Art.29 no-tipping-off invariant', () => {
    const s = agent.system.toLowerCase();
    expect(s).toMatch(/tipping.?off|art\.?\s*29/);
    expect(s).toContain('never');
  });

  it('includes the four-eyes requirement', () => {
    expect(agent.system.toLowerCase()).toMatch(/four.?eyes/);
  });

  it('includes dd/mm/yyyy + AED conventions', () => {
    expect(agent.system).toContain('dd/mm/yyyy');
    expect(agent.system).toContain('AED');
  });

  it('forbids raw PII in agent artefacts', () => {
    expect(agent.system.toLowerCase()).toContain('refid');
    expect(agent.system.toLowerCase()).toMatch(/pii|personally/);
  });

  it('mcp_servers (if any) are all URL-based', () => {
    for (const srv of agent.mcp_servers ?? []) {
      expect(srv.type, `${srv.name} must be URL-based`).toBe('url');
      expect(srv.url).toMatch(/^https:\/\//);
      // No stdio fields leaked in.
      expect(srv as unknown as Record<string, unknown>).not.toHaveProperty('command');
      expect(srv as unknown as Record<string, unknown>).not.toHaveProperty('args');
    }
  });

  it('mcp_servers respects the API cap of 20 unique names', () => {
    const servers = agent.mcp_servers ?? [];
    expect(servers.length).toBeLessThanOrEqual(20);
    const names = new Set(servers.map((s) => s.name));
    expect(names.size).toBe(servers.length);
  });

  it('every mcp_server is exposed via a matching mcp_toolset tool', () => {
    // The API rejects configs that declare an mcp_server without a
    // matching mcp_toolset in tools[]. Mirror that check here.
    const toolsetNames = new Set(
      agent.tools
        .filter((t): t is ToolBase & { type: 'mcp_toolset'; mcp_server_name: string } =>
          t.type === 'mcp_toolset',
        )
        .map((t) => t.mcp_server_name),
    );
    for (const srv of agent.mcp_servers ?? []) {
      expect(
        toolsetNames.has(srv.name),
        `mcp_server "${srv.name}" must be exposed via a mcp_toolset tool`,
      ).toBe(true);
    }
  });

  it('every mcp_toolset references a declared mcp_server', () => {
    const serverNames = new Set((agent.mcp_servers ?? []).map((s) => s.name));
    for (const tool of agent.tools) {
      if (tool.type === 'mcp_toolset') {
        const name = (tool as unknown as { mcp_server_name?: string }).mcp_server_name;
        expect(name, 'mcp_toolset missing mcp_server_name').toBeTruthy();
        if (name) {
          expect(
            serverNames.has(name),
            `mcp_toolset references unknown mcp_server "${name}"`,
          ).toBe(true);
        }
      }
    }
  });

  it('declares the agent_toolset_20260401 base toolset', () => {
    const base = agent.tools.find((t) => t.type === 'agent_toolset_20260401');
    expect(base).toBeDefined();
  });

  it('uses only valid Managed Agents tool types', () => {
    const VALID = new Set(['agent_toolset_20260401', 'custom', 'mcp_toolset']);
    for (const tool of agent.tools) {
      expect(VALID.has(tool.type), `unknown tool type: ${tool.type}`).toBe(true);
    }
  });

  it('never uses the invalid "http" tool type', () => {
    for (const tool of agent.tools) {
      expect(tool.type).not.toBe('http');
    }
  });

  it('tools count is within API cap (<=50)', () => {
    expect(agent.tools.length).toBeLessThanOrEqual(50);
  });

  it('exposes brain_event as a custom tool with strict input schema', () => {
    const brain = agent.tools.find((t): t is CustomTool =>
      t.type === 'custom' && t.name === 'brain_event',
    );
    expect(brain).toBeDefined();
    expect(brain?.description).toBeTruthy();
    const schema = brain?.input_schema;
    expect(schema?.type).toBe('object');
    expect(schema?.required).toContain('kind');
    expect(schema?.required).toContain('severity');
    expect(schema?.required).toContain('summary');
    const kind = (schema?.properties.kind as { enum?: string[] }) ?? {};
    expect(kind.enum).toContain('sanctions_match');
    expect(kind.enum).toContain('str_saved');
    expect(kind.enum).toContain('evidence_break');
  });

  it('exposes cachet_incident as a custom tool', () => {
    const cachet = agent.tools.find((t): t is CustomTool =>
      t.type === 'custom' && t.name === 'cachet_incident',
    );
    expect(cachet).toBeDefined();
    expect(cachet?.input_schema.required).toContain('name');
    expect(cachet?.input_schema.required).toContain('status');
  });

  it('every custom tool has a description and valid input_schema', () => {
    const customs = agent.tools.filter((t): t is CustomTool => t.type === 'custom');
    for (const tool of customs) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema.type).toBe('object');
      expect(tool.input_schema.properties).toBeDefined();
    }
  });

  it('does NOT expose any goAML / EOCN / portal submission tool', () => {
    for (const tool of agent.tools) {
      const name = (tool.name ?? '').toLowerCase();
      expect(name).not.toMatch(/goaml|eocn|submit.?report|portal/);
    }
  });

  it('does NOT expose any email / SMS / subject-notification tool', () => {
    for (const tool of agent.tools) {
      const name = (tool.name ?? '').toLowerCase();
      expect(name).not.toMatch(/email.?(customer|subject)|sms|notify.?subject|tip.?off/);
    }
  });

  it('skills count is within API cap (<=64)', () => {
    expect((agent.skills ?? []).length).toBeLessThanOrEqual(64);
  });

  it('skill references use valid type and id', () => {
    for (const skill of agent.skills ?? []) {
      expect(['anthropic', 'custom']).toContain(skill.type);
      expect(skill.skill_id).toBeTruthy();
    }
  });
});
