# ASANA WORKFLOW — Orchestrator Façade

The orchestrator is the **single entry point** for everything that
writes to Asana. No other file may call the Asana API. This is the
most important contract in this directory; every other guarantee
(idempotency, retry, audit trail) flows from it.

---

## File map

| File | Role |
|---|---|
| `src/services/asana/orchestrator.ts` | Façade — sole entry point |
| `src/services/asana/productionDispatchAdapter.ts` | Adapter for Tier A/B brain verdicts |
| `src/services/asana/tierCAsanaDispatch.ts` | Adapter for Tier C events |
| `src/services/asana/fourEyesSubtaskCreator.ts` | Creates paired tasks for high-risk verdicts |
| `src/services/asana/asanaBrainTaskTemplate.ts` | Title / description / custom-field shape |
| `src/services/asana/skillRunnerRegistry.ts` | Comment-skill dispatch table |
| `src/services/asanaQueue.ts` | The ONLY file that calls `fetch(asana.com/...)` |

---

## Public API

```typescript
// src/services/asana/orchestrator.ts

export interface OrchestratorRequest {
  tenantId: string;
  caseId: string;
  dispatchKind:
    | 'brain-verdict'           // Tier A/B verdict
    | 'tierc-clamp-suggestion'
    | 'tierc-outbound-release'
    | 'tierc-break-glass-approved'
    | 'tierc-zk-collision-detected'
    | 'four-eyes-pair'
    | 'sla-escalation';
  payload: unknown;
  // optional override — by default we hash the payload
  idempotencyOverride?: string;
}

export interface OrchestratorResponse {
  ok: boolean;
  asanaTaskGid?: string;
  asanaSubtaskGid?: string;     // populated for four-eyes pairs
  idempotencyKey: string;
  replayed: boolean;             // true if served from cache
  durationMs: number;
}

export async function dispatch(
  req: OrchestratorRequest
): Promise<OrchestratorResponse>;
```

---

## Dispatch flow

```
1. Caller invokes orchestrator.dispatch(req)
        │
        ▼
2. Compute idempotency key
   sha3_512(tenantId | caseId | dispatchKind | hour | payloadHash)
        │
        ▼
3. Check idem store at asana:idem:<key>
   ├── HIT  → return cached OrchestratorResponse with replayed=true
   └── MISS → continue
        │
        ▼
4. Route by dispatchKind
   ├── brain-verdict        → productionDispatchAdapter
   ├── tierc-*              → tierCAsanaDispatch
   ├── four-eyes-pair       → fourEyesSubtaskCreator
   └── sla-escalation       → asanaSlaAutoEscalation
        │
        ▼
5. Adapter builds the task template
   (title, description, custom fields, section, assignee)
        │
        ▼
6. asanaQueue.enqueue(task)
   ├── attempt 1
   ├── attempt 2 (after 2s)
   ├── attempt 3 (after 4s)
   ├── attempt 4 (after 8s)
   └── attempt 5 (after 16s) → dead letter on final failure
        │
        ▼
7. On success: write asana:idem:<key> blob with response (TTL 30d)
        │
        ▼
8. Return OrchestratorResponse
```

---

## Why a façade

Without the façade, every new feature would call Asana directly, and
you would need a new code review for every dispatch path to verify:

- Idempotency key construction
- Retry behaviour
- Audit log write
- Custom field mapping
- Section routing

By concentrating the contract in `orchestrator.ts`, every adapter
inherits these guarantees automatically. Adding a new dispatch path
becomes a 30-line adapter file plus a one-line `case` in the
orchestrator's router.

---

## Idempotency key shape

```
sha3_512(
  tenantId        + '|' +
  caseId          + '|' +
  dispatchKind    + '|' +
  Math.floor(now / 3_600_000) + '|' +     // hour bucket
  sha3_512(JSON.stringify(payload))       // payload hash
)
```

The hour bucket means the same call within the same wall-clock hour
is deduplicated, but a retry one hour later is treated as a fresh
event (and gets a new task). This is intentional — a stale verdict
is rarely the same problem an hour later.

If the caller needs to force a brand-new task, pass
`idempotencyOverride: 'force-' + crypto.randomUUID()`.

See `IDEMPOTENCY.md` for the full rule set.

---

## Adapter contract

Every adapter exports:

```typescript
export interface DispatchAdapter<TPayload> {
  buildTask(
    tenantId: string,
    caseId: string,
    payload: TPayload
  ): AsanaTaskTemplate;

  postBuildSideEffects?(
    response: OrchestratorResponse,
    payload: TPayload
  ): Promise<void>;
}
```

The `postBuildSideEffects` hook is for things like writing an audit
log entry or fire-and-forgetting a downstream call. **Side effects
must be idempotent** — they may run more than once if the
orchestrator is replayed in degraded mode.

---

## Adding a new dispatch kind

1. Add the new kind to the `dispatchKind` union in `orchestrator.ts`.
2. Create the adapter file under `src/services/asana/`.
3. Add the `case` to the router in `orchestrator.ts`.
4. Add a test under `tests/asana/` that covers:
   - Happy path
   - Idempotency replay
   - Retry on transient failure
   - Dead letter on permanent failure
5. If the new kind can be triggered by an Asana comment, add a row
   to `SKILL_REGISTRY.md`.
6. Cite the regulatory anchor in the commit message.

---

## What the orchestrator deliberately does NOT do

- It does not retry indefinitely. Max 4 retries — anything beyond is
  a real outage and goes to the dead letter for human review.
- It does not auto-create custom fields. Use the schema migrator.
- It does not auto-create sections. Use the setup script.
- It does not send customer-facing messages. Use the deferred
  outbound queue.
- It does not bypass four-eyes for any reason. Even break-glass goes
  through the four-eyes pair, just with a faster SLA.
- It does not delete tasks. Closing a case marks the task complete;
  nothing is destroyed.

These are deliberate liability gates. Treat them as load-bearing.
