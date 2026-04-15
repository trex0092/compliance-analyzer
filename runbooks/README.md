# HAWKEYE STERLING Runbook Library

One markdown file per cron and per Tier C endpoint. Each runbook
follows the same structure so operators can find answers fast:

1. **Owner** — who to page when it breaks
2. **Purpose** — what the subsystem does
3. **Schedule / Trigger** — when it runs
4. **Expected healthy state** — green signals
5. **Common failure modes** — what to check first
6. **Recovery steps** — step-by-step fix
7. **Regulatory citation** — the article that justifies the subsystem

Runbooks are the operational complement to the `hawkeye-sterling-v2/`
architecture pack. V2 answers "what is this?"; runbooks answer
"what do I do when it's broken?".

## Index

| File | Subsystem |
|---|---|
| `brain-clamp-cron.md` | Hourly clamp suggestion generator |
| `sanctions-delta-screen-cron.md` | 4-hourly cohort re-screener against sanctions delta |
| `sanctions-ingest-cron.md` | Fetches UN / OFAC / EU / UK / EOCN lists |
| `asana-sync-cron.md` | Hourly brain ↔ Asana reconciliation |
| `asana-retry-queue-cron.md` | 15-min dead-letter drain |
| `asana-super-brain-autopilot-cron.md` | 15-min case dispatcher |
| `ai-governance-self-audit-cron.md` | Daily governance self-audit |
| `regulatory-drift-cron.md` | Daily drift watchdog |
| `chain-anchor-cron.md` | Blockchain-anchored audit seal |
| `brain-outbound-queue.md` | Tier C deferred outbound endpoint |
| `brain-break-glass.md` | Tier C two-person override endpoint |
| `brain-zk-cross-tenant.md` | Tier C cross-tenant attestation endpoint |

## Universal golden rules

1. **Never `--no-verify` a failing hook** — the hook is telling you something real.
2. **Never manually edit `src/domain/constants.ts`** without a regulatory citation in the commit message.
3. **Never delete an audit log entry** — retention is 10 years (FDL Art.24).
4. **Never bypass four-eyes** — Cabinet Res 134/2025 Art.12-14 is non-negotiable.
5. **Never silence a failing alert** — acknowledge, fix, document in the runbook, add a test.
