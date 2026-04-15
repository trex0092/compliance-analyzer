# ASANA WORKFLOW — Project Instructions for Claude Code

These rules apply when working in this project. The Asana subsystem
is the operator-facing arm of the HAWKEYE STERLING brain. The brain
produces verdicts; Asana turns each verdict into a real task on a
real human's queue with the right SLA and the right four-eyes gate.

---

## Token-Efficient Workflow

### Rule 1: Read the docs in this directory first
- Always start with `ORCHESTRATOR.md` + `IDEMPOTENCY.md` before
  reading source files in `src/services/asana/`.
- The dispatch table in `SKILL_REGISTRY.md` is the single source of
  truth for what each comment skill does.
- Never read `compliance-suite.js` (4300+ lines) — it does not host
  Asana logic.

### Rule 2: Targeted reads
- `src/services/asana/orchestrator.ts` is the only entry point. Read
  it before any new dispatch path.
- `src/services/asanaQueue.ts` is the only file that actually calls
  the Asana API. Never bypass it.

### Rule 3: One commit per regulatory anchor
- Every change to dispatch logic, SLA timers, or four-eyes pairs
  must cite its anchor in the commit message.

---

## Architecture rules — non-negotiable

1. **Single entry point.** All dispatches go through
   `src/services/asana/orchestrator.ts`. No file outside this
   directory may call `asanaQueue.ts` directly.

2. **Idempotency first.** Every orchestrator call computes a
   sha3_512 idempotency key from `tenantId | caseId | verdict |
   timestampHour | dispatchKind`. Replays within 30 days return the
   cached response without writing to Asana.

3. **Retry queue last.** The queue wraps every Asana API call with
   exponential backoff (2s → 4s → 8s → 16s, max 4 retries). Anything
   that exceeds retry budget goes to the dead-letter store.

4. **Four-eyes by construction.** High-risk verdicts create paired
   tasks (Approver A + Approver B). The B task lists A as a
   dependency. The task creator is excluded from the B assignee
   pool by `fourEyesSubtaskCreator.ts`. Self-approval is impossible.

5. **No customer-visible side effects.** Nothing in the Asana
   subsystem may send an email, SMS, or in-app message to a customer.
   That goes through the deferred outbound queue (Tier C), and only
   after the `tippingOffLinter` and a CO release.

6. **Webhook handshake.** The webhook receiver MUST echo
   `X-Hook-Secret` on first delivery per Asana protocol. If you
   miss this, Asana drops the webhook and you find out two days
   later when the SLA enforcer goes silent.

---

## Regulatory anchors (Asana subsystem only)

| Article / Resolution | What it requires | Asana implementation |
|---|---|---|
| FDL Art.20-22 | CO duties + audit trail | comment mirror + section write-back |
| FDL Art.26-27 | STR without delay | SLA enforcer "STR Filing Required" section |
| FDL Art.24 | 10-year retention | dead-letter + audit log forever |
| Cabinet Res 134/2025 Art.12-14 | Four-eyes for high-risk | `fourEyesSubtaskCreator.ts` + paired tasks |
| Cabinet Res 134/2025 Art.19 | Internal review | orchestrator + section write-back |
| Cabinet Res 74/2020 Art.4 | 24h freeze | SLA enforcer "EOCN Freeze Required" section |
| Cabinet Res 74/2020 Art.6 | 5BD CNMR | SLA enforcer "CNMR Filing Required" section |
| EU AI Act Art.14 | Human oversight | every brain verdict creates a human task |

---

## Decision tree — adding a new dispatch path

```
Is the new dispatch a brain Tier A/B verdict?
├── YES → use productionDispatchAdapter + brain task template
│   └── Need four-eyes? → also create paired task via fourEyesSubtaskCreator
└── NO → is it a Tier C event (clamp / outbound / break-glass / zk)?
    ├── YES → use tierCAsanaDispatch
    │   └── It is read-only by design — never send customer message
    └── NO → does it need a separate adapter?
        ├── YES → create a new adapter under src/services/asana/
        │        and route through the orchestrator façade
        └── NO → reuse productionDispatchAdapter with a new dispatchKind
```

**Always:**
- Add a test under `tests/asana/`
- Add a row to `SKILL_REGISTRY.md` if the new path can be triggered
  by an Asana comment
- Cite the regulatory anchor in the commit message per CLAUDE.md §8

---

## Skill dispatch (when user asks)

| User says…                                   | Invoke                          |
|----------------------------------------------|---------------------------------|
| "dispatch this verdict to Asana"             | `/agent-orchestrate`            |
| "the comment skill router fired wrong"       | read `SKILL_REGISTRY.md` first  |
| "SLA breached on case X"                     | `/incident` → check enforcer log |
| "four-eyes blocked on case X"                | read `FOUR_EYES.md`             |
| "set up Asana for a new tenant"              | read `SETUP_CHECKLIST.md`       |
| "webhook handshake failing"                  | read `WEBHOOKS.md`              |

---

## Hooks

- **session-start** — auto-updates code-review-graph
- **pre-commit-security** — blocks hardcoded secrets, eval(), unsafe patterns

---

## Error recovery (Asana-specific)

| Failure | First check |
|---|---|
| `403` from Asana API | PAT expired or workspace permissions changed |
| `429` from Asana API | Hit Asana rate limit — backoff via `asanaQueue.ts` |
| Webhook delivers but no handler fires | `asanaWebhookRouter.ts` event mapping |
| Idempotency replay returns wrong response | Hour boundary crossed — clear blob entry |
| Four-eyes B task auto-assigned to creator | `fourEyesSubtaskCreator.ts` exclusion list |
| SLA enforcer countdown stuck | Section move webhook missed — replay from `asana-sync-cron` |
| Dead letter growing | Asana API outage — read `RETRY_QUEUE.md` for drain steps |

---

## Golden rules

1. **No file outside `src/services/asana/` calls the Asana API.**
2. **Idempotency keys are mandatory. No exceptions.**
3. **Self-approval is rejected by the API. Never disable the check.**
4. **Customer-facing messages route through the deferred outbound
   queue, not Asana comments.**
5. **Read this file before editing this directory.**
