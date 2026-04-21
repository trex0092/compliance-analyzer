# Asana bootstrap — operator runbook

You (the MLRO) run these commands locally with your Personal Access Token.
The Claude Code sandbox is blocked from `app.asana.com` (`403 host_not_allowed`),
so these cannot be run from the AI session — they have to go through your
terminal.

**Canonical workspace:** `1213645083721316` (HAWKEYE STERLING V2 team).
**Prerequisite:** the 19 projects from the MLRO catalog are already created
(see `docs/asana-workflow-spec.md`) and their GIDs are in `.env`.

---

## 0. Environment

```bash
# One-time — create .env in the repo root (git-ignored).
# Copy this block, fill in ASANA_TOKEN, commit nothing.
export ASANA_TOKEN=<your Personal Access Token from app.asana.com/0/my-apps>
export ASANA_WORKSPACE_GID=1213645083721316
export PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app

# Plus every ASANA_*_PROJECT_GID value — the smoke-test script requires
# them loaded into your shell. The .env.example in the repo has the
# full list already populated after PR #428.
set -a && . ./.env && set +a
```

Verify with:
```bash
npx tsx scripts/asana-smoke-test.ts
```
Expect **20 ✅** rows (19 distinct projects + 1 KYC-tracker alias on the same GID as CDD).

---

## 1. Custom fields (workspace-level, one-time)

Creates the 11 compliance custom fields on the workspace. These fields are
shared across every project in the workspace — run once per workspace.

```bash
# Dry run first
npx tsx scripts/asana-cf-bootstrap.ts --dry-run

# Apply
npx tsx scripts/asana-cf-bootstrap.ts --apply
```

Output: a block of `ASANA_CF_*_GID=` lines. Paste them back into `.env.example`
(under the existing `# Asana custom field GIDs` section) and into Netlify
Site → Environment Variables.

**Why this matters:** custom fields drive cross-project rollups (risk level,
verdict, deadline type, days remaining, confidence, regulation citation,
customer name, jurisdiction, UBO count, PEP flag, case id). Without them,
Asana can render tasks but cannot filter/sort by compliance attributes.

---

## 2. Sections — the 19 MLRO module projects

Creates the canonical section layout on each of the 19 projects. The section
names per project live in `src/services/asanaModuleProjects.ts` — each `ModuleProjectSpec.sections[]`.

```bash
# Dry run — lists what it would create per project
npx tsx scripts/asana-modules-bootstrap.ts --no-webhooks

# Apply sections only (no webhooks yet)
npx tsx scripts/asana-modules-bootstrap.ts --no-webhooks --apply
```

Idempotent — skips any section that already exists by name. Re-running is safe.

**Why this matters:** without the sections, the Kanban view collapses every
task into one column. The dispatcher also writes tasks into a named section
(e.g. `Awaiting Four-Eyes`, `Freeze Executed`) which silently no-ops if the
section does not exist.

---

## 3. Webhooks — the 19 MLRO module projects

Subscribes one Asana webhook per project pointing at
`/api/asana/webhook?workspaceGid=<gid>`. The receiver function handles the
X-Hook-Secret handshake and HMAC verification.

```bash
# Dry run
npx tsx scripts/asana-modules-bootstrap.ts --no-sections

# Apply webhooks only
npx tsx scripts/asana-modules-bootstrap.ts --no-sections --apply
```

Or run both phases together:

```bash
npx tsx scripts/asana-modules-bootstrap.ts --apply
```

**Why this matters:** webhooks are the one-way flow Asana uses to sync
task-state changes back into the tool. Without them, every "MLRO completes
task in Asana" event never reaches the `auditChain` — you lose the
bi-directional sync that the `asanaBidirectionalSync` service depends on.

---

## 4. Per-customer projects (different flow — not the 19 catalog)

The existing `scripts/asana-section-bootstrap.ts` and
`scripts/asana-webhook-bootstrap.ts` iterate `COMPANY_REGISTRY` (per-customer
projects, one per counterparty) — that is a DIFFERENT flow from the 19
module catalog above. Run them only if you use per-customer projects:

```bash
npx tsx scripts/asana-project-bootstrap.ts --apply
```

That orchestrator runs CF → sections → webhooks against `COMPANY_REGISTRY`.
Skip this whole section if you only use the 19-project module catalog.

---

## 5. Smoke test after all 3 phases

```bash
npx tsx scripts/asana-smoke-test.ts
```

Then pick one project (e.g. Screening), go to it in Asana, confirm:
- Sections exist in the expected order.
- Custom fields appear on the first task you create.
- Task status changes in Asana appear in the tool's audit trail
  (check `auditChain` blob via the regulator portal or MLRO digest).

If any check fails, the receiver logs are in the Netlify function logs
under `asana-webhook` — look for "HMAC mismatch", "handshake missing", or
"project_gid unknown" to triage.

---

## Regulatory basis

FDL No.(10)/2025 Art.20-21, Art.24 · Cabinet Res 134/2025 Art.19 ·
Cabinet Res 74/2020 Art.4-7 · CLAUDE.md §8 citation discipline.
