# AI Repository Review — 2026-04-12

Evaluation of 5 open-source AI/agent repositories for patterns, code, and
ideas applicable to the compliance-analyzer project.

## Evaluation Criteria

Each repo is assessed on:
- **Purpose & maturity** (stars, activity, documentation)
- **Agent/AI patterns** (orchestration, multi-agent, tool use)
- **Compliance relevance** (screening, audit trail, risk scoring, skills, workflows)
- **Security posture** (secrets handling, input validation, licensing)
- **Actionable takeaways** for this project

---

## 1. forrestchang/andrej-karpathy-skills

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/forrestchang/andrej-karpathy-skills |
| **Stars** | 14,700 |
| **License** | MIT |
| **Stack** | Pure Markdown (CLAUDE.md plugin) |
| **Last active** | Jan 2026 |

### What it does
A single `CLAUDE.md` file that injects four behavioral principles into Claude
Code sessions, targeting common LLM coding pitfalls identified by Andrej
Karpathy: wrong assumptions, overcomplication, unintended changes, and lack of
goal-driven execution. Distributed as a Claude Code Plugin.

### Agent/AI patterns
- **Prompt engineering via CLAUDE.md injection** -- shaping LLM behavior
  through declarative constraints.
- **"Goal-Driven Execution"** -- convert imperative tasks into test-first
  verification loops (write test, make it pass, verify no regression).

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| Multi-agent orchestration | None | No code, no agents |
| Skills system | Low | Single skill file as packaging example |
| Screening / workflows | None | -- |
| Audit trail | None | -- |
| Risk scoring | None | -- |
| Behavioral guardrails | **High** | "Surgical Changes" + "Goal-Driven Execution" reinforce audit-trail discipline |

### Security
Zero attack surface -- no executable code, no dependencies, no secrets.

### Verdict: REFERENCE ONLY
- **Adopt?** No code to vendor. The four principles are worth reviewing as a
  behavioral supplement to our CLAUDE.md, especially "Surgical Changes" (every
  changed line traces to a requirement) and "Goal-Driven Execution" (test-first
  loops for regulatory logic).
- **Risk:** None.

---

## 2. multica-ai/multica

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/multica-ai/multica |
| **Stars** | 8,700 |
| **License** | Modified Apache 2.0 (commercial SaaS restrictions) |
| **Stack** | Next.js 16 + Go + PostgreSQL 17 + pgvector |
| **Last active** | April 2026 (v0.1.26) |

### What it does
An open-source managed agents platform that lets developers assign coding tasks
to AI agents (Claude Code, Codex, OpenClaw, OpenCode) as if they were team
members. Provides task assignment, real-time WebSocket streaming, reusable
skills across teams, and multi-workspace organization.

### Agent/AI patterns
- **Multi-runtime agent management** -- interchangeable agent runtimes
- **Skills as first-class citizens** -- build once, share across agents/teams
- **Real-time WebSocket streaming** -- live progress monitoring
- **Daemon + event-driven architecture** -- background process managing agent
  lifecycle, task queuing, and workflow coordination
- **pgvector** -- vector search for skills/context retrieval

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| Multi-agent orchestration | **High** | Multi-runtime dispatch validates our Sonnet/Opus routing |
| Skills system | **High** | Portable skill definitions, versioning, team sharing |
| Screening / workflows | Low | No compliance-specific logic |
| Audit trail | Low | Event system exists but not compliance-oriented |
| Risk scoring | None | -- |
| Real-time dashboards | **Medium** | WebSocket streaming pattern for MLRO ops dashboard |

### Security
- Input sanitization package (`internal/sanitize`) -- positive signal
- Auth and middleware present
- Modified Apache 2.0 -- review license before any code adoption
- No obvious red flags

### Verdict: PATTERN REFERENCE
- **Adopt?** No code to vendor (license restrictions, Go backend vs our JS/TS
  stack). The **skills-as-first-class-citizens** pattern and **WebSocket
  streaming architecture** are worth studying for our skill system and future
  MLRO dashboard.
- **Risk:** License incompatibility for direct code use.

---

## 3. shanraisshan/claude-code-best-practice

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/shanraisshan/claude-code-best-practice |
| **Stars** | 38,014 |
| **License** | MIT |
| **Stack** | Markdown/HTML (documentation repo) |
| **Last active** | April 11, 2026 |

