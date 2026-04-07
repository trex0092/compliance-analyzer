# /filing-compliance — Filing Deadline Compliance Report

Analyze ALL filings (STR, SAR, CTR, CNMR, DPMSR) and verify every deadline was met using business day calculations. This is the report that proves to auditors you file on time.

## Usage
```
/filing-compliance [period]
```
Examples:
- `/filing-compliance 2025`
- `/filing-compliance Q1-2026`
- `/filing-compliance all`

## Instructions

### Step 1: Collect All Filings
From `fgl_goaml_reports` and `fgl_workflow_log`, extract every filing:
- Report type (STR/SAR/CTR/DPMSR/CNMR)
- Triggering event date
- Report creation date
- Report filing date (or status if pending)
- goAML reference number

### Step 2: Calculate Business Days
For each filing, use `checkDeadline()` from `src/utils/businessDays.ts`:

| Type | Deadline (business days) | Constant |
|------|------------------------|----------|
| STR | 10 | STR_FILING_DEADLINE_BUSINESS_DAYS |
| SAR | 10 | STR_FILING_DEADLINE_BUSINESS_DAYS |
| CTR | 15 | CTR_FILING_DEADLINE_BUSINESS_DAYS |
| CNMR | 5 | CNMR_FILING_DEADLINE_BUSINESS_DAYS |
| EOCN Freeze | 24 hours | EOCN_FREEZE_DEADLINE_HOURS |

### Step 3: Generate Report

```
═══════════════════════════════════════════════════════════════
     FILING DEADLINE COMPLIANCE REPORT
     Period: [start] to [end]
     Generated: [date]
═══════════════════════════════════════════════════════════════

SUMMARY
───────
Total filings: [N]
On-time: [N] ([N]%)
Late: [N] ([N]%)
Pending: [N] (deadline approaching: [N])

COMPLIANCE RATE: [N]%
REGULATORY TARGET: 100% (FDL Art.26, Art.16)

═══════════════════════════════════════════════════════════════
DETAILED FILING LOG
═══════════════════════════════════════════════════════════════

| # | Type | Entity | Trigger Date | Filed Date | Biz Days | Deadline | Status |
|---|------|--------|-------------|-----------|----------|----------|--------|
| 1 | STR | [name] | [date] | [date] | [N]/10 | [date] | ✓ ON TIME |
| 2 | CTR | [name] | [date] | [date] | [N]/15 | [date] | ✓ ON TIME |
| 3 | STR | [name] | [date] | — | [N]/10 | [date] | ⚠️ PENDING ([N] days left) |
| 4 | CNMR | [name] | [date] | [date] | [N]/5 | [date] | ✗ LATE (by [N] days) |

═══════════════════════════════════════════════════════════════
EOCN ASSET FREEZE COMPLIANCE
═══════════════════════════════════════════════════════════════

| # | Entity | Confirmed | Frozen | Hours | Deadline | Status |
|---|--------|----------|--------|-------|----------|--------|
| 1 | [name] | [datetime] | [datetime] | [N]h | 24h | ✓ / ✗ |

═══════════════════════════════════════════════════════════════
LATE FILING ANALYSIS (if any)
═══════════════════════════════════════════════════════════════

For each late filing:
- Report: [type] for [entity]
- Deadline: [date]
- Actually filed: [date]
- Days late: [N] business days
- Root cause: [delay reason if documented]
- Penalty risk: AED [range] per Cabinet Res 71/2024
- Remediation: [action taken to prevent recurrence]

═══════════════════════════════════════════════════════════════
UPCOMING DEADLINES
═══════════════════════════════════════════════════════════════

| Report | Entity | Deadline | Days Remaining | Priority |
|--------|--------|----------|---------------|----------|
[list all pending filings sorted by urgency]
```
