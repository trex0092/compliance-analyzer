#!/usr/bin/env node
/**
 * agent-orchestrator — event loop for a Hawkeye Managed Agent session.
 *
 * What it does:
 *  1. Loads an agent id from .env.agents (created by install-agent.mjs).
 *  2. Ensures a reusable environment exists (creates one on first run).
 *  3. Starts a session referencing the agent + environment.
 *  4. Streams session events.
 *  5. When the agent emits `agent.custom_tool_use` for `brain_event`,
 *     forwards the call to HAWKEYE_BRAIN_URL/api/brain with the bearer
 *     token and responds with `user.custom_tool_result`.
 *  6. When it emits `cachet_incident`, forwards to CACHET_BASE_URL.
 *  7. Breaks on `session.status_terminated` or on idle with a
 *     terminal stop_reason.
 *
 * Environment (orchestrator, host-side — never mounted to the agent):
 *   ANTHROPIC_API_KEY   — required
 *   HAWKEYE_BRAIN_URL   — e.g. https://compliance-analyzer.netlify.app
 *   HAWKEYE_BRAIN_TOKEN — 32+ hex bearer token
 *   CACHET_BASE_URL     — optional
 *   CACHET_API_TOKEN    — optional
 *
 * Usage:
 *   node scripts/agent-orchestrator.mjs incident-commander \
 *     "Triage the latest autopilot briefing"
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(__filename, '..', '..');
const ENV_AGENTS = resolve(PROJECT_ROOT, '.env.agents');
const ENVIRONMENT_NAME = 'hawkeye-compliance';

// ---------------------------------------------------------------------------
// .env.agents loader — minimal, no dependency on dotenv.
// ---------------------------------------------------------------------------
async function loadEnvAgents() {
  const out = {};
  try {
    const content = await readFile(ENV_AGENTS, 'utf8');
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx < 0) continue;
      out[line.slice(0, idx)] = line.slice(idx + 1);
    }
  } catch {
    /* file may not exist yet — caller will detect missing key */
  }
  return out;
}

function agentSlugToEnvKey(slug) {
  return `AGENT_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ID`;
}

/**
 * Look up an agent id by name via the Anthropic API. Paginates through
 * the user's agents and returns the first match. Used as a fallback when
 * .env.agents is missing (e.g. in a fresh CI run).
 */
const SLUG_TO_AGENT_NAME = {
  'incident-commander': 'hawkeye-incident-commander',
  'hawkeye-mlro': 'hawkeye-mlro',
};

async function findAgentIdByName(client, name) {
  for await (const agent of client.beta.agents.list()) {
    if (agent.name === name) return agent.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Environment provisioning — idempotent.
// ---------------------------------------------------------------------------
async function ensureEnvironment(client) {
  for await (const env of client.beta.environments.list()) {
    if (env.name === ENVIRONMENT_NAME) return env;
  }
  console.log(`  creating environment ${ENVIRONMENT_NAME}`);
  return await client.beta.environments.create({
    name: ENVIRONMENT_NAME,
    description: 'Hawkeye Sterling compliance sandbox',
    config: {
      type: 'cloud',
      networking: { type: 'unrestricted' },
    },
  });
}

// ---------------------------------------------------------------------------
// Custom tool handlers — host-side, with credentials.
// ---------------------------------------------------------------------------
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`orchestrator missing env var: ${name}`);
  return v;
}

