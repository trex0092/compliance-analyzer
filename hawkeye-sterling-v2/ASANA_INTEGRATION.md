# HAWKEYE STERLING V2 — Asana Integration

The Asana subsystem is the operator-facing arm of the brain. The
brain produces verdicts. Asana turns each verdict into a task on the
right person's queue with the right SLA and the right four-eyes gate.

---

## Topology

```
brain verdict
     │
     ▼
orchestrator façade  ── idempotency store ── retry queue ── dead letter
     │
     ├── productionDispatchAdapter   (Tier A/B verdicts)
     ├── tierCAsanaDispatch          (Tier C events)
     └── fourEyesSubtaskCreator      (high-risk decisions)
                                          │
                                          ▼
                                  Asana workspace
                                          │
            ┌─────────────────────────────┼─────────────────────────┐
            ▼                             ▼                         ▼
       webhook router            comment skill router       SLA enforcer
            │                             │                         │
            ▼                             ▼                         ▼
       brain replay               skill runner registry      auto-escalation
```

---

## Files

| File | Role |
|---|---|
| `src/services/asana/orchestrator.ts` | Single entry point — everything in this directory dispatches through here. Idempotent. |
| `src/services/asana/productionDispatchAdapter.ts` | Maps Tier A/B brain verdicts to Asana task templates |
| `src/services/asana/tierCAsanaDispatch.ts` | Maps Tier C events (break-glass, outbound, clamp suggestion) to tasks |
| `src/services/asana/fourEyesSubtaskCreator.ts` | Creates the second-approver subtask for high-risk verdicts |
| `src/services/asana/asanaBrainTaskTemplate.ts` | Title / description / custom-field shape for brain tasks |
| `src/services/asana/skillRunnerRegistry.ts` | 47 skills mapped to handlers, fired by Asana comment router |
| `src/services/asanaCustomFieldRouter.ts` | Maps brain fields → Asana custom field IDs per workspace |
| `src/services/asanaSectionWriteBack.ts` | Moves task between sections as case progresses |
| `src/services/asanaCommentMirror.ts` | Mirrors brain reasoning chain into the task as a comment thread |
| `src/services/asanaSlaEnforcer.ts` | Tracks per-section SLA (24h freeze, 5BD CNMR, 10BD STR) |
| `src/services/asanaSlaAutoEscalation.ts` | Auto-escalates breaches to MLRO + CO |
| `src/services/asanaWebhookRouter.ts` | Routes inbound Asana webhooks to handlers |
| `src/services/asanaQueue.ts` | Retry queue with exponential backoff + dead letter |
| `src/services/asanaHealthTelemetry.ts` | Per-tenant API call latency + error rate |
| `src/services/asanaBulkOperations.ts` | Batched task creation (up to 100 / call) |
| `src/services/asanaSchemaMigrator.ts` | Custom field schema versioning + auto-migration |
| `src/services/asanaWorkflowAutomationExtensions.ts` | Built-in workflow shortcuts (assign + due-date + section) |
| `src/services/asanaPhase4Ultra.ts` | Latest helpers (cohort batching, dependent subtasks, skill chains) |
| `src/services/asanaFourEyesAsTasks.ts` | Materialises the four-eyes contract as paired Asana tasks |
| `src/services/cddAsanaCustomFieldPush.ts` | Pushes CDD tier + risk score into Asana custom fields |
| `src/services/asanaAttachmentSecurity.ts` | Validates + virus-scans attachments before download |

