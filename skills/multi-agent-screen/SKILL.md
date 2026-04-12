---
model: sonnet
allowed-tools: [Read, Grep, Glob, Bash, Agent]
context: [src/services/multiModelScreening.ts, src/services/weaponizedConsensus.ts, src/services/trajectoryTracker.ts, src/risk/redFlags.ts, src/domain/constants.ts]
hooks: { post-run: "echo '[AUDIT] /multi-agent-screen completed $(date -u +%Y-%m-%dT%H:%M:%SZ)'" }
risk-level: critical
regulatory-refs: [FDL No.10/2025 Art.12-14 Art.35, Cabinet Res 74/2020 Art.4-7, FATF Rec 22/23]
---

# /multi-agent-screen — Parallel Multi-Agent Sanctions Screening

Run parallel sanctions screening across all required lists using a multi-agent orchestration pattern inspired by open-multi-agent's DAG-based task decomposition.

## Usage
```
/multi-agent-screen [entity name or ID]
```

## Instructions

When this skill is invoked, follow these steps:

### Step 1: Initialize Screening Context
1. Call `get_minimal_context(task="multi-agent sanctions screening")`.
2. Identify entity type: customer, supplier, counterparty, UBO, or transaction.
3. Gather entity details: full name, aliases, DOB, nationality, ID documents.

### Step 2: Parallel List Screening (DAG Pattern)
Execute ALL screening checks in parallel using concurrent subagents. Never skip a list (FDL Art.35, FATF Rec 22/23).

**Tier 1 — Mandatory Lists (parallel):**
- UN Consolidated Sanctions List
- OFAC SDN + Sectoral Sanctions
- EU Consolidated Financial Sanctions
- UK OFSI Financial Sanctions
- UAE Local Terrorist List + EOCN Designations

**Tier 2 — Extended Lists (parallel, after Tier 1):**
- FATF Grey/Black List status
- CAHRA (Conflict-Affected & High-Risk Areas)
- PEP databases
- Dubai Financial Services Authority watchlists
- CBUAE circulars

### Step 3: Match Scoring & Decision Tree
For each match found, apply the sanctions decision tree from CLAUDE.md:
```
Match confidence >= 0.9 → FREEZE immediately
  ├── Start 24h EOCN countdown (checkEOCNDeadline)
  ├── File CNMR within 5 business days (checkDeadline)
  └── DO NOT notify the subject (Art.29 — no tipping off)
Match confidence 0.5-0.89 → Escalate to CO
  └── CO decides: confirm → FREEZE, or false positive → document & dismiss
Match confidence < 0.5 → Log and dismiss, document reasoning
```

### Step 4: Risk Score Aggregation
1. Use `src/risk/scoring.ts` logic: base score = likelihood x impact.
2. Apply context multipliers from all parallel screening results.
3. Aggregate across all list matches using highest-match-wins strategy.

### Step 5: Generate Report
Output a structured screening report with:
- Entity identification details
- Per-list match results with confidence scores
- Aggregate risk score and recommended action
- Timestamp, screening analyst, and audit trail entry
- Cross-references to `src/services/sanctionsApi.ts` list configurations

### Architecture Reference
This skill uses the parallel subagent pattern from:
- `vendor/open-multi-agent` — DAG-based task decomposition with semaphore-controlled agent pools
- `vendor/openai-agents-python` — Guardrails for input/output validation
- `vendor/agentUniverse` — DOE pattern for data-intensive precision screening