### What it does
A comprehensive knowledge base documenting Claude Code best practices, from
basic "vibe coding" to advanced "agentic engineering." Curates official
Anthropic patterns, community workflows, and implementation examples. Organized
around 8 feature categories: Subagents, Commands, Skills, Workflows, Hooks, MCP
Servers, Plugins, Settings.

### Agent/AI patterns
- **Command -> Agent -> Skill** orchestration pattern
- **Subagent isolation** -- autonomous actors with custom tools, permissions,
  model selection; subagents cannot invoke other subagents via bash
- **Skill frontmatter spec** -- `allowed-tools`, `model`, `context`, `agent`,
  `hooks`, `disable-model-invocation`
- **Model routing** -- executor/advisor patterns, model tiering
- **Workflow comparison** -- catalogs 10+ open-source frameworks

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| Multi-agent orchestration | **Medium** | Validates our subagent discipline (Section 10 of CLAUDE.md) |
| Skills system | **High** | Skill frontmatter spec could standardize our 17+ skills |
| Screening / workflows | None | -- |
| Audit trail | Low | "Granular commits per file" is stricter than ours |
| Risk scoring | None | -- |
| CLAUDE.md patterns | **High** | Confirms our architecture follows community best practices |

### Security
Zero attack surface -- documentation repo, no executable code.

### Verdict: VALIDATION + SKILL SPEC REFERENCE
- **Adopt?** No code to vendor. Our CLAUDE.md is already more sophisticated
  (regulatory domain knowledge, decision trees, error recovery playbook).
  The **skill frontmatter specification** is actionable -- we could adopt
  standardized frontmatter fields across our 17+ compliance skills for
  consistency and auto-discovery.
- **Risk:** None.

---

## 4. shiyu-coder/Kronos

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/shiyu-coder/Kronos |
| **Stars** | 15,100 |
| **License** | MIT |
| **Stack** | Python 3.10+, PyTorch, Hugging Face |
| **Last active** | August 2025 |

### What it does
The first open-source foundation model for financial candlestick (K-line) data,
trained on data from 45+ global exchanges. Uses a hierarchical tokenizer to
convert OHLCV market data into discrete tokens, then an autoregressive
decoder-only transformer for next-token prediction. Accepted at AAAI 2026.

### Agent/AI patterns
**None.** Kronos is a standalone ML prediction model with no multi-agent
orchestration, workflow engines, scheduling, or agent coordination patterns.

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| Multi-agent orchestration | None | -- |
| Skills system | None | -- |
| Screening / workflows | None | -- |
| Audit trail | None | -- |
| Risk scoring | None | -- |
| Transaction anomaly detection | **Low** | Tokenization approach for financial data *could* theoretically inform anomaly detection, but requires significant adaptation |

### Security
- MIT license, safe for reference
- No API keys or secrets handling
- No web endpoints in production use

### Verdict: NOT RELEVANT
- **Adopt?** No. Kronos is a high-quality ML research project (AAAI 2026) but
  has zero overlap with the compliance-analyzer's needs. No agent patterns, no
  compliance logic, no workflow architecture. The financial tokenization concept
  is too far removed from AML/CFT requirements to justify integration effort.
