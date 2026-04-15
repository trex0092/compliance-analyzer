# Compliance Analyzer — Project Instructions

## Token-Efficient Workflow

This project uses **code-review-graph** as an MCP tool. Follow these rules
to minimize token usage while maintaining quality:

### Rule 1: Graph First, Files Second
- **ALWAYS** start with `get_minimal_context(task="...")` before reading any file.
- Use `query_graph` to understand specific functions/dependencies instead of reading entire files.
- Use `get_impact_radius` to check blast radius before making changes.
- Use `get_review_context` for PR reviews instead of reading all changed files.
- **Only read a file when you need to edit it or the graph doesn't have enough detail.**

### Rule 2: Targeted Reads
- Never read a full file to understand its structure — use the graph.
- When you must read a file, use `offset` and `limit` to read only the relevant section.
- `compliance-suite.js` is 4300+ lines — always query the graph for specific functions first.

### Rule 3: Change Reviews
- Use `detect_changes` for risk-scored analysis before reviewing code.
- Focus review effort on high-risk changes; low-risk changes need minimal attention.
- Use `get_affected_flows` to understand downstream impact.

### Rule 4: Keep the Graph Updated
- Run `build_or_update_graph_tool` after significant code changes.
- This keeps subsequent queries accurate and avoids stale context.

## Context Navigation

When you need to understand the codebase, docs, or any files in this project:

1. **ALWAYS** query the knowledge graph first: `/graphify query "your question"`
2. Only read raw files if the user explicitly says "read the file" or "look at the raw file"
3. Use `graphify-out/wiki/index.md` as your navigation entrypoint for browsing structure
4. Keep the graph fresh by re-running `/graphify .` after significant code changes

Graphify complements the existing `code-review-graph` MCP tool:
- Use **Graphify** for natural-language questions across all project files, docs, and skills.
- Use **code-review-graph** for structural queries (impact radius, call graphs, change review).

Setup instructions live in `docs/graphify-obsidian-setup.md`.

## Project Structure

- **Root `.js` files**: Core backend modules (compliance-suite, database, workflow-engine, auth, etc.)
- **`src/`**: React frontend (TSX components organized by domain, risk, services, ui, utils)
- **`vendor/`**: Integrated agent frameworks and reference implementations (14 submodules)
- **`skills/`**: 17 compliance-specific skills (including 3 new multi-agent skills)
- **`.agents/skills/`**: External generic skills (SEO, UI/UX, browser, etc.)
- **`docs/research/`**: Framework research and analysis documents
- **Stack**: JavaScript/TypeScript, React

---

# Seguridad

Este proyecto debe seguir las mejores prácticas de seguridad web en todo
momento. Aplica estas reglas en cada archivo y endpoint que generes:

## 1. Rate Limiting

- Implementa rate limiting en TODOS los endpoints de la API.
- Usa un middleware de rate limiting (como express-rate-limit, @upstash/ratelimit, o el equivalente en tu framework).
- Límites recomendados:
  - API general: 100 peticiones por IP cada 15 minutos.
  - Auth (login/registro): 5 intentos por IP cada 15 minutos.
  - Endpoints sensibles (pagos, admin): 10 peticiones por IP cada 15 minutos.
- Devuelve un error 429 (Too Many Requests) con un mensaje claro cuando se exceda el límite.

## 2. Variables de Entorno y Secretos

- NUNCA escribas API keys, tokens, contraseñas o secretos directamente en el código.
- Usa SIEMPRE variables de entorno (.env) para cualquier credencial.
- Asegúrate de que .env está en el .gitignore.
- Si necesitas una API key nueva, créala como variable de entorno y documéntala en un .env.example (sin el valor real, solo el nombre de la variable).
- Valida al arrancar la app que todas las variables de entorno necesarias existen. Si falta alguna, la app no debe iniciar.

## 3. Validación de Inputs (Anti-Inyección)

- Valida y sanitiza TODOS los inputs del usuario antes de procesarlos (formularios, query params, headers, body de peticiones).
- Usa una librería de validación (como zod, joi, o yup) para definir schemas estrictos.
- Nunca construyas queries SQL concatenando strings con input del usuario. Usa SIEMPRE queries parametrizadas o un ORM (como Drizzle, Prisma, etc.).
- Escapa cualquier output que se renderice en HTML para prevenir XSS. Usa las protecciones built-in de tu framework (React escapa por defecto, pero ten cuidado con dangerouslySetInnerHTML).
- Rechaza y loguea cualquier input que no pase la validación.

## 4. Headers de Seguridad

- Configura headers de seguridad HTTP: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security.
- Usa un middleware como helmet (Express) o el equivalente de tu framework.

## 5. Autenticación y Sesiones

