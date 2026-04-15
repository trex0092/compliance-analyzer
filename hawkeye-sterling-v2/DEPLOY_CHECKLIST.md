# HAWKEYE STERLING V2 — Deploy Checklist

Pre-deployment verification. Run this list before every production
push. The goal is zero surprises in production: every secret, every
blob store, every CSP hash, every cron schedule confirmed before the
build runs.

Skill shortcut: invoke `/deploy-check` to run the automated portions
of this list.

---

## 1. Environment Variables

All env vars live in Netlify project settings (never in code, never
in `.env`, never in `.env.example` with real values).

### Required (build fails without these)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key for advisor strategy |
| `HAWKEYE_BRAIN_TOKEN` | Bearer token for `/api/brain/*` endpoints |
| `HAWKEYE_ALLOWED_ORIGIN` | CORS origin allowlist (comma-separated) |
| `HAWKEYE_CROSS_TENANT_SALT` | Salt for zk cross-tenant attestation (≥16 chars) |
| `ASANA_ACCESS_TOKEN` | Asana personal access token (PAT) for orchestrator |
| `ASANA_WORKSPACE_GID` | Default Asana workspace GID |
| `ASANA_WEBHOOK_SECRET` | Asana webhook X-Hook-Secret echo |
| `NETLIFY_BLOBS_TOKEN` | Auto-injected by Netlify — confirm present |
| `JWT_SIGNING_SECRET` | Signing secret for session tokens |
| `BCRYPT_PEPPER` | Pepper added to bcrypt hashes |

### Optional (degrade gracefully if absent)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_BETA_HEADER` | `advisor-tool-2026-03-01` | Beta header for advisor tool |
| `BRAIN_TELEMETRY_ENABLED` | `true` | Toggle telemetry writes |
| `ASANA_DRY_RUN` | `false` | Force orchestrator into dry-run mode |
| `BRAIN_RATE_LIMIT_PER_15MIN` | `100` | Override default rate limit |

### Validation
Every env var is checked at boot in `src/services/envValidator.ts`.
Missing required vars → app refuses to start. This is intentional —
**fail fast, not in production**.

---

## 2. Blob Stores

The `brain-memory` Netlify Blob store is the single source of truth
for all persistent brain state. Confirm it exists before deploy:

```bash
netlify env:list
netlify blobs:list brain-memory --site $SITE_ID
```

### Prefixes (informational)

| Prefix | Owner | Retention |
|---|---|---|
| `brain:memory:*` | brainMemoryBlobStore | forever |
| `brain:digest:*` | brainMemoryDigestBlobStore | forever |
| `brain:telemetry:*` | brainTelemetryStore | 365 days (rolling) |
| `brain:case-replay:*` | caseReplayStore | forever |
| `brain:evidence:*` | evidenceBundleExporter | 10 years (FDL Art.24) |
| `tierC:*` | tierCBlobStores | forever |
| `asana:idem:*` | orchestrator | 30 days |
| `asana:dead-letter:*` | asanaQueue | until drained |

Never delete a prefix in production. If you need to migrate, copy +
verify + leave the old data in place.

---

## 3. Content Security Policy

Inline scripts in `index.html` and `regulator-portal.html` are
sha256-hashed and listed in `netlify.toml`. If you change inline
script content, the hash must be regenerated.

```bash
# Regenerate inline script hashes
npm run csp:rehash
```

The script writes the new hashes to `netlify.toml` under
`[[headers]] Content-Security-Policy`. Commit the change.

### Headers shipped

| Header | Source |
|---|---|
| `Content-Security-Policy` | `netlify.toml` headers block |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

---

## 4. Secrets Scanning

Netlify runs a secrets scan on every deploy. Allowlist for known
non-secret paths lives in `netlify.toml`:

```toml
[build.environment]
SECRETS_SCAN_OMIT_PATHS = "vendor/**,graphify-out/**,node_modules/**,reports/**"
```