- **Risk:** None (we're not adopting it).

---

## 5. NousResearch/hermes-agent

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/NousResearch/hermes-agent |
| **Stars** | 63,000 |
| **License** | MIT |
| **Stack** | Python 3.11+, openai/anthropic SDKs, pydantic, httpx |
| **Last active** | April 8, 2026 (v0.8.0) |

### What it does
A self-improving AI agent that creates skills from experience, improves them
during use, persists knowledge across sessions, and builds a deepening user
model. Runs as a CLI agent with multi-platform messaging gateways (Telegram,
Discord, Slack, WhatsApp, Signal). 57 tool modules, 26 skill categories.

### Agent/AI patterns
- **Smart model routing** (`smart_model_routing.py`) -- dynamic model selection,
  analogous to our Sonnet/Opus advisor strategy
- **Mixture of agents** (`mixture_of_agents_tool.py`) -- multi-model ensemble
  for consensus decisions
- **Delegation** (`delegate_tool.py`) -- sub-agent spawning for side tasks
- **Approval gates** (`approval.py`) -- human-in-the-loop confirmation for
  sensitive actions (maps to four-eyes principle)
- **Memory + context compression** -- progressive context management across
  sessions
- **Skill auto-creation** -- agent learns and persists new skills from usage
- **MCP integration** -- full Model Context Protocol support
- **RL training loop** -- reinforcement learning for self-improvement
- **Trajectory tracking** (`trajectory.py`) -- decision-path recording

### Compliance relevance
| Aspect | Rating | Notes |
|--------|--------|-------|
| Multi-agent orchestration | **High** | Delegation + mixture-of-agents + approval gates |
| Skills system | **High** | 26 categories, auto-creation (needs guardrails for compliance) |
| Screening / workflows | **Medium** | Mixture-of-agents for multi-list sanctions consensus |
| Audit trail | **High** | Trajectory tracking = decision-path recording |
| Risk scoring | Low | No built-in risk scoring |
| Model routing | **High** | Smart routing validates our advisor strategy |
| Four-eyes | **High** | Approval gates map directly to four-eyes principle |

### Security
- Pinned dependency ranges -- positive signal
- Dedicated security modules: `path_security.py`, `url_safety.py`,
  `tirith_security.py`, `skills_guard.py`
- `redact.py` for sensitive data handling
- SQL injection prevention tests present
- `curl | bash` install pattern is a supply-chain risk

### Verdict: HIGH-VALUE PATTERN REFERENCE
- **Adopt?** No direct code vendoring (Python vs our JS/TS stack), but
  **multiple patterns are directly transferable**:
  1. **Mixture-of-agents** for sanctions screening consensus (run multiple
     models, aggregate results before freeze/escalate)
  2. **Approval gates** as a reference implementation for four-eyes workflows
  3. **Trajectory tracking** for explainable compliance decisions and
     reasoningChain DAG capture
  4. **Smart model routing** validates and extends our Sonnet/Opus strategy
- **Caution:** Skill auto-creation is powerful but dangerous for regulated
  systems. Skills must be deterministic, versioned, and auditable -- not
  auto-generated without regulatory sign-off.
- **Risk:** Low (reference only, MIT license).

---

## Summary Matrix

| Repo | Stars | Stack | Compliance Relevance | Recommendation |
|------|-------|-------|---------------------|----------------|
| andrej-karpathy-skills | 14.7K | Markdown | Low (behavioral only) | Reference: adopt "Surgical Changes" + "Goal-Driven Execution" principles |
| multica | 8.7K | Next.js + Go | Medium (skills + streaming) | Pattern reference: skill portability + WebSocket streaming for MLRO dashboard |
| claude-code-best-practice | 38K | Markdown | Medium (validates our patterns) | Validation: adopt skill frontmatter spec for our 17+ skills |
| Kronos | 15.1K | Python/PyTorch | None | Skip: no agent/compliance patterns |
| hermes-agent | 63K | Python | **High** (orchestration + approval + trajectory) | Pattern reference: mixture-of-agents, approval gates, trajectory tracking |

## Top 3 Actionable Takeaways

1. **Mixture-of-agents for sanctions screening** (from hermes-agent): Running
   multiple models in parallel and requiring consensus before freeze/escalate
   decisions could strengthen screening confidence. This extends our existing
   `/multi-agent-screen` skill with an ensemble voting layer.

2. **Standardize skill frontmatter** (from claude-code-best-practice + multica):
   Our 17+ compliance skills would benefit from consistent frontmatter fields
   (`allowed-tools`, `model`, `context`, `hooks`, `isolation`) for
   auto-discovery, portability, and documentation.

3. **Trajectory tracking for explainable decisions** (from hermes-agent): The
   `trajectory.py` pattern of recording every decision step maps directly to
   our reasoningChain DAG needs. Every compliance verdict should carry a
   reproducible decision path for audit.

## Repos NOT Recommended for Vendoring

- **Kronos** -- no architectural overlap, pure ML forecasting model
- **andrej-karpathy-skills** -- no code to vendor, principles already covered
  by our CLAUDE.md
- **claude-code-best-practice** -- documentation repo, no runnable code
- **multica** -- license restrictions (modified Apache 2.0), Go backend
  incompatible with our stack
- **hermes-agent** -- Python stack, but worth bookmarking `approval.py`,
  `mixture_of_agents_tool.py`, and `trajectory.py` as reference implementations