- Usa tokens seguros (httpOnly, secure, sameSite) para cookies de sesión.
- Implementa CSRF protection en formularios.
- Las contraseñas deben hashearse con bcrypt o argon2. NUNCA almacenar en texto plano.

## 6. Logging de Seguridad

- Loguea intentos fallidos de autenticación.
- Loguea peticiones que excedan el rate limit.
- Loguea inputs rechazados por la validación (posibles intentos de inyección).
- NUNCA loguees datos sensibles (contraseñas, tokens, datos personales).

---

# Regulatory Domain Knowledge

When writing or reviewing code for this project, apply these UAE AML/CFT/CPF
regulatory requirements automatically. This ensures every feature is
compliant by default.

## Key Legislation

| Law / Resolution | Scope | Key Articles |
|---|---|---|
| FDL No.10/2025 | UAE AML/CFT/CPF Law | Art.12-14 (CDD), Art.15-16 (thresholds), Art.20-21 (CO duties), Art.24 (record retention 10yr), Art.26-27 (STR filing), Art.29 (no tipping off), Art.35 (TFS) |
| Cabinet Res 134/2025 | Implementing Regulations | Art.5 (risk appetite), Art.7-10 (CDD tiers), Art.14 (PEP/EDD), Art.16 (cross-border cash AED 60K), Art.18 (CO change notification), Art.19 (internal review) |
| Cabinet Res 74/2020 | TFS / Asset Freeze | Art.4-7 (freeze within 24h, report to EOCN, CNMR within 5 days) |
| Cabinet Res 156/2025 | PF & Dual-Use Controls | PF risk assessment, strategic goods screening |
| Cabinet Decision 109/2023 | UBO Register | Beneficial ownership >25%, re-verify within 15 working days |
| Cabinet Res 71/2024 | Administrative Penalties | AED 10K–100M penalty range |
| MoE Circular 08/AML/2021 | DPMS Sector Guidance | goAML registration, quarterly DPMS reports, AED 55K threshold |
| LBMA RGG v9 | Responsible Gold Guidance | 5-step framework, CAHRA due diligence, annual audit |
| UAE MoE RSG Framework | Responsible Sourcing of Gold | Origin traceability, refiner DD, CAHRA mitigation, ASM compliance, annual disclosure |
| Dubai Good Delivery (DGD) | Dubai gold standard | Refiner accreditation, hallmark, assay certification |
| FATF Rec 22/23 | DPMS Sector | CDD, record-keeping, STR obligations for dealers |

## Critical Thresholds

- **AED 55,000**: DPMS cash transaction reporting threshold (CTR via goAML)
- **AED 60,000**: Cross-border cash/BNI declaration
- **25%**: Beneficial ownership threshold for UBO register
- **24 hours**: Asset freeze execution deadline after sanctions confirmation
- **5 business days**: CNMR filing deadline to EOCN
- **15 working days**: UBO re-verification deadline after ownership change
- **10 years**: Minimum record retention period (FDL No.10/2025 Art.24)
- **30 days**: Policy update deadline after new MoE circular

## Coding Rules for Compliance Features

1. **Sanctions screening**: Always check ALL lists (UN, OFAC, EU, UK, UAE, EOCN). Never skip a list.
2. **STR workflow**: Never expose STR status to the subject. No tipping off (FDL Art.29).
3. **Audit trail**: Every compliance action MUST be logged with timestamp, user, and action.
4. **Four-eyes**: High-risk decisions require two independent approvers.
5. **Risk scoring**: Use likelihood × impact formula. Apply context multipliers for jurisdiction, PEP, cash.
6. **Date format**: Always dd/mm/yyyy for UAE compliance documents.
7. **Currency**: AED as primary. When converting, use published CBUAE rates, not hardcoded.
8. **goAML exports**: Must conform to UAE FIU XML schema. Validate before submission.

## Decision Trees — Follow These Automatically

### When editing ANY file that touches money/amounts:
```
Is a threshold value involved?
├── YES → Is it imported from src/domain/constants.ts?
│   ├── YES → Safe to proceed
│   └── NO → STOP. Refactor to use constants.ts. Never hardcode thresholds.
└── NO → Proceed normally
```

### When a sanctions match is detected:
```
Match confidence >= 0.9 (confirmed)?
├── YES → FREEZE immediately
│   ├── Start 24h EOCN countdown (checkEOCNDeadline)
│   ├── File CNMR within 5 business days (checkDeadline)
│   └── DO NOT notify the subject (Art.29)
├── 0.5-0.89 (potential) → Escalate to CO
│   └── CO decides: confirm → FREEZE path, or false positive → document & dismiss
└── < 0.5 → Log and dismiss, document reasoning
```

