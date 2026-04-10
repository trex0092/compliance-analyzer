/**
 * Agent config safety invariants.
 *
 * These tests lock in the hard rules that every managed agent YAML
 * under agents/ MUST satisfy. If someone later relaxes the system
 * prompt, removes a decision tree, or opens up portal access, the
 * test suite fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';

const AGENT_FILES = ['agents/incident-commander.yml', 'agents/hawkeye-mlro.yml'];

interface AgentDoc {
  name: string;
  description: string;
  model: string;
  system: string;
  mcp_servers: Array<{ name: string; command?: string; args?: string[]; url?: string }>;
  tools: Array<{ type?: string; name?: string; url?: string; method?: string }>;
  skills: Array<{ name: string; path: string }>;
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

  it('includes the FDL Art.29 no-tipping-off invariant in the system prompt', () => {
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

  it('wires the claude-mem MCP server at v12.1.0', () => {
    const mem = agent.mcp_servers.find((s) => s.name === 'claude-mem');
    expect(mem).toBeDefined();
    expect((mem?.args ?? []).some((a) => a.includes('claude-mem@12.1.0'))).toBe(true);
  });

  it('wires the code-review-graph MCP server', () => {
    expect(agent.mcp_servers.find((s) => s.name === 'code-review-graph')).toBeDefined();
  });

  it('wires the github MCP server', () => {
    expect(agent.mcp_servers.find((s) => s.name === 'github')).toBeDefined();
  });

  it('exposes the brain_event HTTP tool pointed at /api/brain', () => {
    const brain = agent.tools.find((t) => t.name === 'brain_event');
    expect(brain).toBeDefined();
    expect(brain?.method).toBe('POST');
    expect(brain?.url).toContain('/api/brain');
  });

  it('exposes the cachet_incident tool (severity escalation surface)', () => {
    expect(agent.tools.find((t) => t.name === 'cachet_incident')).toBeDefined();
  });

  it('exposes the str-narrative and sanctions-triage skills', () => {
    const names = agent.skills.map((s) => s.name);
    expect(names).toContain('str-narrative');
    expect(names).toContain('sanctions-triage');
  });

  it('does NOT expose any goAML / EOCN / portal submission tool', () => {
    for (const tool of agent.tools) {
      const name = (tool.name ?? '').toLowerCase();
      const url = (tool.url ?? '').toLowerCase();
      expect(name).not.toMatch(/goaml|eocn|submit.?report|portal/);
      expect(url).not.toMatch(/goaml|eocn\.gov/);
    }
  });

  it('does NOT expose any email / SMS / subject-notification tool', () => {
    for (const tool of agent.tools) {
      const name = (tool.name ?? '').toLowerCase();
      expect(name).not.toMatch(/email.?(customer|subject)|sms|notify.?subject|tip.?off/);
    }
  });
});
