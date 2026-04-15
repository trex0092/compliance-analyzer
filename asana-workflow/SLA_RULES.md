# ASANA WORKFLOW — SLA Rules

The SLA enforcer is the regulatory clock that runs on every brain
task. It tracks per-section deadlines from the moment a task lands
in a section to the moment it leaves, and auto-escalates breaches.

This is how we prove to MoE, EOCN, and the FIU that we file on time.

---

## File map

| File | Role |
|---|---|
| `src/services/asanaSlaEnforcer.ts` | Tracks per-section countdowns |
| `src/services/asanaSlaAutoEscalation.ts` | Escalates breaches |
| `src/utils/businessDays.ts` | Business-day arithmetic (NEVER calendar) |

---

## Section SLA matrix

| Asana section | Deadline | Source | Type |
|---|---|---|---|
| Pending CO Review | 4 hours | internal SLA | clock |
| Pending Four-Eyes | 8 hours | internal SLA | clock |
| **EOCN Freeze Required** | **24 clock hours** | **Cabinet Res 74/2020 Art.4** | **clock** |
| **CNMR Filing Required** | **5 business days** | **Cabinet Res 74/2020 Art.6** | **business** |
| **STR Filing Required** | **"without delay" (4h SLA)** | **FDL Art.26-27** | **clock** |
| DPMSR Filing Required | 15 business days | FDL Art.16, MoE Circular 08/AML/2021 | business |
| UBO Re-verification | 15 working days | Cabinet Decision 109/2023 | working |
| Pending MLRO Review | 24 hours | internal SLA | clock |
| Awaiting External Reply | (no SLA — pause) | n/a | n/a |

**Bold rows are regulatory deadlines.** Internal SLAs may be relaxed
by the CO; regulatory deadlines may not be — they are immovable
under penalty.

---

## Clock vs business vs working days

| Type | Definition | Example |
|---|---|---|
| **clock** | 24 hours real time, including nights / weekends / holidays | `2026-04-14 14:00` + 24h = `2026-04-15 14:00` |
| **business** | UAE business days (Mon-Fri), excluding UAE public holidays | `2026-04-14` (Tue) + 5 BD = `2026-04-21` (Tue, skipping weekend) |
| **working** | UAE working days (Mon-Fri), same as business above | (synonym) |

`src/utils/businessDays.ts` is the **only** source of business-day
arithmetic. NEVER compute deadlines with `Date` math directly.

---

## The 24-hour freeze rule

Cabinet Res 74/2020 Art.4 requires asset freeze "without delay" on
confirmed sanctions matches. EOCN guidance interprets this as ≤24
clock hours, with a 1-2 hour target.

The SLA enforcer treats the 24-hour deadline as a hard backstop:

- 0-1h after section entry: nominal
- 1-4h: warning (yellow)
- 4-12h: alert (orange) — auto-escalate to CO
- 12-20h: critical (red) — auto-escalate to MLRO + CO
- 20-24h: emergency (purple) — auto-page on-call + Asana mention all leaders
- >24h: BREACH — incident record auto-created in `brain:incident-log:*`

The escalation ladder is implemented in `asanaSlaAutoEscalation.ts`.
Each escalation posts a story comment to the task with the elapsed
time and the next deadline.

---

## The 5 business day CNMR rule

Cabinet Res 74/2020 Art.6 requires CNMR filing within 5 business
days of confirmed match.

The SLA enforcer computes the deadline as:

```typescript
import { addBusinessDays } from '@/utils/businessDays';
const deadline = addBusinessDays(matchConfirmedAt, 5);
```

`addBusinessDays` skips:
- Weekends (Saturday, Sunday)
- UAE public holidays (loaded from `src/domain/uaeHolidays.ts`)

If the match is confirmed on a Wednesday, the CNMR deadline is the
following Wednesday (5 business days = Thu, Fri, Mon, Tue, Wed).

**Never use calendar days.** A bug in calendar-day arithmetic would
file CNMRs late and trigger penalties under Cabinet Res 71/2024.

---

## The "without delay" STR rule

FDL Art.26-27 requires STR filing "without delay" upon suspicion
confirmation. The constant
`STR_FILING_DEADLINE_BUSINESS_DAYS = 0` reflects this — there is
no grace period.

The SLA enforcer applies an internal 4-hour clock to give MLRO time
to draft the narrative, but the regulatory clock is **zero**. If
MLRO is approaching 4 hours, the auto-escalation pages the CO.

This is also why STR drafts are one of the six MANDATORY advisor
escalation triggers (per `src/services/advisorStrategy.ts`) — Opus
must review every narrative before filing.

---

## Pause sections

Some sections pause the SLA clock:

- `Awaiting External Reply` — clock paused, escalation suppressed
- `Customer Information Requested` — clock paused
- `Pending Legal Review` — clock paused
- `On Hold by MLRO` — clock paused, requires MLRO unblock comment

When a task moves out of a paused section, the clock resumes from
the previous elapsed time (not zero). This is enforced by the
`pausedAt` / `resumedAt` fields on the SLA state record.

---

## Auto-escalation comments

Each escalation posts a comment with this format:

```
⏰ SLA escalation — <level>
Section: <section name>
Elapsed: <hours / business days>
Deadline: <hours / business days remaining>
Regulatory anchor: <Article citation>
Required action: <one-line>

Escalated to: @<role>
Next escalation: <time>
```

Escalation comments are mirrored to the case audit log via
`asanaCommentMirror.ts`.

---

## Breach record

When a deadline is breached:

1. SLA enforcer writes a record to
   `brain:incident-log:<tenantId>:<caseId>:<epochMs>` with severity
   `regulatory-breach`
2. Auto-remediation executor (Tier B) runs the breach playbook
3. CO + MLRO are paged via Asana mention
4. `/incident` skill is auto-fired by the comment router
5. Post-mortem skill is queued for the next business day

Breaches are never silent. The whole point of the SLA enforcer is
to make sure they cannot be.

---

## Reset rules

The SLA clock resets ONLY when:

- The task leaves the section (normal flow)
- An MLRO override (with citation) is applied via break-glass
- The case is closed

The clock does NOT reset when:

- A custom field changes
- A comment is added
- A subtask is created
- The assignee changes

This prevents accidental clock-fiddling that would mask breaches.

---

## Testing

Tests live in `tests/asana/sla.test.ts`:

- 24h freeze countdown crosses each escalation threshold
- 5BD CNMR with weekend in the middle
- 5BD CNMR with public holiday in the middle
- "Without delay" STR with 4h internal SLA
- Pause section pauses + resumes correctly
- Breach record is written exactly once
- Escalation comment format is stable
- Calendar-day arithmetic is REJECTED (test that fails if anyone
  bypasses `businessDays.ts`)

Run them in isolation:

```bash
npx vitest run tests/asana/sla.test.ts
```

---

## Audit-time questions and answers

| Auditor question | Answer |
|---|---|
| "How do you enforce the 24h freeze?" | `asanaSlaEnforcer.ts` + auto-escalation ladder |
| "How do you compute the 5BD CNMR deadline?" | `businessDays.ts addBusinessDays(date, 5)` |
| "How do you handle UAE public holidays?" | `uaeHolidays.ts` loaded into `businessDays.ts` |
| "What if the SLA enforcer crashes?" | `asana-sync-cron` reconciles every hour |
| "Who can pause the clock?" | Only MLRO via break-glass with regulatory citation |
| "Where are breaches recorded?" | `brain:incident-log:*` in Netlify Blobs, retention forever |