### When creating/modifying a filing deadline:
```
Use src/utils/businessDays.ts — NEVER calculate with calendar days.
├── STR/SAR → checkDeadline(event, 10)  [10 business days]
├── CTR/DPMSR → checkDeadline(event, 15)  [15 business days]
├── CNMR → checkDeadline(event, 5)  [5 business days]
└── EOCN freeze → checkEOCNDeadline()  [24 clock hours, NOT business days]
```

### When a new customer is onboarded:
```
Run /screen [customer] first
├── Score < 6 → SDD (Simplified) → standard CDD review at 12 months
├── Score 6-15 → CDD (Standard) → review at 6 months
├── Score >= 16 → EDD (Enhanced) → review at 3 months
│   └── Requires Senior Management approval (Art.14)
├── PEP detected → EDD + Board approval
└── Sanctions match → STOP. Run /incident [customer] sanctions-match
```

### When modifying risk scoring logic:
```
BEFORE changing anything:
1. Run: npx vitest run tests/scoring.test.ts tests/decisions.test.ts tests/constants.test.ts
2. Note current test results
AFTER changing:
3. Run same tests — all must pass
4. If constants.test.ts fails → you changed a regulatory value. Is the regulation actually changed?
   ├── YES → Update test + REGULATORY_CONSTANTS_VERSION
   └── NO → Revert your change immediately
```

## Constants Architecture

**ALL regulatory values live in `src/domain/constants.ts`.**
This is the single source of truth. When a regulation changes:
1. Update the constant in constants.ts
2. Update the test in tests/constants.test.ts
3. Update REGULATORY_CONSTANTS_VERSION
4. Run `/regulatory-update` skill for full impact analysis

## Custom Skills Available

| Skill | Purpose | When to use |
|-------|---------|-------------|
| `/review-pr` | Risk-scored PR review | Before merging any PR |
| `/audit` | Compliance audit report | Pre-audit preparation, quarterly review |
| `/screen` | Sanctions & risk screening | Customer onboarding, periodic re-screening |
| `/goaml` | Generate goAML XML filing | STR/SAR/CTR/DPMSR/CNMR submission |
| `/onboard` | Customer onboarding workflow | New customer/counterparty setup |
| `/incident` | Incident response with countdown | Sanctions match, STR trigger, asset freeze |
| `/deploy-check` | Pre-deployment verification | Before every production push |
| `/regulatory-update` | Process new regulation | When law/circular/list changes |
| `/audit-pack` | Complete audit pack for any entity | MoE inspections, LBMA audits, internal reviews |
| `/moe-readiness` | 25-item MOE inspection readiness | Pre-inspection preparation |
| `/traceability` | Regulatory traceability matrix | Map every requirement to code + test + evidence |
| `/timeline` | Entity compliance history | Reconstruct chronological audit trail |
| `/filing-compliance` | Filing deadline compliance | Prove all STR/CTR/CNMR filed on time |
| `/kpi-report` | 30-KPI DPMS compliance report | Quarterly/annual MoE, EOCN, FIU reporting |
| `/multi-agent-screen` | Parallel multi-agent sanctions screening | High-volume screening, full-list coverage across all sanctions lists |
| `/agent-orchestrate` | Multi-agent compliance workflow orchestrator | Complex CDD/EDD/STR workflows using PEER pattern |
| `/agent-review` | Multi-agent compliance code review | PR review with parallel specialist agents (regulatory, security, audit, architecture) |
| AI Governance agent | EU AI Act + NIST AI RMF + ISO/IEC 42001 + UAE AI audit | Self-audit of the analyzer itself or customer AI audits. Invoke via `ComplianceHarness.runAiGovernanceAudit({ mode: 'self' \| 'customer', ... })` or directly via `runAiGovernanceAgent()` — src/agents/definitions/ai-governance-agent.ts |

## Integrated Agent Frameworks

The following multi-agent frameworks are vendored for reference and integration patterns:

| Framework | Location | Key Pattern | Relevance |
|-----------|----------|-------------|-----------|
| OpenAI Agents SDK | `vendor/openai-agents-python` | Handoffs + Guardrails | Four-eyes approval workflows |
| Microsoft Agent Framework | `vendor/microsoft-agent-framework` | Graph orchestration + time-travel | Audit trail with state replay |
| open-multi-agent | `vendor/open-multi-agent` | DAG task decomposition | Parallel screening pipelines |
| agentUniverse | `vendor/agentUniverse` | PEER/DOE patterns | CDD review workflows |
| ChatDev | `vendor/ChatDev` | DAG + RL orchestrator | Complex multi-stage compliance pipelines |
| OpenMAIC | `vendor/OpenMAIC` | LangGraph director | Interactive compliance training |
| oh-my-claudecode | `vendor/oh-my-claudecode` | Staged pipeline + model routing | Development workflow optimization |

