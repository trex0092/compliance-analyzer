# Agent Frameworks Research Report

**Date:** 09/04/2026
**Branch:** `claude/research-agent-frameworks-WoYJZ`

---

## Executive Summary

This report analyzes 15 open-source repositories spanning multi-agent frameworks, coding agent orchestrators, Claude Code plugins/skills, and reference tooling. The landscape divides into four categories:

1. **General-Purpose Multi-Agent Frameworks** -- build any multi-agent system
2. **Coding Agent Orchestrators** -- coordinate AI coding assistants in parallel
3. **Claude Code Plugins & Skills** -- extend Claude Code with specialized capabilities
4. **Reference & Documentation** -- system prompt catalogs and tooling internals

The most relevant frameworks for a compliance-focused project like this one are those offering structured orchestration patterns (PEER/DOE from agentUniverse), graph-based workflows (Microsoft Agent Framework), and TypeScript-native agent coordination (open-multi-agent).

---

## Category 1: General-Purpose Multi-Agent Frameworks

### 1. ChatDev (OpenBMB/ChatDev)
| Attribute | Detail |
|---|---|
| **Stars** | ~32,600 |
| **Language** | Python (FastAPI backend), Vue 3 frontend |
| **License** | Apache 2.0 |
| **URL** | https://github.com/OpenBMB/ChatDev |

**What it does:** Zero-code multi-agent platform using LLM-powered agents to collaboratively build software, visualizations, 3D content, games, and more. Originally a "Virtual Software Company" metaphor (v1), now a general-purpose orchestration platform (v2).

**Architecture:** Agents collaborate through linguistic interactions across DAG-based topologies using MacNet, supporting 1,000+ agents without exceeding context limits. A learnable orchestrator (puppeteer paradigm) handles dynamic agent activation and sequencing, optimized with reinforcement learning.

**Key Features:**
- Web console with visual workflow canvas
- Real-time monitoring and human-in-the-loop feedback
- Python SDK for programmatic/batch use
- Docker Compose deployment
- Configurable LLM backends
- YAML-based workflow definitions

**Relevance to Compliance Analyzer:** High. The DAG-based orchestration and RL-optimized routing could be adapted for compliance workflow pipelines (CDD tiers, STR processing, sanctions screening chains).

---

### 2. OpenAI Agents Python SDK (openai/openai-agents-python)
| Attribute | Detail |
|---|---|
| **Stars** | ~20,670 |
| **Language** | Python |
| **License** | MIT |
| **URL** | https://github.com/openai/openai-agents-python |

**What it does:** Lightweight framework for building multi-agent workflows. Despite being from OpenAI, it is provider-agnostic, supporting 100+ LLMs.

**Core Primitives:**
- **Agents** -- LLMs with instructions, tools, guardrails, and handoffs
- **Handoffs** -- explicit delegation from one agent to another
- **Guardrails** -- input/output validation and safety checks
- **Sessions** -- automatic conversation history management
- **Tracing** -- built-in tracking/debugging with visualization UI

**Multi-Agent Patterns:**
1. **Agents as tools** -- one agent calls another as a callable tool
2. **Handoffs** -- explicit control transfer between agents

**Relevance to Compliance Analyzer:** Medium. The guardrails concept maps well to compliance validation gates. The handoff pattern fits the four-eyes approval workflow (e.g., analyst -> CO -> senior management).

---

### 3. OpenMAIC (THU-MAIC/OpenMAIC)
| Attribute | Detail |
|---|---|
| **Stars** | ~14,800 |
| **Language** | TypeScript, Next.js 16, React 19 |
| **License** | AGPL-3.0 |
| **URL** | https://github.com/THU-MAIC/OpenMAIC |

**What it does:** Open Multi-Agent Interactive Classroom from Tsinghua University. Transforms topics/documents into immersive classroom experiences with AI teachers and peers.

**Architecture:** A "director graph" built on LangGraph orchestrates specialized agents (teachers, peers, quiz generators, PBL guides). An Action Engine executes 28+ action types. State machine manages interaction modes (idle -> playing -> live).

**Relevance to Compliance Analyzer:** Low-Medium. The multi-agent orchestration via LangGraph is architecturally interesting. The interactive training concept could be adapted for compliance training modules, but the education focus limits direct applicability.

---

