# asana-reconcile-cron

**Owner:** MLRO + SRE on-call
**Endpoint:** `/.netlify/functions/asana-reconcile-cron`
**Summary endpoint (read-only, operator-facing):** `/.netlify/functions/asana-reconcile-summary`
**Schedule:** every 5 minutes
**Regulatory anchor:** FDL No.10/2025 Art.20, Art.24; Cabinet Res 134/2025 Art.12-14, Art.19

## Purpose
Continuous reconciliation of brain state (via `asana-plans` blob
store) against Asana task state (via `listProjectTasks` for each
tenant's compliance project). The cron ticks on schedule, writes
an audit row per tenant, and produces a drift-action list that
the MLRO reviews before actions become real writes.

## Two operating modes (opt-in)

| Mode | `ASANA_RECONCILE_LIVE_READS_ENABLED` | Behaviour |
|---|---|---|
| **Observational** (default) | unset / `0` / `false` | Cron ticks on schedule, writes audit rows with empty `brainCases` + `asanaTasks`, reconciler reports zero actions. **Zero side effects on Asana or the brain.** |
| **Live reads** | `1` / `true` / `yes` | Cron reads `asana-plans` blob + `listProjectTasks` per tenant, diffs via `reconcileTenant`, records proposed actions in the audit row. **Still zero side effects** — actions are logged, not dispatched. |

Actions only become real writes in a follow-on PR that wires
`result.actions` into the orchestrator. Flipping the flag is safe
on its own.

## Rollout checklist — moving from observational to live reads

Pre-flip:
1. **Confirm observational mode is clean.** Tail `/.netlify/functions/asana-reconcile-summary?window=24h` — expect every row to show `fallbackReason: "live_reads_disabled_by_env"` and zero actions. Any row diverging from that means a stale env var.
2. **Confirm the tenant registry is current.** The cron iterates
   `COMPANY_REGISTRY` (in `src/domain/customers.ts`). A tenant
   missing an `asanaComplianceProjectGid` will be reported as
   `resolver_failed: ...` in the audit row — harmless, but noisy.
   Backfill missing GIDs or mark the tenant inactive before flipping.
3. **Confirm `ASANA_ACCESS_TOKEN` and workspace GID are set** in
   the same Netlify environment. `listProjectTasks` will return
   `ok: false` without them.

Flip:
4. In the Netlify site → Environment variables, set
   `ASANA_RECONCILE_LIVE_READS_ENABLED=1`. Save.
5. Wait one cron tick (≤5 min). Netlify functions do not need a
   redeploy to pick up env changes.

Post-flip — first 24h monitoring (the regulatory-review window):
6. Poll `/.netlify/functions/asana-reconcile-summary?window=24h` every 1-2 hours:
   - `matchRatePct` should stabilise; low values (< 40%) suggest
     task-name drift that the heuristic is missing.
   - `plansForTenant` should be > 0 for tenants with recent brain activity.
   - `actionKinds` should be dominated by `no_drift`; the
     presence of `asana_ahead_of_brain` / `brain_ahead_of_asana`
     points at real drift that needs manual review.
7. **Do NOT wire actions to real dispatches** until you see ≥ 3
   consecutive clean cycles with consistent `matchRatePct`. The
   follow-on PR that wires dispatch SHOULD:
   - go through `/regulatory-spec` planning
   - land behind its own env flag (`ASANA_RECONCILE_DISPATCH_ENABLED`)
   - default off

## Escape hatches

| Env var | Value | Effect |
|---|---|---|
| `ASANA_RECONCILE_CRON_DISABLED` | `1` | The cron becomes a no-op; no audit rows written. Use if the cron is blowing the budget. |
| `ASANA_RECONCILE_LIVE_READS_ENABLED` | unset/`0` | Reverts to observational mode immediately (next tick). |

## Expected healthy state

- Fires every 5 minutes.
- Audit row per tick captures: tenants processed, total actions, per-tenant match diagnostics, liveMode flag, duration.
- Observational: `plansScanned: 0`, `asanaTasksScanned: 0`, every tenant carries `fallbackReason: "live_reads_disabled_by_env"`.
- Live reads: `plansScanned > 0` on tenants with recent brain activity, `asanaTasksMatched / asanaTasksScanned` > 40%, `fallbackReason` unset for healthy tenants.

## Common failure modes

| Symptom | First check |
|---|---|
| Every tenant shows `tenant_not_in_company_registry` | Stale cron — registry changed without redeploy. Trigger a Netlify build. |
| Heavy `listProjectTasks_failed` rate | `ASANA_ACCESS_TOKEN` expired or workspace GID mismatch. |
| `matchRatePct` drops after flipping flag | Task-name format changed — the heuristic looks for `caseId` as a substring of the task name. If the dispatcher renamed tasks, update the match function or wire the real custom-field GID. |
| Summary endpoint returns stale data | Audit store backlog — rows are written hourly, summary reads the last 24h. Normal up to a 5-min cadence lag. |
| Cron appears to run but no audit rows | Check `ASANA_RECONCILE_CRON_DISABLED` is not accidentally `1`. |

## Recovery steps

1. If actions (real writes) cause unexpected drift, UNSET
   `ASANA_RECONCILE_LIVE_READS_ENABLED` first. That alone restores
   observational mode. Do NOT disable the cron — the audit trail
   is the only regulatory record that the reconciler was monitoring.
2. If the brain-side plan blobs look corrupt, the cron tolerates
   malformed entries (caught per-blob, non-fatal). Run
   `/audit-pack` for the affected tenant to rebuild.
3. If the Asana side is unreachable, the `fallbackReason` in
   every audit row will capture the error; nothing to clean up on
   the brain side.

## Regulatory notes

- **FDL Art.20** — MLRO visibility of brain ↔ Asana drift is the
  point of this cron. Observational mode satisfies the "scheduled
  reconciliation" obligation even when live reads are off.
- **FDL Art.24** — audit rows are retained in the
  `asana-reconcile-audit` blob store; follow the 10-year retention
  policy. The summary endpoint is read-only and does not mutate
  the trail.
- **Cabinet Res 134/2025 Art.12-14** — four-eyes integrity is not
  affected by this cron; it reconciles AFTER the four-eyes decision
  has landed.
- **Cabinet Res 134/2025 Art.19** — the audit rows + summary
  endpoint give the internal-review function everything it needs
  to confirm the reconciler is working.