| multi-agent-shogun | `vendor/multi-agent-shogun` | Hierarchical command chain | Parallel task execution via tmux |
| everything-claude-code | `vendor/everything-claude-code` | AgentShield security pipeline | Red-team/blue-team code review |
| wshobson agents | `vendor/wshobson-agents` | Plugin marketplace + model tiering | Cost-optimized agent routing |
| claude-code-system-prompts | `vendor/claude-code-system-prompts` | Prompt architecture reference | Sub-agent delegation patterns |
| claude-seo | `vendor/claude-seo` | Parallel subagent audits | Concurrent multi-domain analysis |
| quant-trading | `vendor/quant-trading` | Quantitative trading strategies | Transaction pattern analysis, market risk assessment |
| Google AutoML | `vendor/google-automl` | Automated ML model selection | Risk model optimization, anomaly detection tuning |
| friday-tony-stark-demo | `vendor/friday-tony-stark-demo` | FastMCP server + LiveKit voice pipeline (SSE) | Voice-driven compliance officer assistant; MCP tool server pattern for STR/screening queries |
| fastapi | `vendor/fastapi` | Async Python web framework with OpenAPI | Reference for MCP server patterns + backend microservices (FastMCP is built on FastAPI) |
| airflow | `vendor/airflow` | DAG-based workflow orchestrator | Scheduled compliance pipeline reference (CDD renewals, sanctions list refresh, KPI rollups) |
| tooljet | `vendor/tooljet` | Low-code internal tools builder | Reference for rapid MLRO ops dashboards without hand-writing React; component library + query builder patterns |
| xyflow | `vendor/xyflow` | React node-based flow library (formerly react-flow) | DIRECT VISUALISATION of reasoningChain DAGs in the UI; used by the NORAD war room for interactive decision-path inspection |
| supersonic | `vendor/supersonic` | AI-native NL→SQL BI engine | Reference for extending nlComplianceQuery DSL to richer analytics; inspiration for entity→metric mapping |
| bolt | `vendor/bolt` | JavaScript monorepo manager (archived 2019) | Reference only — archived; kept for historical monorepo workflow patterns |
| dr-claw | `vendor/dr-claw` | OpenLAIR defensive AI tooling | Reference for defensive AI patterns; relevance TBD, added for review |
| skill-vault | `vendor/skill-vault` | Zero-dep skill organizer + 13-point security analyzer | Reference for skill curation, security rubric, and Vault Master agent pattern; informs how we audit future additions to `skills/` and `.agents/skills/` for supply-chain risk |
| ruflo | `vendor/ruflo` | Enterprise multi-agent orchestration (100+ agents, Raft/Byzantine/Gossip consensus, RuVector self-learning, 310+ MCP tools) | Reference architecture for scaling our compliance agent swarms; RuVector vector-memory pattern for recall of successful CDD/EDD decision paths; multi-provider cost-based routing complements our Sonnet/Opus advisor strategy. Formerly Claude Flow. |
| claudesidian | `vendor/claudesidian` | Pre-configured Obsidian vault + Claude Code thinking-partner skills (PARA folders, `/init-bootstrap`) | Reference vault layout for MLRO research notebooks and incident post-mortems; complements our existing `graphify-obsidian-setup.md` workflow; skills pattern (`thinking-partner`, `research-assistant`, `inbox-processor`) informs future additions to `skills/`. |
| claude-mem | `vendor/claude-mem` | Claude Code persistent memory plugin — auto-captures tool usage, compresses observations, injects context on session restart (TypeScript, Bun, SQLite + Chroma vector search) | Reference for Phase 3 self-evolving hook storage: demonstrates progressive-disclosure retrieval (compact index → timeline → full details) which could reduce the cost of brain-lessons at scale; also informs the compliance-analyzer audit-trail replay pattern (MLRO session reconstruction). |
| MiroFish | `vendor/MiroFish` | Multi-agent simulation / prediction engine — Python + Vue + Zep Cloud memory + GraphRAG knowledge representation | Reference for agent-behaviour sandboxing (policy-change dry-run before production deploy) and GraphRAG as an alternative to our xyflow reasoningChain visualisation when the agent count grows beyond ~40 nodes. |
| Multi-Agent-AI-System | `vendor/multi-agent-ai-system` | LangGraph + LangSmith customer-support workflow — supervisor + specialist sub-agents + short/long-term memory + human-in-the-loop + full tracing | Reference for the four-eyes approval + MLRO override patterns: demonstrates explicit state-management, LangSmith-style execution tracing, and human-gated handoffs that directly map to our `src/agents/orchestration/` engine and the Phase 5 AI Governance agent's self-audit pattern. |
| oca-reporting-engine | `vendor/oca-reporting-engine` | 32 Odoo community addons for advanced reporting (report_xlsx, report_py3o, bi_sql_editor, report_csv, report_qweb_*, base_comment_template, pdf_xml_attachment, report_layout_config) | Reference for multi-format export pipelines (XLSX, ODT/DOCX via py3o, CSV), template-driven document generation (QWeb + base_comment_template Mako), BI layer abstraction (bi_sql_editor materialised/normal SQL views), scheduled report execution, and PDF post-processing (watermarks, covers, encryption). Patterns inform `xlsxReportExporter.ts`, `reportTemplateEngine.ts`, and `scheduledComplianceReports.ts`. |
| claude-token-efficient | `vendor/claude-token-efficient` | Minimal CLAUDE.md rule sets that cut Claude's output verbosity (universal + coding/agents/analysis/benchmark profiles + three versioned configs J-v5/K-v6/M-v8). Independent benchmark: -17.4% cost vs C-structured baseline on coding challenges. | Source of truth for the "Token-Efficient Output Rules" section below. Profiles inform future per-skill output styles (e.g. `/kpi-report` can adopt the analysis profile, `/agent-orchestrate` the agents profile). Do NOT copy its `.claude/settings.json` PreCompact hook — it uses `--no-verify` which §9 forbids. |
| SwiftGuide | `vendor/SwiftGuide` | Curated index of Swift/iOS featured projects + weekly digests (ipader/SwiftGuide, markdown-heavy). Not code to integrate — a reading list. | Off-scope for the JS/TS compliance-analyzer core. Kept as a reference library only. If we ever ship a native iOS MLRO companion app or a Swift-based DPMS ingestion tool (neither currently planned), this is where to start looking for vetted libraries. Until then, do not read it in normal sessions — it is a context budget sink per §7. |