### 4. Microsoft Agent Framework (microsoft/agent-framework)
| Attribute | Detail |
|---|---|
| **Stars** | ~9,200 |
| **Language** | Python (50.6%), C# (45.2%), TypeScript (3.7%) |
| **License** | MIT |
| **URL** | https://github.com/microsoft/agent-framework |

**What it does:** Dual-language framework for building, orchestrating, and deploying AI agents with graph-based workflows.

**Key Features:**
- **Graph-based orchestration** with streaming, checkpointing, human-in-the-loop, and "time-travel" (state replay)
- **DevUI** for visual agent debugging
- **OpenTelemetry** observability
- **Middleware system** for request/response pipelines
- Migration paths from Semantic Kernel and AutoGen

**Relevance to Compliance Analyzer:** High. Graph-based orchestration with checkpointing maps directly to compliance workflows that require audit trails and state replay. The time-travel feature is valuable for regulatory investigations. Dual Python/C# support is a plus for enterprise environments.

---

### 5. open-multi-agent (JackChen-me/open-multi-agent)
| Attribute | Detail |
|---|---|
| **Stars** | ~5,530 |
| **Language** | TypeScript / Node.js |
| **License** | MIT |
| **URL** | https://github.com/JackChen-me/open-multi-agent |

**What it does:** TypeScript multi-agent orchestration framework. One `runTeam()` call takes a goal and delivers a result -- auto-decomposes into a task DAG, resolves dependencies, runs agents in parallel.

**Key Features:**
- Automatic task decomposition via coordinator agent
- Parallel execution with semaphore-controlled agent pools
- Multi-model support (Claude, GPT, Grok, Gemini, Ollama)
- Structured output via Zod schemas with auto-retry
- Built-in tools: bash, file read/write/edit, grep
- Human-in-the-loop approval gates
- Loop detection for stuck agents

**Three Execution Modes:**
1. `runAgent()` -- single agent
2. `runTeam()` -- auto-orchestrated
3. `runTasks()` -- explicit user-defined pipelines

**Relevance to Compliance Analyzer:** High. TypeScript-native, MIT license, Zod validation (already a project dependency pattern), and the approval gate mechanism directly supports four-eyes compliance workflows. The structured output with schema validation aligns with goAML XML generation needs.

---

### 6. agentUniverse (agentuniverse-ai/agentUniverse)
| Attribute | Detail |
|---|---|
| **Stars** | ~2,200 |
| **Language** | Python 3.10+ |
| **License** | Apache 2.0 |
| **URL** | https://github.com/agentuniverse-ai/agentUniverse |

**What it does:** Multi-agent framework from Ant Group, built for domain-expert-level agents in financial services.

**Collaboration Patterns:**
- **PEER** (Plan, Execute, Express, Review) -- complex problem decomposition with iterative feedback
- **DOE** (Data-fining, Opinion-inject, Express) -- data-intensive tasks requiring precision

**Key Features:**
- Professional domain knowledge injection
- OpenTelemetry observability
- Visual canvas-based workflow designer
- MCP server integration
- Proven in production at Ant Group ("Zhi Xiao Zhu" investment assistant)

**Relevance to Compliance Analyzer:** Very High. The PEER pattern maps directly to compliance review workflows (plan CDD approach, execute screening, express findings, review by CO). Financial services pedigree means the patterns are battle-tested for regulatory environments. Domain knowledge injection fits the UAE AML/CFT regulatory knowledge base.

---

## Category 2: Coding Agent Orchestrators

### 7. oh-my-claudecode (Yeachan-Heo/oh-my-claudecode)
| Attribute | Detail |
|---|---|
| **Stars** | ~26,800 |
| **Language** | TypeScript |
| **License** | MIT |
| **URL** | https://github.com/Yeachan-Heo/oh-my-claudecode |

**What it does:** Teams-first multi-agent orchestration framework for Claude Code.

**5 Orchestration Modes:**
1. **Team** -- staged pipeline (plan -> PRD -> exec -> verify -> fix)
2. **Autopilot** -- single-agent
3. **Ralph** -- persistent with verification loops
4. **Ultrawork** -- max parallelism
5. **Pipeline** -- sequential

**Key Features:**
- 19 specialized agents with tier variants
- Smart model routing (Haiku for simple, Opus for complex) -- 30-50% token savings
- Skill learning from sessions
- Real tmux-based parallel worker spawning
- Multi-provider support (Claude + Codex + Gemini)

