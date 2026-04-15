# HAWKEYE STERLING V2

> UAE AML / CFT / CPF compliance analyzer for DPMS operators.
> Brain-driven, four-eyes-gated, audit-sealed.

This directory is the **bootstrap pack** for starting a fresh Claude
Code or claude.ai project named **HAWKEYE STERLING V2**. Drop the
files in this directory into a new project to give Claude full
context on the brain architecture, regulatory coverage, endpoints,
and operator workflow — without re-onboarding from scratch.

---

## What ships in this pack

| File | Purpose |
|---|---|
| `README.md` | This overview. |
| `CLAUDE.md` | Project instructions for Claude Code (token-efficient workflow + regulatory rules + skill dispatch). |
| `ARCHITECTURE.md` | Brain subsystem map (60+), endpoint topology, blob layout. |
| `ENDPOINTS.md` | Full API reference for every `/api/brain/*` endpoint with curl examples. |
| `BRAIN_INVENTORY.md` | Per-subsystem one-liners with regulatory anchors. |
| `REGULATORY_MATRIX.md` | Every regulation cited in the codebase mapped to source files + tests. |
| `SKILLS.md` | All custom skills (`/review-pr`, `/onboard`, `/incident`, `/goaml`, etc.). |
| `TIER_C_GUIDE.md` | Tier C safe equivalents (clamp suggestions, deferred outbound queue, break-glass, zk cross-tenant). |
| `ASANA_INTEGRATION.md` | Orchestrator façade + dispatch adapters + retry queue. |
| `DEPLOY_CHECKLIST.md` | Netlify env vars, blob stores, CSP, secrets, hooks, branch protection. |

---

## Stack

- **Frontend:** vanilla TypeScript + React (TSX) + a single `index.html` SPA shell (~10k lines).
- **Backend:** Netlify Functions (`.mts` / Node 18+).
- **Storage:** Netlify Blobs (`brain-memory` store) for telemetry, replay, evidence, Tier C audit logs.
- **AI:** Anthropic Advisor strategy (Sonnet 4.6 worker → Opus 4.6 advisor on the six mandatory triggers).
- **Tests:** vitest (3150 + tests on `main` at session close).
- **Compliance scope:** UAE FDL No.10/2025, Cabinet Res 134/2025, 74/2020, 156/2025, 109/2023, 71/2024; MoE Circular 08/AML/2021; LBMA RGG v9; FATF Rec 1/2/6/10/11/19/20/22/23; NIST AI RMF 1.0; EU AI Act Art.14/15; EU GDPR Art.25.

---

## How to use this pack in a new Claude project

1. Create a new project on claude.ai or in Claude Code:
   ```
   Project name:   HAWKEYE STERLING V2
   Description:    UAE AML/CFT/CPF compliance brain — production
                   port of the original analyzer with Tier A/B/C
                   subsystems, Brain Console UI, and Asana
                   orchestration.
   ```

2. Copy `CLAUDE.md` to the project root. It is the single source
   of truth for token-efficient workflow + regulatory rules.

3. Upload the rest of the files in this directory as project
   knowledge / context attachments. They are all plain markdown
   so any text editor (Notepad, VS Code, TextEdit) opens them.

4. First message to Claude in the new project:
   ```
   Read README.md, then ARCHITECTURE.md, then BRAIN_INVENTORY.md.
   I am porting Hawkeye Sterling to a fresh repo. The brain has
   60+ subsystems, 11 Netlify endpoints, and 17 custom skills.
   Tell me the recommended directory layout for the v2 monorepo
   before I start moving files.
   ```

5. Claude has full context — no warm-up, no rediscovery.

---

## What is "weaponized" about the brain

The brain is not a single LLM call. It is a deterministic
pipeline of 60+ subsystems that each fire on different input
signals, then a final clamp step that locks the verdict to a
defensible regulatory ladder. See `BRAIN_INVENTORY.md` for the
full list. Highlights:

- **MegaBrain** (13 core subsystems) — base scoring + clamps.
- **Phase extensions** (30+) — adverse media, UBO layering, shell
  company detection, VASP wallets, transaction anomalies,
  explainable scoring, zk seal.
- **Tier A** — telemetry store, name-variant expander, case
  replay, evidence bundle, uncertainty intervals.
- **Tier B** — adversarial debate, auto-remediation, transaction
  graph embedding.
- **Tier C** (safe equivalents) — clamp suggestion log,
  deferred outbound queue, break-glass override, zk cross-tenant
  attestation.

Every subsystem cites its regulatory basis in code. Every test
passes on `main`. No federated learning, no auto-tuning of
regulatory thresholds, no auto-send of customer-visible
messages — those are deliberate liability gates, not gaps.

---

## Source repo

`https://github.com/trex0092/compliance-analyzer`
All work lands on `main`. No long-lived feature branches.
