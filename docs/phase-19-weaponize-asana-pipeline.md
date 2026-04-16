# Phase 19 — Weaponize the HAWKEYE → Asana Pipeline

Status: DRAFT for MLRO review
Author: Luisa Fernanda (MLRO) — authored via HAWKEYE agent
Date: 16/04/2026
Scope: `netlify/functions/asana-*`, `src/services/asana/*`,
`asana-workflow/`, Asana MCP integration

---

## 1. Why this phase

Phase 17 added native reasoning capabilities. Phase 18 added
commercial leverage. Phase 19 closes the gap between the brain
producing a verdict and a human acting on it in Asana. The Phase 1
smoke-test pipeline the firm is rehearsing (tenant-a → cust-2 clean
screen → auto-task in HAWKEYE Asana inbox) relies on that gap being
closed. Today it is not fully closed. The subagent audit of
`netlify/functions/asana-*` surfaced six concrete failure modes,
four of which were quick wins (PRs #178, #179, #180, #181 landing
in this same window), leaving the two larger-footprint items for
Phase 19.

## 2. Scope — in

- Per-tenant rate limiting on the Asana API client.
- Tenant project GID resolution for the dispatcher.
- Bidirectional visibility: Asana task status → brain audit trail.
- Self-healing tenant bootstrap.
- Regulatory auto-citation in every generated Asana task description.

## 3. Scope — out

- Anything that sends a message to a customer. That belongs in the
  deferred outbound queue (Tier C), not Asana (asana-workflow/CLAUDE.md
  rule 5).
- Changes to `makeIdempotencyKey()`. The implemented key shape is
  correct; Phase 19 documentation in this workstream only cites it.
- Replacing Asana. Out of scope for this phase.
- Multi-workspace routing. The firm runs one Asana workspace; a
  future phase may split.

## 4. Workstreams (five)

### 4.1 W-A: Per-tenant rate limit on `asanaClient.ts`

**Problem.** `asanaClient.ts` has a 250 ms adaptive delay but no
per-tenant budget. A single tenant with a high-volume event window
can exhaust the workspace-level rate budget and 429 every other
tenant's dispatch until the window resets.

**Change.** Add a token-bucket keyed on tenantId. Refill rate and
burst size are per-tenant constants, overridable via env. Default:
60 requests/minute, burst 10. Enforced inside `asanaQueue.ts` so no
call to `asanaClient.ts` escapes the bucket.

**Regulatory anchor.** FDL No. 10 of 2025 Art.20 — MLRO's view of
the tenant's queue must not be starved by another tenant's activity.

**Blast radius.** Medium. Every Asana dispatch flows through the
same client. A buggy bucket could stall all dispatches.

**Success metric.** Staging load test with two tenants firing 200
dispatches/minute each. Neither tenant sees more than 5% of its
budget consumed by the other. Zero 429 responses returned by Asana.

### 4.2 W-B: Tenant project GID resolution in the dispatcher

**Problem.** `asanaComplianceOrchestrator.ts` returns a
`projectName` string, but the executor needs a project GID. The
browser-side `asana-project-resolver.js` has a hardcoded lookup
table that does not cover every tenant. In practice, a freshly
bootstrapped tenant may hit the dispatcher before the resolver is
updated.

**Change.** Add a server-side resolver `asanaTenantProjectResolver.ts`
that reads from the Netlify Blobs tenant registry, falling back to
`ASANA_DEFAULT_PROJECT_GID`. Wire it into the dispatcher so the
executor receives a GID, not a name. Retire the browser-side
hardcoded map.

**Regulatory anchor.** FDL No. 10 of 2025 Art.20 — MLRO must be
able to see the task on the tenant's queue, not a silently-dropped
dispatch.

**Blast radius.** Medium-high. Every dispatch reads this path.

**Success metric.** Bootstrap a new tenant → fire a test verdict
without updating any hardcoded list → task appears in the new
tenant's project. Zero manual follow-up.

### 4.3 W-C: Bidirectional visibility — Asana task status → brain

**Problem.** When the MLRO completes a four-eyes subtask in Asana,
the event is webhook-delivered to HAWKEYE but the mirroring into
the brain's audit trail is best-effort. A missed webhook leaves the
brain showing a case as "awaiting approval" while Asana already
shows it done. The sync cron catches most of this, but cases held
open for hours before the next cron run cannot be reconstructed
from the audit trail.

**Change.** `asanaStatusReconciler.ts` — runs every 5 minutes,
compares Asana task status against brain case state for every open
case, updates the brain state to match, and writes a reconciliation
row to the audit log. Any mismatch older than 10 minutes raises an
MLRO notification.

**Regulatory anchor.** FDL No. 10 of 2025 Art.20 (MLRO visibility);
Art.24 (10-year retention of reconciliation decisions); Cabinet
Resolution 134/2025 Art.12-14 (four-eyes integrity).

**Blast radius.** Medium. Runs read-mostly but writes to the brain
state on reconciliation.

