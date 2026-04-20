# /snapshot-freshness-gate — Block a screening if the sanctions snapshot is stale

Enforce a hard gate before any screening: every mandatory sanctions list
must be loaded from a snapshot that is less than the per-list age budget.
If any mandatory list is stale or unreachable, the gate refuses the run
and the MLRO is BLOCKED from recording a disposition (FDL No.10/2025
Art.20-21 — CO must see integrity state).

## Why this skill exists

A screening that ran against a 3-day-old UN list is not a screening;
it is a liability. "100% correct at the moment of screening" requires
that the source data is demonstrably current AT THE MOMENT the match
was computed. This skill wraps the screening call in a pre-flight
freshness check and stamps the snapshot age + hash into the Asana
report so the auditor can reproduce exactly what was matched against.

## Usage

```
/snapshot-freshness-gate [--dry-run]
```

Without arguments: reports freshness + blocks if any gate fails. With
`--dry-run`: reports freshness, never blocks (used by the
`snapshot-freshness-monitor` cron proposal).

## Gate table

| List | Max age | Source | Behaviour on miss |
|------|---------|--------|-------------------|
| UN Consolidated (1267 / 1988 / 2231) | 24 h | `sanctions-snapshots` blob | BLOCK · UN Charter Art.25 |
| UAE EOCN (local terror list)        | 24 h | manual EOCN upload queue | BLOCK · Cabinet Res 74/2020 Art.4 |
| OFAC SDN + Non-SDN                  | 24 h | OFAC feed | BLOCK · OFAC 31 CFR 501 |
| EU Consolidated                     | 48 h | EU feed | WARN · Council Reg. 2580/2001 |
| UK OFSI                             | 48 h | UK feed | WARN · SAMLA |
| CH SECO, CA OSFI, AU DFAT, JP MoF, SG MAS, HK HKMA, IL MoD, WB Debar | 7 d | respective feeds | WARN |
| FATF Grey / Black                   | 30 d | FATF plenary outputs | WARN · FATF public statement |
| CAHRA list (LBMA RGG)               | 30 d | LBMA + OECD feeds | WARN |

BLOCK → screening cannot proceed; disposition recording forbidden.
WARN  → screening proceeds; a `snapshot-stale` tag is added to the
        Asana task and the row renders a yellow banner.

## Instructions

### Step 1 · Load the snapshot manifest
1. Read the most recent entry for each list from `sanctions-snapshots`
   (Netlify Blob).
2. Record `loadedAt` (time of write), `fetchedAt` (time we polled the
   source), and the SHA-256 content hash.
3. Compute `ageMin = now - fetchedAt` for each list.

### Step 2 · Evaluate each gate
For every list in the gate table:
- Compute `state = ok | warn | err` from `ageMin` vs the per-list budget.
- For lists in BLOCK mode, any `err` aborts the whole gate.
- For lists in WARN mode, an `err` attaches a `snapshot-stale-<list>` tag
  to the eventual Asana task and adds a banner to the MLRO verdict page.

### Step 3 · Emit the gate report
```
SNAPSHOT FRESHNESS GATE — <timestamp UTC>

UN Consolidated      · ok    · age  4h 12m · hash 3f2a9c…
OFAC SDN             · ok    · age  2h 47m · hash a81d0b…
UAE EOCN             · WARN  · age  4d 05h · manual upload overdue
EU Consolidated      · ok    · age 19h 41m · hash 7c5eac…
UK OFSI              · err   · fetch failed 3x · last success 92h ago
…

GATE: BLOCKED — UAE EOCN is stale (max 24h) and UK OFSI is unreachable.
Do not record any disposition on pending screenings until this gate
passes. Run /eocn-ingest-retry to force-reload the EOCN upload queue
and investigate the UK OFSI fetch failure before retrying.
```

### Step 4 · Stamp the evidence
Every screening run that passes the gate writes the snapshot hash set
into the row's `run_id` envelope so the audit-pack can reproduce the
exact snapshot state. Every failed gate writes a `snapshot-gate-miss`
record to `sanctions-watch-audit` with MLRO attestation of the blocked
screening.

## Regulatory basis

- FDL No.10/2025 Art.20-21 — CO situational awareness of integrity state
- FDL No.10/2025 Art.24 — 10-yr audit record must include source state
- Cabinet Res 74/2020 Art.4 — freeze must be driven by a CURRENT list
- Cabinet Decision 74/2020 — mandatory list screening
- FATF Rec 6-7 (TFS mandatory list screening), Rec 10 (ongoing CDD)
- OFAC Recent Action Notice + OFAC FAQ 401 (stale list = systemic risk)

## Related routines

- `sanctions-ingest` (every 15 min) — writes the snapshots this gate reads
- `sanctions-watch` (daily 05:00 UTC) — alerts if any feed is stale
- `eocn-ingest-retry` (hourly) — closes the manual-upload gap
- `snapshot-freshness-monitor` (new proposal, every 5 min) — raises
  Asana alert the moment a feed crosses its age budget
