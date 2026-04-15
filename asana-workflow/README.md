# ASANA WORKFLOW — Bootstrap Pack

> Operator-facing automation layer for HAWKEYE STERLING.
> Brain produces verdicts. Asana turns them into work.

This directory is the **bootstrap pack** for setting up the Asana
side of HAWKEYE STERLING in a new claude.ai or Claude Code project.
Drop these markdown files into the project's Files panel to give
Claude full context on the orchestrator, dispatch adapters, retry
queue, SLA enforcement, and four-eyes contract — without re-onboarding.

---

## What ships in this pack

| File | Purpose |
|---|---|
| `README.md` | This overview. |
| `CLAUDE.md` | Project instructions for the Asana workflow Claude project. |
| `ORCHESTRATOR.md` | Façade design, dispatch adapters, idempotency contract. |
| `IDEMPOTENCY.md` | Key shape, store, replay rules, TTL. |
| `RETRY_QUEUE.md` | Backoff, dead letter, drain cron, observability. |
| `WEBHOOKS.md` | Inbound webhook router + comment skill router. |
| `SLA_RULES.md` | Per-section deadlines (24h freeze, 5BD CNMR, 10BD STR) + auto-escalation. |
| `SKILL_REGISTRY.md` | All 47 skill runners + when each fires. |
| `FOUR_EYES.md` | Two-person approval workflow as paired Asana tasks. |
| `SETUP_CHECKLIST.md` | Env vars + workspace + project + section auto-provision. |

---

## Why a separate pack from HAWKEYE STERLING V2?

The brain pack (`hawkeye-sterling-v2/`) covers the brain subsystems,
endpoints, and regulatory anchors. This pack covers **the operator
arm** — how brain verdicts become work on real human queues.

The brain is reasoning. Asana is enforcement. Both must be designed
together but they have distinct concerns and distinct audiences:

- **Brain pack audience:** ML / compliance engineer.
- **Asana pack audience:** MLRO operations + SRE for the dispatch
  pipeline.

Keeping them separate means the operator team can update SLA rules
or four-eyes contracts without re-reading the entire brain
inventory.

---

## How to use this pack

1. Create a new Claude project named `ASANA WORKFLOW` (or attach to
   the existing `HAWKEYE STERLING V2` project as additional context).
2. Copy `CLAUDE.md` to the project root.
3. Upload the rest of the files as project knowledge.
4. First message:
   ```
   Read README.md, then ORCHESTRATOR.md, then SLA_RULES.md.
   Then propose the smallest possible diff to add a new dispatch
   path for a Tier C event called "policy-update-required".
   ```

---

## Stack

- **Asana SDK:** plain `fetch` calls (no SDK pinning).
- **Storage:** Netlify Blobs `brain-memory` store (idempotency,
  dead-letter, audit log).
- **Cron:** Netlify Scheduled Functions.
- **Webhook:** Netlify Functions with X-Hook-Secret echo.
- **Tests:** vitest with mocked Asana API.

---

## Compliance anchors

| Subsystem | Anchor |
|---|---|
| Orchestrator façade | Cabinet Res 134/2025 Art.19 |
| Four-eyes pairs | Cabinet Res 134/2025 Art.12-14, EU AI Act Art.14 |
| SLA enforcer (freeze) | Cabinet Res 74/2020 Art.4 |
| SLA enforcer (CNMR) | Cabinet Res 74/2020 Art.6 |
| SLA enforcer (STR) | FDL Art.26-27 |
| Comment mirror (audit) | FDL Art.20-22 |
| Retention (idempotency 30d, dead-letter ∞) | FDL Art.24 |
| Webhook X-Hook-Secret | (security, not regulatory) |

---

## Source repo

`https://github.com/trex0092/compliance-analyzer`
All code lives at `src/services/asana/` and `netlify/functions/asana-*.mts`.
All work lands on `main`.
