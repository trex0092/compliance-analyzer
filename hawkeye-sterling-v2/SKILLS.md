# HAWKEYE STERLING V2 — Skills Reference

Custom skills under `skills/`. Each is a self-contained markdown
specification. Invoke with `/<skill-name>` in Claude Code.

Skills encode the correct sequence for common compliance tasks. Never
re-derive a skill's workflow by hand — invoke the skill.

---

## Compliance Skills

| Skill | Purpose | Trigger |
|---|---|---|
| `/review-pr` | Risk-scored PR review with regulatory citation check | Before merging any PR |
| `/audit` | Compliance audit report | Pre-audit prep, quarterly review |
| `/screen` | Sanctions + risk screening (UN, OFAC, EU, UK, UAE, EOCN) | Customer onboarding, periodic re-screening |
| `/goaml` | Generate goAML XML filing (STR/SAR/CTR/DPMSR/CNMR) | FIU submission |
| `/onboard` | Customer onboarding workflow with CDD tier decision | New customer / counterparty setup |
| `/incident` | Incident response with EOCN countdown + CNMR deadline | Sanctions match, STR trigger, asset freeze |
| `/deploy-check` | Pre-deployment verification (lint + tests + types + CSP hash) | Before every production push |
| `/regulatory-update` | Process new regulation with full impact analysis | Law / circular / list change |
| `/audit-pack` | Complete audit pack for any entity | MoE inspection, LBMA audit, internal review |
| `/moe-readiness` | 25-item MoE inspection readiness checklist | Pre-inspection |
| `/traceability` | Map every requirement → code → test → evidence | Audit prep, regulator question |
| `/timeline` | Reconstruct entity compliance history (chronological) | Audit trail, MLRO investigation |
| `/filing-compliance` | Prove all STR / CTR / CNMR filed on time | Filing compliance proof |
| `/kpi-report` | 30-KPI DPMS quarterly / annual report | Quarterly MoE report |
| `/multi-agent-screen` | Parallel multi-agent screening across all lists | High-volume screening, full-list coverage |
| `/agent-orchestrate` | Multi-agent compliance workflow (PEER pattern) | Complex CDD/EDD/STR workflow |
| `/agent-review` | Multi-agent compliance code review (regulatory + security + audit + architecture) | High-stakes PR review |
| `/caveman` | Token-efficient terse mode | When context budget is tight |

## Trading Skills (for transaction monitoring inspiration)

| Skill | Purpose |
|---|---|
| `/arb-scan` | Arbitrage opportunity scanner (pattern detection ref) |
| `/market-briefing` | Market briefing generator |
| `/metals-report` | Gold / silver / platinum market report |
| `/position-size` | Position sizing calculator |
| `/price-alert` | Price alert generator |
| `/risk-check` | Risk check on a trade idea |
| `/trade-journal` | Trade journal entry |
| `/trade-signal` | Trade signal generator |

---

## When to use which skill

```
User says…                           Invoke
─────────────────────────────────────────────────────────────
"review this PR" / "safe to merge?"  /review-pr
"new customer"                       /onboard → /screen
"sanctions hit"                      /incident → /goaml
"asset freeze"                       /incident
"quarterly report"                   /kpi-report
"can we ship?"                       /deploy-check
"new law"                            /regulatory-update
"MoE inspection"                     /moe-readiness → /audit-pack
"prove filing X on time"             /filing-compliance
"entity Y history"                   /timeline
"map Article Z to code"              /traceability
"bulk screening"                     /multi-agent-screen
"complex CDD/EDD"                    /agent-orchestrate
"quarterly audit"                    /audit
"STR / SAR / CTR / DPMSR / CNMR"     /goaml
```

If no skill matches, fall back to the model-routing rule (Sonnet
worker + Opus advisor on the six mandatory triggers — see CLAUDE.md).

---

## Skill structure

Every skill is a markdown file at `skills/<name>/SKILL.md` with this
shape:

```markdown
# /<skill-name>

> One-line description.

## When to invoke
- Trigger 1
- Trigger 2

## Inputs
- arg1: description
- arg2: description

## Steps
1. Step one
2. Step two
3. Step three

## Output
- Field 1
- Field 2

## Regulatory anchor
- FDL Art.X
- Cabinet Res Y/2025 Art.Z
```

Skills are deterministic templates, not LLM prompts. They live in the
repo so they survive model upgrades.

---

## Adding a new skill

1. Create `skills/<new-name>/SKILL.md` with the structure above.
2. Add a row to this file.
3. Add a row to the `## Custom Skills` table in `CLAUDE.md`.
4. If the skill touches compliance logic, cite the Article in the
   SKILL.md regulatory anchor section.
5. Commit with citation per CLAUDE.md §8.

Never delegate skill creation to a subagent — skills are project
contracts and must be authored by the main agent.
