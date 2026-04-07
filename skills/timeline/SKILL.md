# /timeline — Entity Compliance History Reconstruction

Reconstruct the complete compliance history for any entity. Every action, every screening, every alert, every decision — in chronological order with full audit trail.

## Usage
```
/timeline [entity-name] [period]
```
Examples:
- `/timeline "MADISON JEWELLERY" all`
- `/timeline "FINE GOLD LLC" last-6-months`

## Instructions

### Step 1: Collect All Events
Search ALL localStorage keys for events related to this entity:

- `fgl_cra_v2` → CDD records, risk assessments
- `fgl_ubo_v2` → UBO changes
- `fgl_str_cases_v2` → STR cases
- `fgl_tfs_events_v2` → TFS screening events
- `fgl_approvals_v2` → Approval decisions
- `fgl_goaml_reports` → Filing records
- `fgl_workflow_log` → Workflow actions
- `fgl_auth_log` → Who accessed what, when
- `fgl_threshold_ctr_queue` → Threshold events
- `fgl_email_alert_log` → Email alerts triggered
- `fgl_mgmt_approvals` → Management assessments

### Step 2: Build Chronological Timeline

Sort ALL events by timestamp and present as:

```
═══════════════════════════════════════════════════════════════
     COMPLIANCE TIMELINE — [ENTITY NAME]
     Period: [start] to [end]
     Total Events: [N]
═══════════════════════════════════════════════════════════════

[YYYY-MM-DD HH:MM] ONBOARDING
├── Customer created by [user]
├── Initial CDD: [SDD/CDD/EDD]
├── Risk Score: [N] ([level])
├── UBO identified: [names, %]
└── Approved by: [user] (four-eyes: [user2])

[YYYY-MM-DD HH:MM] SCREENING
├── Lists checked: UN, OFAC, EU, UK, UAE
├── Result: No matches
└── Analyst: [user]

[YYYY-MM-DD HH:MM] TRANSACTION ALERT
├── Type: Cash threshold breach
├── Amount: AED [N]
├── Rule triggered: cash-threshold (AED 55,000)
├── CTR queued: yes
├── CTR deadline: [date] (15 business days)
└── Status: Filed [date] — [N] business days (ON TIME)

[YYYY-MM-DD HH:MM] CDD REVIEW
├── Type: Periodic (6-month medium-risk)
├── Reviewer: [user]
├── Outcome: Risk maintained at MEDIUM
├── Next review: [date]
└── Evidence updated: trade license, bank ref

[YYYY-MM-DD HH:MM] SANCTIONS ALERT ⚠️
├── List: OFAC SDN Update
├── Match: [entity name] — confidence 0.72 (POTENTIAL)
├── Escalated to: CO [user]
├── Decision: FALSE POSITIVE
├── Reasoning: [text]
└── Documented: [date]

[YYYY-MM-DD HH:MM] INCIDENT 🚨
├── Type: Confirmed sanctions match
├── EOCN deadline: [date+24h]
├── Assets frozen: [date] (within [N] hours — COMPLIANT)
├── CNMR filed: [date] (within [N] business days — COMPLIANT)
├── STR filed: [date]
└── Case closed: [date]

═══════════════════════════════════════════════════════════════
TIMELINE STATISTICS
═══════════════════════════════════════════════════════════════

| Metric | Count |
|--------|-------|
| Total events | [N] |
| Screenings performed | [N] |
| Alerts generated | [N] |
| Incidents | [N] |
| Filings | [N] |
| CDD reviews | [N] (all on time: [yes/no]) |
| Average response time | [N] hours |
| Longest gap between screenings | [N] days |
```
