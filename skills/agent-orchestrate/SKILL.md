---
model: sonnet
allowed-tools: [Read, Grep, Glob, Bash, Agent]
context: [src/agents/orchestration/engine.ts, src/agents/orchestration/workflows.ts, src/services/weaponizedConsensus.ts, src/services/approvalGates.ts, src/services/trajectoryTracker.ts]
hooks: { post-run: "echo '[AUDIT] /agent-orchestrate completed $(date -u +%Y-%m-%dT%H:%M:%SZ)'" }
risk-level: high
regulatory-refs: [FDL No.10/2025 Art.20-21, Cabinet Res 134/2025 Art.14, FATF Rec 26]
---

# /agent-orchestrate — Multi-Agent Compliance Workflow Orchestrator

Orchestrate complex compliance workflows using the PEER pattern (Plan, Execute, Express, Review) from agentUniverse, with graph-based checkpointing from Microsoft Agent Framework.

## Usage
```
/agent-orchestrate [workflow type] [entity or case ID]
```

**Workflow types:** `cdd`, `edd`, `str-filing`, `sanctions-freeze`, `ubo-verification`, `periodic-review`, `incident-response`

## Instructions

### Step 1: Workflow Planning (Plan Phase)
1. Call `get_minimal_context(task="agent orchestration")`.
2. Decompose the workflow into a task DAG based on type:

**CDD Workflow DAG:**
```
[Identify Entity] → [Screen Against Lists] → [Geographic Risk] → [Risk Score]
                                                                      ↓
[Document Collection] → [Verification] → [CDD Tier Decision] → [Approval Gate]
```

**EDD Workflow DAG:**
```
[CDD Workflow] → [Enhanced Screening] → [Source of Wealth] → [Source of Funds]
                                              ↓
[PEP Check] → [Senior Management Approval] → [Board Approval if PEP] → [EDD Report]
```

**STR Filing DAG:**
```
[Suspicious Activity Detection] → [Internal Investigation] → [CO Review]
    ↓                                                            ↓
[Evidence Collection] → [goAML XML Generation] → [Validation] → [Filing]
    ↓
[Record Retention (5yr)] → [No Tipping Off Verification (Art.29)]
```

### Step 2: Execution (Execute Phase)
Execute each DAG node using appropriate subagents:
- **Screening Agent**: Invoke `/multi-agent-screen` for parallel list checks
- **Risk Agent**: Use `src/risk/scoring.ts` + `src/risk/decisions.ts`
- **Filing Agent**: Use `src/services/goamlBuilder.ts` + `src/utils/goamlValidator.ts`
- **Deadline Agent**: Use `src/utils/businessDays.ts` for all deadline calculations

### Step 3: Express (Express Phase)
Generate structured output for each workflow:
- Compliance decision with supporting evidence
- Risk score breakdown with factor analysis
- Recommended actions with regulatory references
- Deadline tracking (STR: 10 business days, CTR: 15, CNMR: 5, EOCN: 24h)

### Step 4: Review (Review Phase)
Apply four-eyes principle for high-risk decisions:
- Score >= 16 → Requires Senior Management approval (Art.14)
- PEP detected → Requires Board approval
- Sanctions match → Requires CO + MLRO sign-off
- All decisions logged with timestamp, approver, and rationale

### Step 5: Checkpoint & Audit Trail
Every workflow step is checkpointed (Microsoft Agent Framework pattern):
- State can be replayed for regulatory investigations
- Full audit trail per `src/utils/auditChain.ts`
- Record retention minimum 5 years (FDL Art.24)

### Architecture Reference
- `vendor/agentUniverse` — PEER collaboration pattern
- `vendor/microsoft-agent-framework` — Graph-based orchestration with checkpointing
- `vendor/open-multi-agent` — TypeScript DAG execution with approval gates
