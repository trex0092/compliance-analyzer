# HAWKEYE STERLING V2 — Tier C Safe Equivalents Guide

Tier C is the layer of subsystems that have been **deliberately
de-fanged** so they cannot create regulatory liability. Each one is
the *safe equivalent* of a more aggressive feature that an outside
contributor might propose. The rule: never let the brain take an
action the regulator can punish without a human in the loop.

---

## 1. Clamp Suggestion Log

**File:** `src/services/clampSuggestionLog.ts`
**Generator:** `src/services/clampSuggestionGenerator.ts`
**Endpoint:** `POST /api/brain/clamp-suggestion`
**Cron:** `netlify/functions/brain-clamp-cron.mts` (hourly)
**Anchor:** NIST AI RMF GOVERN-4

### What the unsafe version would do
Auto-tune the regulatory thresholds (sanctions match minimum, STR
trigger floor, structuring percentage) based on observed false-positive
rates. **This is illegal.** The thresholds are regulatory constants;
only the regulator can move them.

### What Tier C does instead
The hourly cron reads telemetry, computes confusion-matrix metrics
(TP / FP / FN / TN), and writes a *suggestion* to the blob store
with proposed clamp value, evidence, and reasoning. The MLRO reviews
the suggestion via the Brain Console UI and either accepts or rejects
it. **Accepting a suggestion creates an audit log entry, but does
NOT change `src/domain/constants.ts`.** The MLRO must still open a
PR and update the constant by hand, with a regulatory citation.

### Lifecycle
```
generated → pending_mlro_review → accepted | rejected | expired
```

### Status filters
- `pending_mlro_review` — needs MLRO action
- `accepted` — MLRO approved (still needs PR)
- `rejected` — MLRO declined
- `expired` — older than 14 days, no decision

---

## 2. Deferred Outbound Queue

**File:** `src/services/deferredOutboundQueue.ts`
**Endpoint:** `POST /api/brain/outbound-queue`
**Anchor:** FDL Art.29 (no tipping off), EU GDPR Art.25

### What the unsafe version would do
Auto-send a customer-facing message (email, SMS, in-app notification)
when the brain produces a verdict. **This is the textbook tipping-off
violation under FDL Art.29.** A confirmed sanctions match must never
result in the subject finding out.

### What Tier C does instead
Every outbound message is **enqueued**, not sent. The
`tippingOffLinter` runs on the message subject + body before enqueue;
if it matches any tipping-off phrase, the message is rejected with
status `lint_failed`. If lint passes, the message goes to
`pending_release` and waits for an explicit `release` action from a
human user. The brain itself **cannot** call `release`. There is no
auto-release timer. The CO must release.

### Lifecycle
```
enqueue → lint_failed | pending_release → released | cancelled
```

### What never gets enqueued
- Anything mentioning the words: "STR", "SAR", "freeze", "sanctions",
  "investigation", "EOCN", "FIU", "report", "suspicious"
- Anything addressed to a subject of an active STR / freeze case
- Anything during a 24-hour cool-down after a brain verdict

---

## 3. Break-Glass Override

**File:** `src/services/breakGlassOverride.ts`
**Endpoint:** `POST /api/brain/break-glass`
**Anchor:** Cabinet Res 134/2025 Art.12-14, NIST AI RMF MANAGE-3

### What the unsafe version would do
Allow a single user to override the brain's verdict with a click.
**This breaks the four-eyes principle and exposes the firm to
collusion / single-point-of-failure attacks.**

### What Tier C does instead
Two-person workflow:

1. **Request** — user A submits an override request with from-verdict,
   to-verdict, justification (≥40 chars), and a regulatory citation.
   Status becomes `pending_approval`.
2. **Approve** — user B (must be different from user A) approves.
   Self-approval is rejected with HTTP 400. Status becomes `approved`.
3. **Side effect** — on approval, the orchestrator fire-and-forgets a
   dispatch to the Asana CO queue so the execution task lands on a
   real human's plate with the full audit context.

The brain verdict in the case file is **not** mutated. The override
is a separate audit record that supersedes the verdict at decision
time but never erases it.

### Lifecycle
```
request → pending_approval → approved | rejected | expired (24h)
```

---

## 4. zk Cross-Tenant Attestation

**File:** `src/services/zkCrossTenantAttestation.ts`
**Endpoint:** `POST /api/brain/zk-cross-tenant`
**Anchor:** FDL Art.14, EU GDPR Art.25

### What the unsafe version would do
Share customer identifiers across tenants to detect cross-tenant
sanctions collisions. **This violates GDPR Art.25 (data minimisation)
and FDL Art.14 (customer confidentiality).**

### What Tier C does instead
Each tenant computes a salted hash of the customer key + day stamp +
list name and **commits** the hash to a shared blob. The hash is
constructed with `HAWKEYE_CROSS_TENANT_SALT` (≥16 chars, rotated
quarterly per FIU circular). Only the hash is shared — no PII, no
list payload, no transaction data.

The aggregator endpoint counts hashes per `subjectKey + tsDay + list`
combination. If the count is ≥ k (k-anonymity threshold), it returns
the count without revealing which tenants contributed. Below k, it
returns `under_threshold` with the count suppressed.

### Lifecycle
```
commit (per tenant) → aggregate (read-only, k-anonymous)
```

### Why this is safe
- No tenant learns which other tenants observed the same subject.
- The salt rotation prevents long-term correlation across versions.
- The k threshold prevents re-identification when only 1-2 tenants
  share a hash (which would otherwise be deanonymising).

---

## 5. Tier C Blob Stores

**File:** `src/services/tierCBlobStores.ts`
**Anchor:** FDL Art.24 (10-year retention)

All Tier C state lives in Netlify Blobs under the `brain-memory` store
with these prefixes:

| Prefix | What |
|---|---|
| `tierC:clamp-suggestion:*` | Clamp suggestion records |
| `tierC:outbound-queue:*` | Outbound queue records |
| `tierC:break-glass:*` | Break-glass requests |
| `tierC:zk-cross-tenant:commit:*` | Cross-tenant hash commits |
| `tierC:zk-cross-tenant:salt:*` | Salt version registry |

Retention: forever. These are audit records — never delete, never
overwrite, never compress with loss.

---

## How to add a new Tier C subsystem

1. Identify the unsafe version someone would propose. Write it down.
2. Identify the regulatory liability the unsafe version creates.
   Cite the Article.
3. Design the safe equivalent: human-in-the-loop, two-person, or
   commit-only.
4. Implement in `src/services/<name>.ts`.
5. Wire to a `netlify/functions/brain-<name>.mts` endpoint with rate
   limiting (10 / 15min for break-glass, 100 / 15min otherwise) and
   strict input validation.
6. Add tests covering: happy path, lint failure, self-approval
   rejection, k-anonymity floor, and lifecycle expiry.
7. Add a section to this file.
8. Add a row to `BRAIN_INVENTORY.md` under "Tier C".
9. Commit with citation per CLAUDE.md §8.

The Tier C principle is non-negotiable: **the brain proposes, a human
disposes.** Anything that mutates regulatory state, sends a customer
message, or overrides a verdict needs a human in the loop.
