# Hawkeye Sterling — Managed Agents

Agent configs for [platform.claude.com](https://platform.claude.com).
These are **separate** from the in-repo TypeScript agents under
`src/agents/definitions/` — those run inside the React app; these run
in Anthropic's managed agent runtime.

## Agents

| File | Role | Scope |
|---|---|---|
| `incident-commander.yml` | Reactive triager for brain alerts | Read + draft + escalate. No portal access. |
| `hawkeye-mlro.yml` | Strategic drafting assistant for the MLRO | Read everything, draft everything, approve nothing. |

## Installing an agent on platform.claude.com

1. Go to **platform.claude.com → Agents → New agent**.
2. Pick the **Incident commander** template as the starting point
   (only matters for the toolset version pinned in `tools:`).
3. Switch the config editor to **YAML**.
4. Replace the default content with the contents of
   `agents/incident-commander.yml`.
5. Click **Create agent**.

Repeat for `hawkeye-mlro.yml` if you want the strategic agent too.

## Required environment variables

Set these in the agent's **Settings → Environment** panel on
platform.claude.com. **Never** commit the values.

| Variable | Purpose | How to get it |
|---|---|---|
| `HAWKEYE_BRAIN_TOKEN` | Bearer token for POST `/api/brain`. 32+ hex chars. | Generate with the client auth module, store in Netlify env, copy the hex here. |
| `CACHET_BASE_URL` | Public URL of your Cachet status page. | e.g. `https://status.hawkeye-sterling.com`. |
| `CACHET_API_TOKEN` | Cachet REST token. | Cachet UI → Settings → API → Generate. |
| `GITHUB_TOKEN` | Fine-grained PAT scoped to `trex0092/compliance-analyzer`. | github.com → Settings → Developer settings → PAT → fine-grained. |

## Safety model

Both agents operate under hard invariants that match `CLAUDE.md`:

1. **No tipping off** (FDL Art.29). Neither agent can draft anything
   that reaches a subject. The prohibition is in both system prompts
   AND the brain endpoint's routing test suite.
2. **No portal submission.** Agents draft only. goAML, EOCN, and CNMR
   submissions require a human MLRO signature.
3. **No raw PII in agent artefacts.** Agents pass `refId` and let the
   brain look up the authoritative record server-side.
4. **Four-eyes for High / Very-High / PEP / sanctions decisions.**
   Agents prepare the action for a human approver, they do not
   execute it.
5. **Rate-limited, authed endpoint.** The brain endpoint enforces
   Bearer auth + 10 req/15min per IP, matches the rest of the
   compliance suite's security posture.

## What each agent sees

Both agents talk to the same backend:

- **POST `/api/brain`** (`netlify/functions/brain.mts`) for routing
  decisions and event persistence.
- **`code-review-graph` MCP** for structural queries over the repo
  (callers, impact radius, review context).
- **`claude-mem` MCP** for persistent compliance memory across
  sessions.
- **GitHub MCP** for issues + PRs on `trex0092/compliance-analyzer`.
- **Cachet REST API** for public status page incidents.
- **GenAIScript skills** (`str-narrative`, `sanctions-triage`) for
  drafting regulatory narratives.

## Recommended rollout

1. Install `incident-commander.yml` first. Let it run for a week on
   the daily autopilot output. Review every action it takes.
2. Once the triage behaviour is trustworthy, install `hawkeye-mlro.yml`
   and let it review the weekly autopilot digest.
3. Do not grant either agent write access to the constants file or
   the regulatory corpus without a human review gate.
4. Log every agent action into the evidence chain
   (`scripts/evidence-chain.mjs`).
