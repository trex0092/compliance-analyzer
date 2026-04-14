# HAWKEYE STERLING V2 — Project Instructions for Claude Code

## Token-Efficient Workflow

### Rule 1: Graph First, Files Second
- ALWAYS start with the architecture doc + brain inventory before opening source files.
- Use targeted reads with `offset` + `limit` for large files (`compliance-suite.js`, `index.html`).
- Only read a file when you need to edit it or the docs do not have enough detail.

### Rule 2: Targeted Reads
- Never read a full file to understand structure. Use the inventory.
- `compliance-suite.js` and `index.html` are 4k+ and 10k+ lines — never read them whole.

### Rule 3: Change Reviews
- Risk-score changes before reviewing.
- Focus effort on high-risk; low-risk changes need minimal attention.

---

## Regulatory Domain Knowledge

Apply these UAE AML/CFT/CPF requirements automatically. Every feature
must cite its regulatory basis in code AND the commit message.

### Key Legislation

| Law / Resolution | Scope | Key Articles |
|---|---|---|
| FDL No.10/2025 | UAE AML/CFT/CPF Law | Art.12-14 (CDD), Art.15-16 (thresholds), Art.17 (cross-border), Art.20-21 (CO duties), Art.24 (10yr retention), Art.26-27 (STR filing), Art.29 (no tipping off), Art.35 (TFS) |
| Cabinet Res 134/2025 | Implementing Regulations | Art.5 (risk appetite), Art.7-10 (CDD tiers), Art.12-14 (PEP/EDD/four-eyes), Art.16 (cross-border), Art.18 (CO change), Art.19 (internal review) |
| Cabinet Res 74/2020 | TFS / Asset Freeze | Art.4-7 (24h freeze, EOCN notify, CNMR within 5 BD) |
| Cabinet Res 156/2025 | PF & Dual-Use Controls | PF risk assessment, strategic goods screening |
| Cabinet Decision 109/2023 | UBO Register | Beneficial ownership >25%, re-verify within 15 working days |
| Cabinet Res 71/2024 | Administrative Penalties | AED 10K-100M penalty range |
| MoE Circular 08/AML/2021 | DPMS Sector | goAML registration, quarterly reports, AED 55K threshold |
| LBMA RGG v9 | Responsible Gold | 5-step framework, CAHRA due diligence, annual audit |
| UAE MoE RSG | Responsible Sourcing of Gold | Origin traceability, refiner DD, ASM compliance |
| Dubai Good Delivery (DGD) | Dubai gold standard | Refiner accreditation, hallmark, assay |
| FATF Rec 1/2/6/10/11/19/20/22/23 | International standard | Risk-based + UBO + DPMS + CDD + monitoring |
| NIST AI RMF 1.0 | AI risk framework | GOVERN-3/4, MEASURE-2/4, MANAGE-2/3 |
| EU AI Act | High-risk AI rules | Art.14 (oversight), Art.15 (accuracy + robustness) |
| EU GDPR | Data protection | Art.25 (data minimisation) |

### Critical Thresholds

- **AED 55,000**: DPMS cash CTR threshold (MoE Circular 08/AML/2021)
- **AED 60,000**: Cross-border cash / BNI declaration (FDL Art.17)
- **25%**: UBO beneficial ownership (Cabinet Decision 109/2023)
- **24 hours**: EOCN freeze deadline (Cabinet Res 74/2020 Art.4)
- **5 business days**: CNMR filing to EOCN (Cabinet Res 74/2020 Art.6)
- **10 business days**: STR filing (FDL Art.26-27)
- **15 working days**: UBO re-verification (Cabinet Decision 109/2023)
- **10 years**: Record retention minimum (FDL Art.24)
- **30 days**: Policy update deadline after new MoE circular

### Coding Rules

1. Sanctions screening MUST check ALL six lists (UN, OFAC, EU, UK, UAE, EOCN).
2. STR workflow MUST never expose status to the subject (FDL Art.29).
3. Audit trail MUST log every compliance action with timestamp + user + action.
4. Four-eyes MUST gate every high-risk decision (Cabinet Res 134/2025 Art.12-14).
5. Risk scoring uses likelihood × impact + jurisdiction / PEP / cash multipliers.
6. Date format: `dd/mm/yyyy` for UAE compliance documents.
7. Currency: AED primary, CBUAE rates for conversion (never hardcoded).
8. goAML exports MUST conform to UAE FIU XML schema.

### Decision Trees

#### Money / amounts → constants check
```
Threshold value involved?
├── YES → Imported from src/domain/constants.ts?
│   ├── YES → Safe to proceed
│   └── NO → STOP. Refactor. Never hardcode.
└── NO → Proceed.
```

#### Sanctions match
```
Confidence ≥ 0.9 (confirmed)?
├── YES → FREEZE
│   ├── 24h EOCN countdown
│   ├── CNMR within 5 BD
│   └── DO NOT notify subject (Art.29)
├── 0.5-0.89 → Escalate to CO
│   └── CO decides: confirm → FREEZE / false positive → document
└── < 0.5 → Log + dismiss
```