**Relevance to Compliance Analyzer:** Medium. Primarily a development workflow tool, not a runtime framework. The staged pipeline pattern and verification loops are interesting for development process improvement.

---

### 8. Multica (multica-ai/multica)
| Attribute | Detail |
|---|---|
| **Stars** | ~4,070 |
| **Language** | TypeScript (frontend), Go (backend) |
| **License** | Other (non-standard) |
| **URL** | https://github.com/multica-ai/multica |

**What it does:** Open-source managed agents platform that turns coding agents into persistent team members. Agents show up on boards, post comments, create issues, and report blockers.

**Architecture:** Next.js 16 frontend, Go backend (Chi, sqlc, gorilla/websocket), PostgreSQL 17 with pgvector. Vendor-neutral runtime supporting Claude Code, Codex, OpenClaw, OpenCode.

**Key Features:**
- Agents as teammates with board presence
- Skill compounding (solutions become reusable skills)
- WebSocket-based real-time communication
- Multi-workspace isolation

**Relevance to Compliance Analyzer:** Low. This is a project management tool for AI agents, not a runtime agent framework.

---

### 9. multi-agent-shogun (yohey-w/multi-agent-shogun)
| Attribute | Detail |
|---|---|
| **Stars** | ~1,200 |
| **Language** | Shell/Bash |
| **License** | MIT |
| **URL** | https://github.com/yohey-w/multi-agent-shogun |

**What it does:** Feudal Japanese military hierarchy for coordinating parallel AI coding agents via tmux.

**10-Agent Hierarchy:**
- **Shogun (1):** Receives user commands
- **Karo (1):** Decomposes/distributes tasks, quality checks
- **Ashigaru (7):** Parallel workers in tmux panes
- **Gunshi (1):** Strategic analysis and design

**Key Features:**
- Multi-vendor CLI support (Claude Code, Codex, Copilot, Kimi Code)
- YAML-based coordination (zero API overhead)
- Android companion app for mobile monitoring
- Flat-rate economics (~$200/mo for 8 agents)

**Relevance to Compliance Analyzer:** Low. Creative approach but limited to development orchestration.

---

### 10. open-claude-cowork (ComposioHQ/open-claude-cowork)
| Attribute | Detail |
|---|---|
| **Stars** | ~3,730 |
| **Language** | JavaScript (Electron + Node.js) |
| **License** | MIT |
| **URL** | https://github.com/ComposioHQ/open-claude-cowork |

**What it does:** Open-source Electron desktop app for end-to-end work automation across desktop and SaaS apps. Includes "Clawdbot" messaging assistant.

**Key Features:**
- Multi-provider support (Claude Agent SDK + Opencode)
- 500+ SaaS integrations via Composio (Gmail, Slack, GitHub, Calendar)
- Cross-platform messaging integration (WhatsApp, Telegram, Signal)
- Browser automation
- Skills system (Markdown-defined)

**Relevance to Compliance Analyzer:** Low-Medium. The 500+ SaaS integrations and messaging capabilities could be useful for goAML filing notifications and compliance alert distribution, but it's not a multi-agent framework.

---

## Category 3: Claude Code Plugins & Skills

### 11. everything-claude-code (vedovelli/everything-claude-code)
| Attribute | Detail |
|---|---|
| **Stars** | ~50,000 |
| **Language** | Framework-agnostic (TypeScript, Python, Go, etc.) |
| **License** | MIT |
| **URL** | https://github.com/vedovelli/everything-claude-code |

**What it does:** Performance optimization and orchestration system for AI coding agents. 13 specialized sub-agents, 56+ skills, 32 slash commands, hooks for session lifecycle.

**Key Features:**
- **AgentShield** security pipeline: red-team/blue-team/auditor (1282 tests, 102 rules)
- Continuous learning: auto-extracts patterns into reusable skills
- Token optimization: prompt slimming, content-hash caching
- Cost-aware LLM pipeline with model routing
- Orchestration commands: `/multi-plan`, `/multi-execute`, `/orchestrate`

**Relevance to Compliance Analyzer:** Medium. The security pipeline (AgentShield) and sub-agent orchestration patterns are architecturally interesting. Could inform the compliance analyzer's own agent architecture for parallel screening and review workflows.

