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
| FDL No.10/2025 | UAE AML/CFT/CPF Law | Art.12-14 (CDD), Art.15-16 (thresholds), Art.20-21 (CO duties), Art.24 (record retention 5yr), Art.26-27 (STR filing), Art.29 (no tipping off), Art.35 (TFS) |
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
- **5 years**: Minimum record retention period
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

## Hooks

- **session-start**: Auto-updates code-review-graph on every new session
- **pre-commit-security**: Blocks commits with hardcoded secrets, eval(), or unsafe patterns