## Token-Efficient Output Rules

These rules apply to all Claude output on this project. They complement
(but do not replace) the "Token-Efficient Workflow" section at the top,
which governs *context reads*. This section governs *output writes*.

Source: `vendor/claude-token-efficient` (drona23/claude-token-efficient, MIT).

### Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Skip files over 100KB unless explicitly required (reinforces §7 context budget).
- No sycophantic openers or closing fluff. No "Great question!", "Absolutely!", "I hope this helps!".
- Keep solutions simple and direct. No speculative abstractions. No "you might also want…".
- State the bug. Show the fix. Stop.
- If a cause is unclear: say so. Do not guess.
- When reverting a workaround, keep a stripped-down diagnostic log so the underlying condition stays observable. A silent `null` is worse than a logged one. (Source: claude bot review on thedotmack/claude-mem#1850 — applies to all revert PRs on this project.)
- User instructions always override these rules.

### Formatting
- No em dashes, smart quotes, or decorative Unicode symbols in prose.
- Plain hyphens and straight quotes only.
- Code output must be copy-paste safe.
- Natural-language characters (accented letters, CJK, Arabic for UAE content) are fine when the content requires them.

### Compliance Carve-Outs (non-negotiable)

Terse output never overrides regulatory content. The following MUST remain
verbose and fully cited even when terse rules apply:

- STR / SAR / CTR / DPMSR / CNMR narrative drafting (FDL Art.26-27).
- Sanctions-match rationale and freeze justification (Cabinet Res 74/2020 Art.4-7).
- Four-eyes approval reasoning and MLRO override explanations.
- Commit messages touching compliance logic — full citation required per §8.
- PR descriptions for regulatory changes — full article/circular references required.
- AI Governance audit outputs (EU AI Act, NIST AI RMF, ISO/IEC 42001, UAE AI audit).

Rule of thumb: compress *how* you explain your own work; never compress
*what* the regulation says or *why* a decision was made.

## Hooks

- **session-start**: Auto-updates code-review-graph on every new session
- **pre-commit-security**: Blocks commits with hardcoded secrets, eval(), or unsafe patterns

---

# Claude Code Harness Patterns

Workflow rules for operating Claude Code effectively on this project.
Complements the "Token-Efficient Workflow" section at the top.

## 1. Model Routing: Worker + Advisor (Anthropic Advisor Strategy)

Pair a fast executor model with a higher-intelligence advisor model.
This project implements the pattern from Anthropic's engineering post
[The advisor strategy: Give Sonnet an intelligence boost with Opus](https://claude.com/blog/the-advisor-strategy)
and the formal API reference at
[platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool).

**How it works at the API level (not just prompting):**
- Beta header: `anthropic-beta: advisor-tool-2026-03-01`
- Tool type:   `advisor_20260301`
- Valid pairs: `claude-sonnet-4-6 → claude-opus-4-6`,
               `claude-haiku-4-5-20251001 → claude-opus-4-6`,
               `claude-opus-4-6 → claude-opus-4-6`
- The executor model runs the task. When it calls the advisor tool,
  Anthropic runs a **server-side sub-inference** on the advisor model
  with the full transcript, returns ~400-700 text tokens of advice
  back to the executor, and the executor continues. All in a single
  `/v1/messages` request — no client round-trips.

**Project plumbing (live on `main` as of this commit):**
- **`src/services/advisorStrategy.ts`** — browser-safe TypeScript
  module that builds advisor-enabled API request bodies, validates
  executor/advisor pairs locally (fail-fast before the round trip),
  and parses the response. Exposes `buildAdvisorRequest()`,
  `parseAdvisorResponse()`, `callAdvisorAssisted()`.
- **`netlify/functions/ai-proxy.mts`** — forwards allowlisted betas
  (currently only `advisor-tool-2026-03-01`) as the `anthropic-beta`
  header. Anything not in the allowlist is silently dropped.
- **`COMPLIANCE_ADVISOR_SYSTEM_PROMPT`** — exported from
  `advisorStrategy.ts`. Adapts Anthropic's suggested timing block
  verbatim and adds six mandatory compliance escalation triggers.

**Compliance escalation triggers (hard-coded into the system prompt):**
1. Sanctions match confidence ≥ 0.5 (FDL Art.20, Cabinet Res 74/2020 Art.4-7)
2. Threshold edge cases (AED 55K CTR, AED 60K cross-border, 25% UBO)
3. STR / SAR / CTR / DPMSR / CNMR narrative drafting (FDL Art.26-27)
4. Verdicts of "freeze" or "escalate"
5. CDD level changes (SDD → CDD → EDD)
6. Any decision visible to the subject — never tip off (FDL Art.29)

**Who runs what, in practice:**
- **Executor (Sonnet 4.6 or Haiku 4.5)** — runs every step. Handles
  targeted file edits, lint/type fixes, test runs, renames, doc
  updates, single-file refactors, dependency bumps.
- **Advisor (Opus 4.6)** — called automatically by the executor when
  one of the six triggers fires, or when the executor is stuck. Never
  calls tools and never produces user-facing output — it only returns
  advice text (under 100 words, enumerated steps per the conciseness
  directive that cuts advisor output by 35-45%).

**Composition with the Weaponized Brain:**
The compliance decision path layers on top of this:
`src/services/weaponizedBrain.ts` calls `runMegaBrain()` (13 subsystems)
and then wires in 6 more (adverse media, UBO + layering + shell
company, VASP wallets, transaction anomalies, explainable scoring,
zk-proof audit seal) plus new safety clamps. The *reasoning* about
edge cases in those subsystems is where the advisor strategy adds the
most value — the mechanical subsystem calls stay on Sonnet, but the
MLRO-facing verdict rationale can escalate to Opus when confidence is
low or a clamp fires.

Rule of thumb: ~80% of runs stay on Sonnet. Opus fires for the tough
calls only — see `vendor/wshobson-agents` for the model-tiering
reference pattern.

## 2. Subagents for Side Tasks

Spawn a subagent via the Task/Agent tool whenever the research would clutter
the main conversation. The subagent returns a summary — its raw file reads
and grep output stay out of the parent context.

**Good subagent tasks on this project:**
- "Find every place a regulatory threshold is hardcoded instead of imported from `src/domain/constants.ts`."
- "Audit all `netlify/functions/*.mts` for missing rate limiting middleware."
- "Search the vendored frameworks for handoff + guardrail patterns we could adopt for four-eyes approval."
- "Check which skills in `skills/` lack an up-to-date `SKILL.md`."
- "Survey `compliance-suite.js` for functions >100 lines that are candidates for extraction."

Rule of thumb: if the answer needs >10 file reads or >5 grep calls, delegate
to a subagent. Don't delegate understanding — always write the fix yourself
once the subagent reports back.

## 3. Agent Teams for Parallel Work

When the work genuinely fans out, launch multiple subagents in a **single
message** so they run concurrently.

**Parallel layouts that fit this project:**
- **PR review fan-out**: regulatory-review agent + security-review agent +
  architecture-review agent, all reading the same diff in parallel
  (mirrors `/agent-review` skill).
- **Multi-list sanctions screening**: UN, OFAC, EU, UK, UAE, and EOCN as five
  parallel screening agents (mirrors `/multi-agent-screen` skill).
- **Quality gate**: `vitest run`, `tsc --noEmit`, and `eslint` as three
  independent check agents before a commit.

Never use parallel agents for sequential work where agent B needs agent A's
output — that produces wrong results. Parallelise only when the tasks are
truly independent.

## 4. Plan Mode Before Complex Changes

Before editing anything non-trivial, ask Claude to plan first (via the Plan
agent type or the `/plan` skill). The plan should:

1. Map the full approach — which files, in which order, with which tests.
2. Report the blast radius via `get_impact_radius`.
3. List the risks (regulatory, security, migration, downstream).
4. Get user approval on the plan.
5. Only then implement.

**Always plan first for:**
- Anything touching `src/domain/constants.ts` or `tests/constants.test.ts`.
- New compliance skills, agents, or orchestration workflows.
- Changes to STR / CNMR / EOCN filing logic or deadlines.
- Database schema / migration changes.
- New `netlify/functions/*.mts` endpoints (rate limiting + auth + CSP impact).
- Multi-file refactors that cross `src/` domain boundaries.

**Skip planning for** single-line fixes, typos, doc updates, dependency
bumps, and obvious lint/type repairs.

## 5. How the Four Patterns Compose

A well-run session on this repo typically looks like:

```
1. User asks for a non-trivial change
2. Claude (Sonnet worker) runs /plan → proposes approach
3. User approves the plan
4. Claude fans out subagents for parallel research (impact radius,
   test coverage, regulatory citations)
5. Claude (Sonnet) implements the change
6. If the worker gets stuck on a subtle call, escalate to Opus advisor
7. Claude fans out a parallel quality gate (tests + types + lint)
8. Claude commits + pushes on the designated branch
```

The goal: high-quality regulatory code without burning Opus budget on
steps Sonnet can handle, and without losing context by delegating
understanding to subagents.

## 6. Skill Dispatch Table

The project ships **17+ custom skills** that encode the correct sequence
for every common compliance task. Before planning a bespoke solution,
check whether a skill already exists for the request. Never re-derive a
skill's workflow by hand — invoke the skill.

| User asks about…                                  | Invoke first                       |
|---------------------------------------------------|------------------------------------|
| "review this PR" / "safe to merge?"               | `/review-pr`                       |
| "new customer onboarding"                         | `/onboard` → `/screen`             |
| "sanctions hit" / "asset freeze"                  | `/incident` → `/goaml`             |
| "quarterly / annual MoE report"                   | `/kpi-report`                      |
| "can we ship?" / pre-deploy                       | `/deploy-check`                    |
| "new law" / "new circular"                        | `/regulatory-update`               |
| "MoE inspection coming"                           | `/moe-readiness` → `/audit-pack`   |
| "prove filing X was on time"                      | `/filing-compliance`               |
| "entity Y history / timeline"                     | `/timeline`                        |
| "map Article Z to code + test"                    | `/traceability`                    |
| "bulk / parallel sanctions screening"             | `/multi-agent-screen`              |
| "complex multi-stage CDD / EDD workflow"          | `/agent-orchestrate`               |
| "quarterly compliance audit"                      | `/audit`                           |
| "STR / SAR / CTR / DPMSR / CNMR submission"       | `/goaml`                           |
| "generate goAML XML"                              | `/goaml`                           |
| "multi-agent PR review"                           | `/agent-review`                    |
| "full audit pack for inspection"                  | `/audit-pack`                      |

If the ask doesn't match any skill, fall back to §1 (model routing) and
§4 (plan-first).

## 7. Context Budget Rules

Specific landmines in this repo that will blow your context window if
read blindly. The "graph first, files second" rule at the top of
CLAUDE.md applies — these are its teeth.

- **`compliance-suite.js` is 4300+ lines.** Never read it without
  `offset` + `limit`. Query `code-review-graph` first for line numbers,
  then read a ~50-line window around the hit.
- **`index.html` is 2794 lines** with inline scripts and styles. Grep
  for the element ID or selector first, then `Read` with `offset`.
- **`vendor/**` has 49k+ files.** Never grep the tree without a
  `--glob` restrictor. Scope searches to a single vendor directory.
- **`graphify-out/**` and `package-lock.json`** — do not read unless
  debugging graph drift or lockfile drift specifically. They're
  generated artefacts.
- **`node_modules/**`** — never read. Use published types or the
  library's source on npm.
- **Test files** — when diagnosing a failing test, read only the
  failing test block (offset + limit), not the whole file.

**Budget target: a single file read should not exceed 200 lines** in
normal operation. If you need more, query the graph for the specific
function and read that neighborhood.

## 8. Regulatory Citation Discipline

Every commit and PR that touches compliance logic **must cite the
Article, Circular, or Guidance section** it implements. This is
non-negotiable — it's the audit trail that proves the code traces to a
regulation, which is exactly what MoE, LBMA, and internal audit want to
see.

**Commit message format:**

```
<short summary> (<regulatory citation>)

<body explaining what changed and why>
```

**Examples:**

```
Good:  Add 24h freeze countdown for confirmed sanctions matches
       (Cabinet Res 74/2020 Art.4-7)

Good:  Enforce AED 55K DPMS CTR threshold on cash transactions
       (MoE Circular 08/AML/2021)

Good:  Raise UBO re-verification deadline to 15 working days
       (Cabinet Decision 109/2023)

Bad:   Add countdown timer
Bad:   Fix threshold
Bad:   Update UBO logic
```

The full citation list lives in the "Regulatory Domain Knowledge"
section of this file — copy the exact wording into commit messages.
PRs must also include the citation in their description.

**Scope:** applies to any change in `src/domain/`, `src/services/`,
`src/risk/`, `src/agents/tools/`, `compliance-suite.js`, and
`netlify/functions/`. Pure UI, lint, and doc changes are exempt.

## 9. Error Recovery Playbook

Common failure modes on this repo and the first thing to check. Do not
guess, do not retry blindly, do not bypass — consult this table.

| Failure                                          | First check                                                                              |
|--------------------------------------------------|------------------------------------------------------------------------------------------|
| Netlify secrets scan fails                       | Is the offending path in `SECRETS_SCAN_OMIT_PATHS` in `netlify.toml`?                     |
| `pre-commit-security` hook blocks commit         | Real secret or placeholder? Never use `--no-verify`. Add to `.secretsignore` if FP.       |
| `vitest` ESM import errors                       | `package.json` has `"type": "module"`? Is the import extension `.js` in runtime imports?  |
| `tsc` fails only on `tests/constants.test.ts`    | You changed a regulatory constant. Regulation actually updated? Bump REG constant version. |
| `eslint` fails in `src/agents/`                  | New agent added without export from `src/agents/index.ts`?                               |
| Netlify build works locally, fails on deploy     | Node version mismatch in `netlify.toml` vs local? Submodules initialised?                 |
| `cannot find module vendor/xxx`                  | Run `git submodule update --init --recursive`.                                            |
| `goAML` XML validation fails                     | Use `/goaml` skill — never hand-write XML. Validate via `src/utils/goamlValidator.ts`.    |
| `businessDays` calculation off by one            | You used calendar days somewhere. Use `src/utils/businessDays.ts` exclusively.            |
| Sanctions screen returns empty                   | One of the lists (UN/OFAC/EU/UK/UAE/EOCN) was skipped. Never skip a list.                |
| Netlify build fails on inline script CSP hash    | Inline script changed → regenerate the sha256 hash and update CSP in `netlify.toml`.     |

**Golden rule:** if a hook, test, or check fails, treat it as
information — not an obstacle. Understand the failure before acting.
Never use destructive shortcuts (`--no-verify`, `reset --hard`,
`push --force`) to silence a failing check.

## 10. Read-Only vs Write Subagent Discipline

Every subagent prompt **must open** with one of two contracts so the
blast radius is explicit before the subagent starts work.

### Read-only subagent (default)

```
READ-ONLY: do not edit, write, create, or delete any files. Do not
run git commands that mutate state. Report findings as a written
summary only.

<task description>
```

Use for: research, audits, surveys, impact analysis, grep/glob
exploration, reading through vendored frameworks.

### Write-mode subagent (rare)

```
WRITE MODE: you may edit files under <specific path>. Do not create
new files outside <specific path>. Do not run git commit, git push,
or git branch. Do not modify CLAUDE.md or constants.ts.

<task description>
```

Use for: targeted refactors scoped to one directory, test generation,
lint fixes. Never for anything touching regulatory logic.

### Never delegate

- `git commit`, `git push`, `git merge`, `git rebase`
- Changes to `src/domain/constants.ts`
- Changes to `CLAUDE.md`
- Changes to `netlify.toml`, `package.json`, `.env*`
- Any compliance decision (sanctions confirmation, STR filing, freeze)
- Any change you don't fully understand yourself

The main agent owns decisions and commits. Subagents do the grunt work.

## 11. Session-Start Checklist

The first action in every new session is a parallel status dump. Catches
90% of "wrong branch", "stashed work", "someone merged while I was away"
problems.

Run in a **single message with parallel tool calls**:

```
├── git status                        (uncommitted work?)
├── git branch --show-current         (on the designated branch?)
├── git log --oneline -5 origin/main  (what shipped while I was away?)
├── git stash list                    (any stashed work?)
└── git fetch origin                  (pick up remote changes)
```

Only after these return should you read the user's actual ask. If
anything surprising comes back (uncommitted files, wrong branch, unknown
commits on main), **ask the user before doing anything**. Do not
auto-resolve unexpected state — investigate first.

**Exceptions:** single-turn trivial asks ("what does X mean?", "fix this
typo") can skip the checklist. Apply it for any session that will touch
code.
