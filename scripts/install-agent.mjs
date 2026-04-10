#!/usr/bin/env node
/**
 * install-agent — create a Managed Agent from a YAML config.
 *
 * Reads an `agents/<name>.yml` file, validates it matches the Managed
 * Agents API schema (POST /v1/agents, beta managed-agents-2026-04-01),
 * and creates the agent programmatically via the Anthropic SDK.
 *
 * Stores the returned {agent_id, version} in `.env.agents` so the
 * orchestrator (`scripts/agent-orchestrator.mjs`) can reference them.
 *
 * Usage:
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   node scripts/install-agent.mjs agents/incident-commander.yml
 *   node scripts/install-agent.mjs agents/hawkeye-mlro.yml
 *
 * Idempotency: if an agent with the same name already exists in your
 * workspace, the script updates it (which creates a new immutable
 * version) instead of creating a duplicate.
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, '..', '..');
const ENV_AGENTS = resolve(PROJECT_ROOT, '.env.agents');

function die(msg, code = 1) {
  console.error(`\x1b[31merror:\x1b[0m ${msg}`);
  process.exit(code);
}

function usage() {
  console.error('Usage: node scripts/install-agent.mjs <path-to-agent.yml>');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Validation — cheap, hermetic checks before we spend an API call.
// ---------------------------------------------------------------------------
const VALID_TOOL_TYPES = new Set([
  'agent_toolset_20260401',
  'custom',
  'mcp_toolset',
]);
const VALID_KINDS = [
  'str_saved',
  'sanctions_match',
  'threshold_breach',
  'deadline_missed',
  'cdd_overdue',
  'evidence_break',
  'manual',
];

function validateAgent(doc, path) {
  const errors = [];

  if (!doc || typeof doc !== 'object') errors.push('root must be an object');
  if (!doc.name || typeof doc.name !== 'string') errors.push('name is required');
  if (doc.name && doc.name.length > 256) errors.push('name > 256 chars');
  if (!doc.model || typeof doc.model !== 'string') errors.push('model is required');
  if (doc.description && doc.description.length > 2048) errors.push('description > 2048 chars');
  if (doc.system && doc.system.length > 100_000) errors.push('system > 100000 chars');

  if (!Array.isArray(doc.tools)) {
    errors.push('tools must be an array');
  } else {
    if (doc.tools.length > 50) errors.push('tools > 50');
    for (const tool of doc.tools) {
      if (!VALID_TOOL_TYPES.has(tool.type)) {
        errors.push(`invalid tool type: ${tool.type}`);
      }
      if (tool.type === 'custom') {
        if (!tool.name) errors.push('custom tool missing name');
        if (!tool.description) errors.push(`custom tool ${tool.name} missing description`);
        if (!tool.input_schema || tool.input_schema.type !== 'object') {
          errors.push(`custom tool ${tool.name} missing/invalid input_schema`);
        }
      }
    }
  }

  if (doc.mcp_servers) {
    if (!Array.isArray(doc.mcp_servers)) {
      errors.push('mcp_servers must be an array');
    } else {
      if (doc.mcp_servers.length > 20) errors.push('mcp_servers > 20');
      const seen = new Set();
      for (const srv of doc.mcp_servers) {
        if (srv.type !== 'url') {
          errors.push(`mcp_server ${srv.name} must have type: url (Managed Agents only supports URL-based MCP)`);
        }
        if (!srv.name) errors.push('mcp_server missing name');
        if (!srv.url || !srv.url.startsWith('https://')) {
          errors.push(`mcp_server ${srv.name} missing https url`);
        }
        if (seen.has(srv.name)) errors.push(`duplicate mcp_server name: ${srv.name}`);
        seen.add(srv.name);
      }
    }
  }

  if (doc.skills) {
    if (!Array.isArray(doc.skills)) errors.push('skills must be an array');
    else if (doc.skills.length > 64) errors.push('skills > 64');
  }

  // Safety invariants — mirror tests/agentConfigs.test.ts.
  const sys = (doc.system ?? '').toLowerCase();
  if (!sys.match(/tipping.?off|art\.?\s*29/)) {
    errors.push('system prompt missing FDL Art.29 no-tipping-off language');
  }
  if (!sys.match(/four.?eyes/)) {
    errors.push('system prompt missing four-eyes requirement');
  }

  // Confirm no accidentally-added "subject notification" tool.
  for (const tool of doc.tools ?? []) {
    const name = (tool.name ?? '').toLowerCase();
    if (name.match(/notify.?subject|email.?(customer|subject)|tip.?off|sms/)) {
      errors.push(`forbidden tool (would enable tipping off): ${tool.name}`);
    }
    if (name.match(/goaml|eocn|submit.?report|portal/)) {
      errors.push(`forbidden tool (direct portal submission): ${tool.name}`);
    }
  }

  if (errors.length) {
    console.error(`\x1b[31m${path} failed validation:\x1b[0m`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Idempotent upsert: list existing agents by name, update if found.
// ---------------------------------------------------------------------------
async function findAgentByName(client, name) {
  // Paginate through agents. The SDK's async iterator handles this.
  for await (const agent of client.beta.agents.list()) {
    if (agent.name === name) return agent;
  }
  return null;
}

async function upsert(client, doc) {
  const existing = await findAgentByName(client, doc.name);

  // The API accepts the full config on both create and update.
  const body = {
    name: doc.name,
    model: doc.model,
    ...(doc.description ? { description: doc.description } : {}),
    ...(doc.system ? { system: doc.system } : {}),
    ...(doc.tools ? { tools: doc.tools } : {}),
    ...(doc.mcp_servers ? { mcp_servers: doc.mcp_servers } : {}),
    ...(doc.skills ? { skills: doc.skills } : {}),
    ...(doc.metadata ? { metadata: doc.metadata } : {}),
  };

  if (existing) {
    console.log(`  \x1b[33mupdating\x1b[0m existing agent ${existing.id} (new version will be created)`);
    return await client.beta.agents.update(existing.id, body);
  }
  console.log(`  \x1b[32mcreating\x1b[0m new agent`);
  return await client.beta.agents.create(body);
}

// ---------------------------------------------------------------------------
// .env.agents persistence — simple KEY=VALUE file the orchestrator reads.
// ---------------------------------------------------------------------------
async function persistAgentId(slug, agent) {
  const key = slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  let existing = '';
  try {
    await access(ENV_AGENTS);
    existing = await readFile(ENV_AGENTS, 'utf8');
  } catch {
    existing = '# Hawkeye Sterling — Managed Agent IDs\n# Generated by scripts/install-agent.mjs — safe to commit? NO (contains IDs)\n';
  }

  const idLine = `AGENT_${key}_ID=${agent.id}`;
  const versionLine = `AGENT_${key}_VERSION=${agent.version ?? ''}`;

  const lines = existing.split('\n').filter((l) =>
    !l.startsWith(`AGENT_${key}_ID=`) && !l.startsWith(`AGENT_${key}_VERSION=`)
  );
  lines.push(idLine, versionLine);

  await writeFile(ENV_AGENTS, lines.join('\n') + '\n', 'utf8');
  console.log(`  \x1b[32mwrote\x1b[0m .env.agents (${idLine}, ${versionLine})`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1) usage();
  const ymlPath = resolve(args[0]);

  if (!process.env.ANTHROPIC_API_KEY) {
    die('ANTHROPIC_API_KEY is not set. Export it before running this script.');
  }

  let content;
  try {
    content = await readFile(ymlPath, 'utf8');
  } catch (err) {
    die(`cannot read ${ymlPath}: ${err.message}`);
  }

  let doc;
  try {
    doc = YAML.parse(content);
  } catch (err) {
    die(`YAML parse error in ${ymlPath}: ${err.message}`);
  }

  validateAgent(doc, ymlPath);

  console.log(`\x1b[36minstalling agent:\x1b[0m ${doc.name}`);
  console.log(`  model: ${doc.model}`);
  console.log(`  tools: ${doc.tools.length}`);
  console.log(`  mcp_servers: ${(doc.mcp_servers ?? []).length}`);
  console.log(`  skills: ${(doc.skills ?? []).length}`);

  const client = new Anthropic();

  // Sanity check: the beta.agents namespace must exist in this SDK
  // version. If it doesn't, the SDK is too old for Managed Agents.
  if (!client.beta || !client.beta.agents || typeof client.beta.agents.create !== 'function') {
    die(
      'this @anthropic-ai/sdk version does not expose client.beta.agents. ' +
        'Managed Agents requires SDK >= 0.87.0. Run `npm ls @anthropic-ai/sdk` to check.',
    );
  }

  let agent;
  try {
    agent = await upsert(client, doc);
  } catch (err) {
    // Dump everything we can about the error — this runs in CI artifacts.
    console.error('\x1b[31m─── install-agent failure ───\x1b[0m');
    console.error(`agent: ${doc.name}`);
    console.error(`yaml:  ${ymlPath}`);
    if (err instanceof Anthropic.APIError) {
      console.error(`status:     ${err.status}`);
      console.error(`type:       ${err.name}`);
      console.error(`message:    ${err.message}`);
      if (err.error) console.error(`error body: ${JSON.stringify(err.error, null, 2)}`);
      if (err.headers) {
        const requestId = err.headers.get?.('request-id') ?? err.headers['request-id'];
        if (requestId) console.error(`request-id: ${requestId}`);
      }
    } else {
      console.error(`type:    ${err?.constructor?.name ?? typeof err}`);
      console.error(`message: ${err?.message ?? String(err)}`);
      if (err?.stack) console.error(`stack:\n${err.stack}`);
    }
    console.error('\x1b[31m──────────────────────────────\x1b[0m');
    process.exit(1);
  }

  console.log(`\x1b[32m✓ agent installed:\x1b[0m ${agent.id} (version ${agent.version ?? '?'})`);

  const slug = basename(ymlPath, '.yml');
  await persistAgentId(slug, agent);

  console.log('');
  console.log('Next steps:');
  console.log('  1. Add .env.agents to a secrets manager (it is gitignored).');
  console.log('  2. Run the orchestrator:');
  console.log(`       node scripts/agent-orchestrator.mjs ${slug}`);
}

main().catch((err) => {
  console.error(`\x1b[31mfatal:\x1b[0m ${err.message ?? err}`);
  process.exit(1);
});
