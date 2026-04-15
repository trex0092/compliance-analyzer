# ASANA WORKFLOW — Setup Checklist

End-to-end checklist for setting up Asana for a new tenant.

Skill shortcut: `/asana-bootstrap <tenant-id>` provisions everything
below in one call (or run the steps manually).

---

## 1. Asana side — workspace + project + sections

### Workspace

You need an Asana **workspace** GID. Existing operators reuse the
firm-wide workspace. New deployments create a workspace via the
Asana web UI (no API support).

```bash
export ASANA_WORKSPACE_GID="1234567890123456"
```

### Project (auto-provision per tenant)

Each tenant gets a dedicated project under the workspace, named
`HAWKEYE — <tenant-id>`. The project is created via the bootstrap
script:

```bash
node scripts/asana-project-bootstrap.ts \
  --tenant tenant-a \
  --workspace $ASANA_WORKSPACE_GID
```

The script:

1. POSTs to `/api/1.0/projects` with the project name, layout
   (`board`), and color (consistent per tenant)
2. Stores the project GID in `asana:tenant:<tenant-id>:project_gid`
3. Returns the project GID for downstream steps

If the project already exists (idempotent re-run), the script
verifies and exits clean.

### Sections (auto-provision per project)

Each project gets the standard section list:

| Section | Purpose |
|---|---|
| `Inbox` | New brain verdicts land here |
| `Pending CO Review` | CO triage queue |
| `Pending Four-Eyes` | Four-eyes pair queue |
| `Pending MLRO Review` | MLRO escalation queue |
| `EOCN Freeze Required` | 24h clock SLA |
| `CNMR Filing Required` | 5BD SLA |
| `STR Filing Required` | "without delay" SLA |
| `DPMSR Filing Required` | 15BD SLA |
| `UBO Re-verification` | 15WD SLA |
| `Awaiting External Reply` | Pause section |
| `Customer Information Requested` | Pause section |
| `On Hold by MLRO` | Pause section |
| `ESCALATED` | Auto-escalation destination |
| `Closed` | Terminal section |

```bash
node scripts/asana-section-bootstrap.ts --project $PROJECT_GID
```

Idempotent — only adds missing sections, never deletes.

---

## 2. Custom fields (auto-provision per workspace)

Custom fields are workspace-level in Asana. The schema migrator
creates them once per workspace and reuses across projects:

```bash
node scripts/asana-cf-bootstrap.ts --workspace $ASANA_WORKSPACE_GID
```

Fields created:

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
| `Four-Eyes Role` | enum | four-eyes creator |
| `Four-Eyes Trigger` | text | four-eyes creator |
| `Four-Eyes Decision` | enum | four-eyes creator |
| `Four-Eyes Decision At` | date | four-eyes creator |

The migrator is idempotent and safe to re-run on every deploy.

---

## 3. Webhooks (per project)

Each project needs a webhook pointing at our webhook receiver:

```bash
node scripts/asana-webhook-bootstrap.ts \
  --project $PROJECT_GID \
  --target https://compliance-analyzer.netlify.app/api/asana-webhook
```

The bootstrap script:

1. POSTs to `/api/1.0/webhooks`
2. Echoes the X-Hook-Secret on first delivery
3. Stores the secret under `asana:webhook-secret:<project-gid>`
4. Verifies a test event arrives within 30 seconds
5. Returns the webhook GID

If the webhook already exists, the script verifies the target URL
matches and exits clean.

---

## 4. Inspector project (one-time per workspace)

Auditors need a read-only project that aggregates all tenants. The
inspector bootstrap creates this:

```bash
node scripts/asana-inspector-project-bootstrap.ts \
  --workspace $ASANA_WORKSPACE_GID
```

The inspector project has the same sections as a tenant project but
its tasks are **shadow copies** synced by the
`asana-weekly-customer-status-cron`. The originals stay in the
tenant projects; the shadows give auditors a single pane of glass.

---

## 5. Environment variables

Required in Netlify project settings:

| Variable | Source |
|---|---|
| `ASANA_ACCESS_TOKEN` | Asana PAT, generated via Asana web UI |
| `ASANA_WORKSPACE_GID` | Step 1 above |
| `ASANA_INSPECTOR_PROJECT_GID` | Step 4 above |
| `HAWKEYE_BRAIN_TOKEN` | Internal brain API token |
| `NETLIFY_BLOBS_TOKEN` | Auto-injected |

Validation:

```bash
node scripts/asana-env-check.ts
```

Validates token validity, workspace access, and project visibility.
Fails fast with a clear message if any var is missing or invalid.

---

## 6. Cron registration

The crons live in `netlify.toml`:

```toml
[functions."asana-sync-cron"]
schedule = "0 * * * *"

[functions."asana-retry-queue-cron"]
schedule = "*/15 * * * *"

[functions."asana-weekly-digest-cron"]
schedule = "0 9 * * MON"

[functions."asana-weekly-customer-status-cron"]
schedule = "0 10 * * MON"

[functions."asana-super-brain-autopilot-cron"]
schedule = "0 8 * * MON-FRI"
```

After deploy, verify they're registered:

```bash
netlify functions:list --site $SITE_ID | grep cron
```

---

## 7. Smoke test

Once everything is provisioned, run the smoke test:

```bash
BASE_URL=https://compliance-analyzer.netlify.app \
TENANT_ID=tenant-a \
  npm run smoke:asana
```

The smoke suite:

1. POSTs a fake brain verdict to `/api/asana-simulate` (dry-run)
2. POSTs a real brain verdict to `/api/brain/analyze` and asserts a
   task lands in the tenant project
3. Adds a comment `/screen test-subject` and asserts a reply lands
4. Marks the task complete and asserts the case closes in brain

Any red step → rollback the bootstrap and investigate.

---

## 8. Per-tenant onboarding script (one-shot)

For a brand-new tenant, run the all-in-one bootstrap:

```bash
TENANT_ID=tenant-a \
  bash scripts/asana-onboard-tenant.sh
```

This wraps steps 1-7 above into a single command with safety checks.
Idempotent — safe to re-run if a step fails partway through.

---

## 9. Sign-off

Tenant Asana setup is good when:

- [ ] Project `HAWKEYE — <tenant-id>` created
- [ ] All standard sections present
- [ ] Workspace custom fields present (15 / 15)
- [ ] Webhook handshake successful
- [ ] Inspector shadow visible
- [ ] Env vars validated
- [ ] Crons registered
- [ ] Smoke test green (4 / 4)
- [ ] First test brain verdict landed in Inbox

If any box is unchecked, **do not start onboarding customers** for
that tenant. The four-eyes contract relies on every one of these
being in place.

---

## 10. Rollback

If a tenant needs to be removed:

1. Suspend the cron entries for the tenant (do not delete — they're
   shared)
2. Move all open cases to `Closed` section
3. Snapshot the project for retention via `asana-project-snapshot.ts`
4. Archive the project in Asana (do not delete — Asana cannot
   un-delete)
5. Mark the tenant as `archived` in `asana:tenant:<id>:status`
6. Retain audit logs for 10 years per FDL Art.24

Never delete a tenant's data. Archive only.
