# brain-outbound-queue (Tier C)

**Owner:** Compliance Officer
**Endpoint:** `POST /api/brain/outbound-queue`
**Schedule:** synchronous (operator-triggered)
**Regulatory anchor:** FDL Art.29 (no tipping off)

## Purpose
Tipping-off-safe queue for every customer-facing message produced by
the brain. Actions:

- `enqueue` — run tipping-off lint, queue if clean
- `release` — CO (not author) releases for delivery
- `cancel` — MLRO cancels
- `pending` — list all messages awaiting release

## Expected healthy state
- `enqueue` returns `lint_failed` on any subject-directed phrase
- `release` is always executed by a CO, never the original author
- Zero auto-released messages

## Common failure modes

| Symptom | First check |
|---|---|
| Message lint-failed unexpectedly | Read the lint output — fix the phrasing or rework the template |
| `release` by the same user as `enqueue` author | Rejected by construction — not a bug |
| Message stuck in `pending_release` for >24h | CO queue backlog — page |
| Lint false-positive | Review the pattern in `tippingOffLinter.ts` and add exceptions |

## Recovery steps
1. List pending: `POST /api/brain/outbound-queue { action: "pending", tenantId }`
2. For each stuck item, investigate why CO hasn't released
3. If a real customer message is being blocked as tipping-off, flag the pattern ID for policy review
4. Never disable the lint — it is the only barrier to an FDL Art.29 breach