async function handleBrainEvent(input) {
  const base = requireEnv('HAWKEYE_BRAIN_URL').replace(/\/+$/, '');
  const token = requireEnv('HAWKEYE_BRAIN_TOKEN');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${base}/api/brain`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: `brain http ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true, response: JSON.parse(body) };
  } catch (err) {
    return { ok: false, error: `brain fetch: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function handleCachetIncident(input) {
  const base = process.env.CACHET_BASE_URL;
  const token = process.env.CACHET_API_TOKEN;
  if (!base || !token) {
    return { ok: false, error: 'cachet_not_configured' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/api/v1/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cachet-Token': token,
      },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: `cachet http ${res.status}` };
    }
    return { ok: true, response: JSON.parse(body) };
  } catch (err) {
    return { ok: false, error: `cachet fetch: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}

async function runCustomTool(toolName, input) {
  switch (toolName) {
    case 'brain_event':
      return await handleBrainEvent(input);
    case 'cachet_incident':
      return await handleCachetIncident(input);
    default:
      return { ok: false, error: `unknown custom tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Session event loop.
// ---------------------------------------------------------------------------
async function runSession(client, sessionId, kickoff) {
  // Stream FIRST, then send — patterns doc Rule 7 (stream-first ordering).
  const stream = await client.beta.sessions.events.stream(sessionId);

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: kickoff }],
      },
    ],
  });

  for await (const event of stream) {
    switch (event.type) {
      case 'agent.message': {
        for (const block of event.content ?? []) {
          if (block.type === 'text') process.stdout.write(block.text);
        }
        break;
      }
      case 'agent.custom_tool_use': {
        const name = event.tool_name ?? event.name;
        console.log(`\n\x1b[36m[tool]\x1b[0m ${name}`);
        const result = await runCustomTool(name, event.input ?? {});
        const payload = result.ok
          ? JSON.stringify(result.response).slice(0, 4000)
          : `ERROR: ${result.error}`;

        await client.beta.sessions.events.send(sessionId, {
          events: [
            {
              type: 'user.custom_tool_result',
              custom_tool_use_id: event.id,
              content: [{ type: 'text', text: payload }],
              is_error: !result.ok,
            },
          ],
        });
        break;
      }
      case 'session.status_idle': {
        const stop = event.stop_reason?.type;
        if (stop === 'requires_action') {
          // agent waiting on our custom_tool_result — already handled
          continue;
        }
        console.log(`\n\x1b[33m[idle]\x1b[0m stop_reason=${stop}`);
        return;
      }
      case 'session.status_terminated': {
        console.log('\n\x1b[31m[terminated]\x1b[0m');
        return;
      }
      case 'session.error': {
        console.error(`\n\x1b[31m[error]\x1b[0m`, event);
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [slug, ...kickoffParts] = process.argv.slice(2);
  if (!slug) {
    console.error('Usage: node scripts/agent-orchestrator.mjs <agent-slug> "<kickoff message>"');
    process.exit(2);
  }
  const kickoff = kickoffParts.join(' ') || 'Begin compliance review.';

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('error: ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }

  const client = new Anthropic();

  // Agent id resolution:
  //  1. .env.agents (fast path — written by install-agent.mjs)
  //  2. Anthropic API lookup by name (fallback — for CI without artifact)
  const envAgents = await loadEnvAgents();
  const key = agentSlugToEnvKey(slug);
  let agentId = envAgents[key];
  if (agentId) {
    console.log(`\x1b[36mresolved agent from .env.agents:\x1b[0m ${agentId}`);
  } else {
    const name = SLUG_TO_AGENT_NAME[slug];
    if (!name) {
      console.error(`error: unknown agent slug "${slug}". Valid slugs: ${Object.keys(SLUG_TO_AGENT_NAME).join(', ')}`);
      process.exit(1);
    }
    console.log(`\x1b[36mlooking up agent by name:\x1b[0m ${name}`);
    agentId = await findAgentIdByName(client, name);
    if (!agentId) {
      console.error(`error: no agent named "${name}" in your Anthropic workspace. Run the Install Managed Agents workflow first.`);
      process.exit(1);
    }
    console.log(`  found agent: ${agentId}`);
  }

  console.log(`\x1b[36mresolving environment\x1b[0m`);
  const env = await ensureEnvironment(client);
  console.log(`  environment: ${env.id}`);

  console.log(`\x1b[36mcreating session\x1b[0m (agent=${agentId})`);
  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: env.id,
    title: `${slug} — ${new Date().toISOString().slice(0, 16)}`,
  });
  console.log(`  session: ${session.id}`);

  console.log(`\x1b[36mstreaming\x1b[0m`);
  try {
    await runSession(client, session.id, kickoff);
  } catch (err) {
    console.error(`\n\x1b[31mfatal:\x1b[0m ${err.message ?? err}`);
    process.exit(1);
  }
  console.log('\n\x1b[32m[done]\x1b[0m');
}

main().catch((err) => {
  console.error(`fatal: ${err.message ?? err}`);
  process.exit(1);
});