---

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/asana-dispatch` | POST | Direct task creation (bypasses orchestrator — emergency only) |
| `/api/asana-webhook` | POST | Inbound webhook receiver |
| `/api/asana-comment-skill-handler` | POST | Routes Asana comments → skill runners |
| `/api/asana-proxy` | POST | Token-protected proxy for browser access |
| `/api/asana-simulate` | POST | Dry-run a brain → Asana dispatch without writing |
| `/api/asana-toast-stream` | GET | SSE stream of dispatch events for the toast UI |
| `/api/asana-migrate-schema` | POST | One-shot custom field schema migration |
| `/api/asana-sync-cron` | scheduled | Hourly reconciliation between brain state and Asana |
| `/api/asana-retry-queue-cron` | scheduled | Drains the dead-letter queue |
| `/api/asana-weekly-digest-cron` | scheduled | Weekly digest comment per active case |
| `/api/asana-weekly-customer-status-cron` | scheduled | Weekly customer status section roll-up |
| `/api/asana-super-brain-autopilot-cron` | scheduled | Tier B autopilot (auto-remediation) cron |

---

## Idempotency contract

The orchestrator is the **only** path to Asana. Every call carries an
idempotency key derived from:

```
sha3_512(tenantId | caseId | verdict | timestampHour | dispatchKind)
```

The orchestrator stores the key in `brain-memory` blobs under
`asana:idem:*` with a 30-day TTL. Replaying the same call within 30
days returns the original response without writing to Asana.

This protects against:
- Webhook double-delivery
- Cron retries
- MLRO clicking "dispatch" twice
- Network retries from `asanaQueue.ts`

---

## Retry + dead letter

`asanaQueue.ts` wraps every Asana API call with:

- Exponential backoff: 2s → 4s → 8s → 16s
- Max retries: 4
- Dead letter store: `asana:dead-letter:*`
- Drained by `asana-retry-queue-cron` every 15 minutes

Dead letter entries surface in the Brain Console UI under the
"Asana ops" panel. MLRO can replay or discard each one with audit log.

---

## Webhook router

`asanaWebhookRouter.ts` accepts inbound webhooks and routes by event:

| Event | Handler |
|---|---|
| `task.added_to_section` | SLA enforcer — start countdown |
| `task.removed_from_section` | SLA enforcer — stop countdown |
| `story.added` | Comment mirror + skill router |
| `task.changed` | Custom field router — pull updated brain state |
| `task.completed` | Case lifecycle hook — close case in brain |
| `webhook.handshake` | Echo X-Hook-Secret per Asana docs |

All other events are logged and dropped.

---

## Comment skill router

When a comment lands on a brain task, the router scans for `/<skill>`
and dispatches to `skillRunnerRegistry.ts`. Example:

```
MLRO comments: "/screen subject-name"
→ router parses → skillRunnerRegistry["screen"](taskId, "subject-name")
→ runs the screen skill → posts result as a reply comment
```

The 47 skill mappings live in `skillRunnerRegistry.ts`. Adding a new
skill: register the runner, add the row to `SKILLS.md`, ship.

---

## SLA enforcement

Per Cabinet Res 74/2020 Art.4 (24h freeze) and Art.6 (5 BD CNMR), and
FDL Art.26-27 (STR without delay), the SLA enforcer maintains a
countdown per section:

| Section | Deadline | Source |
|---|---|---|
| Pending CO Review | 4h | internal SLA |
| Pending Four-Eyes | 8h | internal SLA |
| EOCN Freeze Required | 24 clock hours | Cabinet Res 74/2020 Art.4 |
| CNMR Filing Required | 5 business days | Cabinet Res 74/2020 Art.6 |
| STR Filing Required | "without delay" (4h SLA) | FDL Art.26-27 |
| DPMSR Filing Required | 15 business days | FDL Art.16 |

Breach → auto-escalation comment + section move to "ESCALATED" +
notification to MLRO and CO via Asana mention.

---

## Four-eyes as tasks

Every high-risk decision creates two paired tasks:

1. **Approver A task** — assigned to the user who proposed the action
2. **Approver B task** — assigned to a different user with the same
   role; references task A as a dependency

Approver B cannot complete their task until Approver A's task is
done. Self-approval is impossible by construction (the task creator
is excluded from the assignee pool for task B).

This makes the four-eyes contract visible and auditable in Asana
without any custom plugin.

---

## Custom field schema

The custom fields used by brain tasks are versioned. The migrator
(`asanaSchemaMigrator.ts`) compares the current workspace schema to
the expected version and:

- Adds missing fields
- Renames fields with old names
- Never deletes fields (audit safety)
- Logs a migration record

Running `POST /api/asana-migrate-schema` is idempotent — safe to call
on every deploy.

Expected fields per brain task:

| Field | Type | Source |
|---|---|---|
| `Brain Verdict` | enum | brain |
| `Confidence` | number | brain |
| `Power Score` | number | brain |
| `Uncertainty Lower` | number | brain |
| `Uncertainty Upper` | number | brain |
| `Regulatory Citation` | text | brain |
| `Tenant ID` | text | brain |
| `Case ID` | text | brain |
| `Idempotency Key` | text | orchestrator |
| `SLA Deadline` | date | SLA enforcer |
| `Four-Eyes Pair` | task reference | four-eyes creator |

---

## Adding a new dispatch path

1. Define the new dispatch kind in `productionDispatchAdapter.ts` or
   `tierCAsanaDispatch.ts`.
2. Add the task template shape to `asanaBrainTaskTemplate.ts`.
3. Wire the orchestrator entry point.
4. Add a test under `tests/asana/` covering the happy path + retry +
   idempotency replay.
5. Cite the regulatory anchor in the commit per CLAUDE.md §8.

Never call the Asana API directly from any file other than
`asanaQueue.ts`. The orchestrator + queue is the only path. This is
how we keep idempotency, retry, and audit honest.