---

### 12. agents (wshobson/agents)
| Attribute | Detail |
|---|---|
| **Stars** | N/A (marketplace-listed) |
| **Language** | Python |
| **License** | Not stated |
| **URL** | https://github.com/wshobson/agents |

**What it does:** 182 specialized AI agents, 16 workflow orchestrators, 149 skills, and 96 commands organized into 77 focused Claude Code plugins.

**Architecture:**
- Four-tier model strategy: Opus (critical), Inherit (user-chosen), Sonnet (support), Haiku (fast)
- "Conductor" plugin for project management
- Agent Teams for parallel multi-agent execution

**Relevance to Compliance Analyzer:** Low-Medium. The plugin architecture and model tiering strategy could inform cost optimization for compliance workflows.

---

### 13. claude-seo (AgriciDaniel/claude-seo)
| Attribute | Detail |
|---|---|
| **Stars** | ~4,360 |
| **Language** | Python |
| **License** | MIT |
| **URL** | https://github.com/AgriciDaniel/claude-seo |

**What it does:** Universal SEO skill for Claude Code with 19 sub-skills and 12 concurrent subagents for parallel multi-domain audits.

**Relevance to Compliance Analyzer:** Low. SEO-specific, but the parallel subagent architecture pattern is worth noting for compliance audit parallelization.

---

### 14. ui-ux-pro-max-skill (nextlevelbuilder/ui-ux-pro-max-skill)
| Attribute | Detail |
|---|---|
| **Stars** | ~61,900 |
| **Language** | Python |
| **License** | Open source |
| **URL** | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |

**What it does:** AI design intelligence skill providing 67 UI styles, 161 color palettes, 57 font pairings, and 99 UX guidelines. Not an agent framework -- a design knowledge base with reasoning engine.

**Relevance to Compliance Analyzer:** Low. UI/UX-focused skill. Could be useful for the React frontend design but not for agent architecture.

---

## Category 4: Reference & Documentation

### 15. claude-code-system-prompts (Piebald-AI/claude-code-system-prompts)
| Attribute | Detail |
|---|---|
| **Stars** | ~8,520 |
| **Language** | JavaScript |
| **License** | MIT |
| **URL** | https://github.com/Piebald-AI/claude-code-system-prompts |

**What it does:** Community-maintained catalog of all Claude Code system prompts extracted from each npm release. Documents 110+ prompt strings, 40 agent prompts, 30 data references, 60 system prompts.

**Key Insight:** Claude Code uses a modular prompt architecture with conditionally-loaded segments. Sub-agent delegation works via the Task tool and Fork mechanism with dedicated scoping rules.

**Relevance to Compliance Analyzer:** Medium. Understanding Claude Code's internal prompt architecture informs how to write effective CLAUDE.md instructions and skills for the compliance analyzer project.

---

## Comparative Analysis

### Stars & Popularity Ranking

| Rank | Repository | Stars | Category |
|------|-----------|-------|----------|
| 1 | ui-ux-pro-max-skill | ~61,900 | Plugin/Skill |
| 2 | everything-claude-code | ~50,000 | Plugin/Skill |
| 3 | ChatDev | ~32,600 | Multi-Agent Framework |
| 4 | oh-my-claudecode | ~26,800 | Coding Orchestrator |
| 5 | openai-agents-python | ~20,670 | Multi-Agent Framework |
| 6 | OpenMAIC | ~14,800 | Multi-Agent Framework |
| 7 | microsoft/agent-framework | ~9,200 | Multi-Agent Framework |
| 8 | claude-code-system-prompts | ~8,520 | Reference |
| 9 | open-multi-agent | ~5,530 | Multi-Agent Framework |
| 10 | claude-seo | ~4,360 | Plugin/Skill |
| 11 | multica | ~4,070 | Coding Orchestrator |
| 12 | open-claude-cowork | ~3,730 | Coding Orchestrator |
| 13 | agentUniverse | ~2,200 | Multi-Agent Framework |
| 14 | multi-agent-shogun | ~1,200 | Coding Orchestrator |
| 15 | agents (wshobson) | N/A | Plugin/Skill |

### Orchestration Patterns Comparison

