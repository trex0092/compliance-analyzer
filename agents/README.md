# Hawkeye Sterling — Managed Agents

Agent configs for the Anthropic Managed Agents API
(`POST /v1/agents`, beta header `managed-agents-2026-04-01`).

These are **separate** from the in-repo TypeScript agents under
`src/agents/definitions/` — those run inside the React app; these
run in Anthropic's managed agent runtime with hosted containers.

## Agents

| File | Role | Scope |
|---|---|---|
| `incident-commander.yml` | Reactive triager for brain alerts | Read + draft + escalate. No portal access. |
| `hawkeye-mlro.yml` | Strategic drafting assistant for the MLRO | Read everything, draft everything, approve nothing. |

## Installing an agent

### Scripted (recommended)

```bash
export ANTHROPIC_API_KEY=sk-ant-...

# Creates the agent via /v1/agents, stores id + version in .env.agents
node scripts/install-agent.mjs agents/incident-commander.yml
node scripts/install-agent.mjs agents/hawkeye-mlro.yml
```

The install script:
- Validates the YAML against the Managed Agents API schema + the
  safety invariants in `tests/agentConfigs.test.ts` **before** making
  any API call.
- Refuses to install any agent whose system prompt is missing the
  FDL Art.29 no-tipping-off language.
- Refuses to install any tool whose name suggests subject
  notification or direct portal submission.
- **Idempotent.** If an agent with the same name exists in your
  workspace, it calls `agents.update()` (which creates a new
  immutable version) instead of creating a duplicate.
- Writes `{agent_id, version}` pairs to `.env.agents` (gitignored)
  for the orchestrator to pick up.

### Manual (platform.claude.com UI)

1. Go to **platform.claude.com → Agents → New agent**.
2. Switch to the **YAML** config editor.
3. Paste the contents of the `.yml` file.
4. Click **Create agent**.

## Running an agent

```bash
# Orchestrator env vars — host-side only, never mounted to the agent
export ANTHROPIC_API_KEY=sk-ant-...
export HAWKEYE_BRAIN_URL=https://hawkeye-sterling-v2.netlify.app
export HAWKEYE_BRAIN_TOKEN=<32+ hex bearer token>
export CACHET_BASE_URL=https://status.example.com   # optional
export CACHET_API_TOKEN=<from Cachet Settings>       # optional

node scripts/agent-orchestrator.mjs incident-commander "Triage last night's alerts"
```

The orchestrator:
- Resolves the agent id from `.env.agents`.
- Reuses (or creates) a shared `hawkeye-compliance` environment.
- Opens a session, streams events.
- Handles `agent.custom_tool_use` for `brain_event` and
  `cachet_incident` by calling the real HTTP endpoints host-side
  with the orchestrator's credentials, then responding with
  `user.custom_tool_result`. **The agent container never sees the
  brain token or the Cachet token** — per the "keep credentials
  host-side via custom tools" pattern.
- Breaks on `session.status_terminated` or on `session.status_idle`
  with a terminal `stop_reason` (not on bare idle — handles the
  `requires_action` transient state correctly).

## Why not pure MCP for the brain and Cachet?

Managed Agents only supports **URL-based MCP servers** — the agent
runs in an Anthropic-hosted container, so `stdio` MCP servers like
`claude-mem` and `code-review-graph` (which launch via `npx` or
`uvx` on your machine) cannot be reached.

The `brain_event` and `cachet_incident` capabilities are therefore
declared as `type: custom` tools. The agent emits
`agent.custom_tool_use`; the orchestrator forwards the call to
`/api/brain` or Cachet with the appropriate auth and returns the
result via `user.custom_tool_result`. This is the idiomatic pattern
for host-side credentials — see `shared/managed-agents-client-patterns.md`
in the `claude-api` skill.

The only MCP server the agents use is the hosted `github` server
(`https://api.githubcopilot.com/mcp/`), which is URL-based and
authenticates via the `GITHUB_TOKEN` injected into the session's
GitHub repository resource.

## Safety model

Both agents operate under hard invariants that match `CLAUDE.md` and
are enforced by `tests/agentConfigs.test.ts`:

1. **No tipping off** (FDL Art.29). Every system prompt contains the
   prohibition, no tool name suggests subject notification, and the
   brain endpoint's routing test suite proves the invariant across
   all 7 event kinds.
2. **No portal submission.** Agents draft only. goAML, EOCN, and
   CNMR submissions require a human MLRO signature.
3. **No raw PII in agent artefacts.** Agents pass `refId` and let
   the brain look up the authoritative record server-side.
4. **Four-eyes for High / Very-High / PEP / sanctions decisions.**
   Agents prepare the action for a human approver, they do not
   execute it.
5. **Rate-limited, authed endpoint.** The brain endpoint enforces
   Bearer auth + 10 req/15min per IP.

## Recommended rollout

1. Install `incident-commander.yml` first. Let it run for a week on
   the daily autopilot output. Review every action it takes.
2. Once the triage behaviour is trustworthy, install `hawkeye-mlro.yml`
   and let it review the weekly autopilot digest.
3. Do not grant either agent write access to the constants file or
   the regulatory corpus without a human review gate.
4. Log every agent action into the evidence chain
   (`scripts/evidence-chain.mjs`).