#### Filing deadline
```
Use src/utils/businessDays.ts — NEVER calendar days.
├── STR/SAR    → 10 BD
├── CTR/DPMSR  → 15 BD
├── CNMR       → 5 BD
└── EOCN freeze → 24 clock hours (NOT business days)
```

---

## Constants Architecture

ALL regulatory values live in `src/domain/constants.ts`. Single source
of truth. When a regulation changes:

1. Update the constant.
2. Update `tests/constants.test.ts`.
3. Bump `REGULATORY_CONSTANTS_VERSION`.
4. Run `/regulatory-update` skill for impact analysis.

---

## Custom Skills

| Skill | When |
|---|---|
| `/review-pr` | Before merging any PR |
| `/audit` | Compliance audit / quarterly review |
| `/screen` | Customer onboarding + periodic re-screening |
| `/goaml` | STR/SAR/CTR/DPMSR/CNMR submission |
| `/onboard` | New customer / counterparty setup |
| `/incident` | Sanctions match, STR trigger, asset freeze |
| `/deploy-check` | Pre-production push |
| `/regulatory-update` | New law / circular / list |
| `/audit-pack` | MoE / LBMA / internal review |
| `/moe-readiness` | 25-item MoE inspection prep |
| `/traceability` | Map regulation to code + test + evidence |
| `/timeline` | Entity compliance history |
| `/filing-compliance` | Prove all filings on time |
| `/kpi-report` | 30-KPI DPMS quarterly report |
| `/multi-agent-screen` | Parallel multi-list screening |
| `/agent-orchestrate` | Complex multi-stage CDD/EDD/STR workflow |
| `/agent-review` | Multi-agent compliance code review |
| `/caveman` | Token-efficient terse mode |

---

## Hooks

- **session-start** — auto-updates code-review-graph on every new session.
- **pre-commit-security** — blocks commits with hardcoded secrets, eval(), unsafe patterns.

---

## Model Routing — Worker + Advisor

- **Worker:** Sonnet 4.6 (or Haiku 4.5) — handles 80% of runs.
- **Advisor:** Opus 4.6 — fires automatically on six MANDATORY triggers:
  1. Sanctions match score ≥ 0.5
  2. Threshold edge cases (AED 55K, AED 60K, 25% UBO)
  3. STR / SAR / CTR / DPMSR / CNMR narrative drafting
  4. Verdict = freeze or escalate
  5. CDD level changes (SDD → CDD → EDD)
  6. Any decision visible to the subject (FDL Art.29)

Implementation: `src/services/advisorStrategy.ts` + Anthropic
beta header `anthropic-beta: advisor-tool-2026-03-01`.

---

## Subagents

- **Read-only by default.** Subagent prompt MUST open with
  `READ-ONLY: do not edit, write, create, or delete any files.`
- **Write mode is rare.** Scoped to one path. Never delegates
  git commits, regulation changes, or compliance decisions.
- **Never delegate:** `git commit/push/merge`, changes to
  `src/domain/constants.ts`, `CLAUDE.md`, `netlify.toml`,
  `package.json`, `.env*`, sanctions confirmations, STR filings.

---

## Regulatory Citation Discipline

Every commit to `src/domain/`, `src/services/`, `src/risk/`,
`src/agents/tools/`, `compliance-suite.js`, or `netlify/functions/`
MUST cite Article / Circular / Guidance section in:

```
<short summary> (<regulatory citation>)

<body explaining what changed and why>
```

Pure UI / lint / doc changes are exempt.

---

## Error Recovery — first checks

| Failure | First check |
|---|---|
| Netlify secrets scan fails | Path in `SECRETS_SCAN_OMIT_PATHS`? |
| pre-commit-security blocks | Real secret or placeholder? Never `--no-verify`. |
| vitest ESM import errors | `package.json` has `"type": "module"`? |
| tsc fails on `tests/constants.test.ts` | You changed a regulatory constant. Real change? |
| eslint fails in `src/agents/` | New agent missing export from `src/agents/index.ts`? |
| Netlify build local OK, deploy fails | Node version mismatch in `netlify.toml`? Submodules init? |
| `cannot find module vendor/xxx` | `git submodule update --init --recursive`. |
| goAML XML validation fails | Use `/goaml` skill — never hand-write XML. |
| businessDays off by one | Used calendar days. Use `src/utils/businessDays.ts`. |
| Sanctions screen empty | One list skipped. Never skip a list. |
| Inline-script CSP hash mismatch | Regenerate sha256 + update CSP in `netlify.toml`. |

---

## Golden Rules

1. If a hook / test / check fails → understand it before acting. Never use destructive shortcuts to silence a failing check.
2. Always plan first for `src/domain/constants.ts`, new endpoints, multi-file refactors crossing domain boundaries.
3. Skip planning for single-line fixes, typos, doc updates, dependency bumps.
4. Read CLAUDE.md before editing CLAUDE.md.
