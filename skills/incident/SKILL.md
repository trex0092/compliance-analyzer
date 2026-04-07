# /incident — Compliance Incident Response with EOCN Countdown

Handle a compliance incident (sanctions match, STR trigger, asset freeze, PF alert) with countdown timers and regulatory workflow.

## Usage
```
/incident [entity-name] [type]
```
Types: `sanctions-match`, `str-trigger`, `asset-freeze`, `pf-alert`, `tipping-off`, `fiu-request`

## Instructions

### IMMEDIATE ACTIONS (within minutes)

#### For sanctions-match / asset-freeze:
1. **START 24-HOUR COUNTDOWN** (Cabinet Res 74/2020 Art.4)
   - Use `checkEOCNDeadline()` from `src/utils/businessDays.ts`
   - Display: "⏱ EOCN DEADLINE: [hours remaining] hours"
2. **Freeze all accounts/transactions** for the entity
3. **Restrict system access** — only CO and MLRO can view this entity's data
4. **Do NOT notify the subject** (FDL Art.29 — no tipping off)

#### For str-trigger:
1. **START 10 BUSINESS DAY COUNTDOWN** (FDL Art.26)
   - Use `checkDeadline(eventDate, STR_FILING_DEADLINE_BUSINESS_DAYS)`
   - Display: "📋 STR DEADLINE: [days remaining] business days"
2. **Restrict access** — mark case as confidential
3. **Begin evidence gathering**

#### For pf-alert:
1. **START 24-HOUR COUNTDOWN** (Cabinet Res 156/2025)
2. **Screen against Strategic Goods Control Lists**
3. **Block transaction** pending investigation
4. **Notify MLRO immediately**

#### For fiu-request:
1. **Note response deadline** from FIU letter
2. **Do NOT tip off** the subject
3. **Gather requested information**
4. **Prepare response for CO signature**

### INVESTIGATION PHASE

1. **Document timeline**:
   - When was the incident detected?
   - Who detected it?
   - What triggered it? (screening match, transaction alert, tip, etc.)

2. **Gather evidence**:
   - Transaction records
   - Customer profile and CDD file
   - Screening results
   - Communication records
   - Third-party intelligence

3. **Assess scope**:
   - Is this entity connected to others in the system?
   - Are there related transactions to freeze?
   - Is there a wider network?

### FILING PHASE

Use `/goaml [type] [entity]` to generate the appropriate filing:
- Sanctions confirmed → CNMR to EOCN (5 business days)
- Suspicious activity → STR via goAML (10 business days)
- Cash threshold → CTR via goAML (15 business days)
- PF confirmed → PF report to EOCN (24 hours)

### REPORTING

```
## Incident Report

### Timeline
| Time | Event | Actor |
|------|-------|-------|
| [T+0h] | Incident detected | [system/analyst] |
| [T+Nh] | [action taken] | [who] |

### Entity
- Name: [entity]
- Type: [customer/supplier/UBO]
- Risk Level: [critical]

### Deadlines
| Filing | Deadline | Status | Remaining |
|--------|----------|--------|-----------|
| EOCN Freeze | [date+24h] | [Met/Breached] | [hours] |
| CNMR | [date+5bd] | [Pending/Filed] | [days] |
| STR | [date+10bd] | [Pending/Filed] | [days] |

### Actions Taken
1. [action] — [who] — [when]

### Regulatory References
- [cite specific articles]
```
