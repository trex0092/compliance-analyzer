# brain-break-glass (Tier C)

**Owner:** Compliance Officer + Board
**Endpoint:** `POST /api/brain/break-glass`
**Schedule:** synchronous (operator-triggered)
**Regulatory anchor:** Cabinet Res 134/2025 Art.12-14 (four-eyes)

## Purpose
Two-person approval workflow for overriding a brain verdict. Actions:

- `request` — MLRO files the override request
- `approve` — different CO approves (self-approval rejected)
- `list` — enumerate pending requests

## Expected healthy state
- Every approval is by a user DIFFERENT from the requester
- Every approved request creates a downstream Asana execution task
- Zero self-approvals (self-approval returns HTTP 400)

## Common failure modes

| Symptom | First check |
|---|---|
| Self-approval returned 400 | Not a bug — protected by construction |
| Request stuck in `pending_approval` for >8h | Four-eyes pair bottleneck — check CO load balancer |
| Approval flow bypassed | **CRITICAL** — investigate for tampering |
| Justification too short | Validation floor is 40 chars — write a real justification |

## Recovery steps
1. List pending: `POST /api/brain/break-glass { action: "list" }`
2. For each stuck request, check who the approver should be
3. If the CO pool is empty, escalate to Board approval
4. **Never** disable the self-approval rejection check — it is the four-eyes contract
5. Audit log at `tierC:break-glass:audit/*` shows every state change