| Pattern | Used By | Description |
|---------|---------|-------------|
| **DAG-based task decomposition** | ChatDev, open-multi-agent | Tasks decomposed into dependency graphs, executed in topological order |
| **Staged pipeline** | oh-my-claudecode | Fixed stages: plan -> PRD -> exec -> verify -> fix |
| **PEER** (Plan/Execute/Express/Review) | agentUniverse | Iterative loop with review feedback |
| **DOE** (Data-fining/Opinion-inject/Express) | agentUniverse | Data-intensive precision tasks |
| **Handoffs** | openai-agents-python | Explicit agent-to-agent delegation |
| **Graph-based with checkpointing** | microsoft/agent-framework | State machine with time-travel replay |
| **Hierarchical command chain** | multi-agent-shogun | Feudal hierarchy: Shogun -> Karo -> Ashigaru |
| **Parallel subagents** | claude-seo, everything-claude-code | Concurrent specialist agents, results merged |

### Language/Stack Distribution

| Language | Frameworks |
|----------|-----------|
| **Python** | ChatDev, openai-agents-python, agentUniverse, microsoft/agent-framework |
| **TypeScript** | open-multi-agent, oh-my-claudecode, OpenMAIC |
| **JavaScript** | open-claude-cowork, claude-code-system-prompts |
| **Go + TypeScript** | multica |
| **Shell/Bash** | multi-agent-shogun |
| **Mixed Python/C#** | microsoft/agent-framework |

### License Distribution

| License | Frameworks |
|---------|-----------|
| **MIT** | openai-agents-python, open-multi-agent, oh-my-claudecode, multi-agent-shogun, everything-claude-code, claude-seo, open-claude-cowork, microsoft/agent-framework, claude-code-system-prompts |
| **Apache 2.0** | ChatDev, agentUniverse |
| **AGPL-3.0** | OpenMAIC |
| **Other/Unspecified** | multica, agents (wshobson), ui-ux-pro-max-skill |

---

## Recommendations for Compliance Analyzer

### Top 3 Frameworks by Relevance

1. **agentUniverse** -- The PEER pattern (Plan, Execute, Express, Review) directly maps to compliance workflows. Financial services pedigree from Ant Group. Domain knowledge injection supports UAE AML/CFT regulatory knowledge. Apache 2.0 license.

2. **microsoft/agent-framework** -- Graph-based orchestration with checkpointing and time-travel provides the audit trail capability essential for compliance. MIT license. Enterprise-grade with OpenTelemetry observability.

3. **open-multi-agent** -- TypeScript-native (aligns with project stack), MIT license, Zod schema validation, human-in-the-loop approval gates for four-eyes workflows, and multi-model support.

### Architectural Patterns to Adopt

| Compliance Need | Recommended Pattern | Source Framework |
|----------------|-------------------|-----------------|
| CDD tiered review | PEER (Plan/Execute/Express/Review) | agentUniverse |
| STR workflow with approvals | Handoffs + approval gates | openai-agents-python, open-multi-agent |
| Sanctions screening pipeline | DAG-based parallel execution | ChatDev, open-multi-agent |
| Audit trail / investigations | Graph with checkpointing + time-travel | microsoft/agent-framework |
| goAML filing generation | Structured output with Zod validation | open-multi-agent |
| Risk scoring with multiple factors | DOE (Data-fining/Opinion-inject/Express) | agentUniverse |
| Parallel screening (UN, OFAC, EU, UK, UAE, EOCN) | Parallel subagents | claude-seo pattern, open-multi-agent |

### Implementation Considerations

- **Stack alignment:** The compliance analyzer uses JavaScript/TypeScript + React. `open-multi-agent` (TypeScript/MIT) is the most stack-compatible framework.
- **Regulatory audit requirements:** Microsoft's time-travel/checkpointing pattern should be adopted for any agent workflow touching compliance decisions -- regulators may request state replay.
- **No tipping off (FDL Art.29):** Agent communication patterns must ensure STR-related agent outputs are never exposed to subjects. This requires careful access control in handoff patterns.
- **Four-eyes principle:** The human-in-the-loop approval gates from open-multi-agent and openai-agents-python should be mandatory for high-risk decisions (EDD, sanctions freeze, STR filing).
- **Cost optimization:** oh-my-claudecode's model routing strategy (Haiku for simple, Opus for complex) should inform which compliance tasks get which model tier.