**Success metric.** 99th-percentile lag from Asana completion to
brain state match is under 10 minutes. Audit log contains a
reconciliation row for every state transition.

### 4.4 W-D: Self-healing tenant bootstrap

**Problem.** Tenant bootstrap is a multi-step workflow (project,
sections, custom fields, webhook, idempotency namespace). Today if
one step fails, the operator has to debug from log fragments and
re-run the whole thing. The bootstrap endpoint is not idempotent in
its fail state.

**Change.** `setup-asana-bootstrap.mts` gains a resumable state
machine. Each step writes its outcome to a per-tenant bootstrap
blob. A re-run reads the blob, skips completed steps, and retries
only what failed. PR #178 already wired the migrate-schema apply
path; PR #180 already validated the webhook origin. This
workstream extends that pattern to the remaining steps (project
create, section create, custom-field env var emission, idempotency
namespace).

**Regulatory anchor.** Cabinet Resolution 134/2025 Art.18 — change
of MLRO arrangements must be notified. Tenant bootstrap is where
that notification lands. A partial bootstrap is not a tolerable
compliance state.

**Blast radius.** Low-medium. Only fires during tenant setup.

**Success metric.** Kill the bootstrap process mid-flight five
times in a row and confirm each re-run lands the tenant in a fully
provisioned state without duplication.

### 4.5 W-E: Regulatory auto-citation in Asana task descriptions

**Problem.** Human reviewers of the Asana compliance program saw
that some tasks have complete regulatory citations in their
descriptions (e.g. the Naples LLC RF-R16 task) and some have
weaker citations (legacy CSV imports). The firm's audit position
is weaker when an inspector picks a random task and finds no
citation.

**Change.** Every brain → Asana dispatch goes through a
`regulatoryCitationEnricher` that appends the canonical citation
block (FDL article, Cabinet resolution, MoE circular, retention
obligation) to the task notes before dispatch. Existing tasks are
left untouched (do not rewrite history); only new dispatches gain
the block. Coverage can be audited by querying for tasks without
the block.

**Regulatory anchor.** FDL No. 10 of 2025 Art.24 (10-year
retention — rollup visibility); Cabinet Resolution 134/2025 Art.19
(internal review — every task must be traceable to its regulatory
source).

**Blast radius.** Low. Read-only prepend, no behavioural change.

**Success metric.** 100% of newly-dispatched tasks contain the
block. Existing tasks are untouched. Audit query returns the
citation for every new task created after go-live.

## 5. Sequencing

1. **Week 1**: W-E (lowest risk, highest audit optics gain).
2. **Week 2**: W-D (builds on PR #178 + #180 already in flight).
3. **Week 3**: W-A (rate limit — requires staging load test).
4. **Week 4**: W-B (tenant project resolution — requires a clean
   tenant registry, which W-D delivers).
5. **Week 5-6**: W-C (reconciler — the biggest footprint; runs last
   to inherit the clean state W-A through W-D produce).

Each workstream ships as a dedicated PR with a regulatory-citation
commit message per CLAUDE.md §8.

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rate-limit bucket stalls all dispatches | Low | High | Stage-ramp rollout; flag-guard behind `ASANA_RATE_LIMIT_ENFORCED` env var. |
| Reconciler mirrors wrong state into brain | Low | High | Idempotent read-write via existing idempotency key; reconciler only moves state forward, never back. |
| Self-healing bootstrap masks a real failure | Medium | Medium | Every step emits a structured audit event; operator dashboard flags tenants in a partial state > 24h. |
| Citation block rewrites existing tasks | Low | Medium | Enricher only runs at dispatch time. Existing tasks are not touched. Regression test covers this. |
| Tenant resolver misroutes a dispatch | Low | Critical | Three-tier fallback (blob registry → env default → hard-fail with audit log). No silent wrong-tenant dispatch. |

## 7. Compliance carve-outs

Per CLAUDE.md compliance carve-outs, these workstreams MUST NOT
compress:

- Reasoning in W-C reconciler audit rows (full narrative of which
  source changed what, with timestamps).
- Regulatory citation block in W-E (full article + retention
  obligation).
- MLRO override reasoning whenever the reconciler applies a state
  change that contradicts the brain's earlier decision.

## 8. What's not Phase 19

- Replacing Asana. Out of scope.
- Multi-workspace routing. The firm runs one Asana workspace; a
  future phase may split.
- Customer-facing messaging. Tier C, not Asana.
- Changes to `makeIdempotencyKey()`. Implemented key shape is
  correct; doc was stale and was corrected by PR #181.

## 9. Approval

This spec is DRAFT. It takes effect only after:

MLRO (Luisa Fernanda) — signature
Compliance Officer — signature
Board representative — signature for Cabinet Resolution 134/2025
  Art.19 internal review sign-off

## 10. Related

- PR #178 — migrate-schema apply path (merged).
- PR #179 — custom-field observability (in flight).
- PR #180 — webhook origin validation (merged).
- PR #181 — IDEMPOTENCY.md doc correction (in flight).

Phase 19 picks up from where this four-PR cluster stops.