If the scan fails on a real secret → **never** add the path to the
allowlist. Rotate the secret, remove it from git history, and start
over.

---

## 5. Hooks

| Hook | Path | Purpose |
|---|---|---|
| `pre-commit-security` | `.git/hooks/pre-commit` | Blocks commits with hardcoded secrets, eval(), unsafe patterns |
| `session-start` | `~/.claude/hooks/session-start.sh` | Auto-rebuilds the code-review-graph on session start |

Never run `git commit --no-verify`. If a hook fails, fix the cause.

---

## 6. Cron Schedules

Netlify Scheduled Functions configured in `netlify.toml`:

| Function | Schedule | Purpose |
|---|---|---|
| `brain-clamp-cron` | `0 * * * *` | Hourly clamp suggestion generation |
| `asana-sync-cron` | `0 * * * *` | Hourly brain ↔ Asana reconciliation |
| `asana-retry-queue-cron` | `*/15 * * * *` | Drain dead-letter queue every 15min |
| `asana-weekly-digest-cron` | `0 9 * * MON` | Monday 9am digest comment per case |
| `asana-weekly-customer-status-cron` | `0 10 * * MON` | Monday 10am customer status roll-up |
| `asana-super-brain-autopilot-cron` | `0 8 * * MON-FRI` | Daily 8am Tier B autopilot |

After deploy, confirm crons are registered:

```bash
netlify functions:list --site $SITE_ID | grep cron
```

---

## 7. Branch Protection

`main` branch protection rules on GitHub:

- Require pull request before merging
- Require status checks to pass: `vitest`, `tsc`, `eslint`, `csp-hash`
- Require branches to be up to date before merging
- Require linear history
- Do not allow bypassing the above settings
- Restrict force-pushes (admin only, with reason)

---

## 8. Pre-Deploy Quality Gate

Run before every `git push origin main`:

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Unit tests
npm run test

# CSP hash check
npm run csp:check

# Build
npm run build
```

All five must be green. If any fail, **do not push**. Investigate the
root cause per CLAUDE.md §9.

---

## 9. Post-Deploy Smoke Tests

After Netlify reports a successful deploy, run the smoke suite:

```bash
BASE_URL=https://hawkeye-sterling-v2.netlify.app \
  npm run smoke
```

The smoke suite hits:

- `GET /` — index loads, CSP headers present
- `POST /api/brain/diagnostics` — brain reachable
- `POST /api/brain/telemetry` — blob store reachable
- `POST /api/asana-simulate` — orchestrator reachable

A red smoke test means rollback. Use `netlify rollback` and open an
incident.

---

## 10. Rollback Procedure

```bash
# Identify the last good deploy
netlify deploy:list --site $SITE_ID | head -5

# Rollback
netlify rollback --site $SITE_ID --deploy <good-deploy-id>

# Verify
curl -fsSL https://hawkeye-sterling-v2.netlify.app/ > /dev/null
```

Rollback never resets blob state — only the function code. So a
rollback is safe even mid-cron, as long as the function signatures
are backward-compatible (which the schema migrator enforces).

---

## 11. Incident Log

Every production incident generates a record in
`brain:incident-log:*` automatically (via the auto-remediation
executor). After the incident is resolved, file a post-mortem:

```bash
/incident-postmortem <incident-id>
```

The post-mortem skill writes a markdown report under `reports/` with
timeline, root cause, fix, and prevention. This goes in front of the
MLRO at the next quarterly review.

---

## Sign-off

Deploy is good when:

- [ ] All env vars present and validated
- [ ] Blob stores reachable
- [ ] CSP hashes regenerated and committed
- [ ] Secrets scan green
- [ ] Hooks installed
- [ ] Cron schedules registered
- [ ] Branch protection enforced
- [ ] Quality gate green (5 / 5)
- [ ] Smoke suite green (4 / 4)
- [ ] Rollback path tested in staging this quarter

If any box is unchecked, do not deploy.
