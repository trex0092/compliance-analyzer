# Complete Environment Setup — From Scratch

**For:** the MLRO setting up Hawkeye Sterling V2 + Asana integration from zero.
**Time:** 10 minutes.
**What you'll have at the end:** all 43 environment variables set in Netlify, a local `.env` file, and a one-command smoke test that verifies every integration.

---

## Step 1 — Generate the 3 secrets you need

Run these 3 commands in your local terminal. Copy each output — you'll paste them into Netlify and your local `.env`.

```bash
# Secret A — JWT signing key (for MLRO login tokens)
openssl rand -hex 32

# Secret B — Audit HMAC key (for audit-pack tamper-evidence, FDL Art.24)
openssl rand -hex 32

# Secret C — Bcrypt pepper (extra hash layer for MLRO passwords)
openssl rand -hex 32
```

Each prints a 64-char hex string. Label them A / B / C so you don't mix them up.

If you don't have `openssl`, use: https://generate-random.org/encryption-key-generator → pick "64 hex" → Generate → copy.

---

## Step 2 — Get your Asana PAT

1. Go to https://app.asana.com/0/my-apps
2. Scroll to **Personal Access Tokens** → **+ Create new token**
3. Name it `hawkeye-sterling-v2`
4. Copy the token (starts with `1/`) — Asana only shows it once.

---

## Step 3 — Create `.env` in the repo root

Copy this whole block into a file named `.env` at the repo root (NOT `.env.example`). Replace the `<…>` placeholders with your actual values.

```bash
# ─── Asana — PAT + workspace + 19 projects ────────────────────────────────
ASANA_ACCESS_TOKEN=<your PAT from Step 2, starts with 1/>
ASANA_WORKSPACE_GID=1213645083721316

# 19-project catalog (locked 2026-04-21) — values below are the real GIDs
ASANA_SCREENINGS_PROJECT_GID=1214148660020527
ASANA_CENTRAL_MLRO_PROJECT_GID=1214148631086118
ASANA_AUDIT_LOG_PROJECT_GID=1214148643197211
ASANA_FOUR_EYES_PROJECT_GID=1214148660376942
ASANA_STR_PROJECT_GID=1214148631336502
ASANA_INCIDENTS_PROJECT_GID=1214148643568798
ASANA_CDD_PROJECT_GID=1214148898062562
ASANA_KYC_CDD_TRACKER_PROJECT_GID=1214148898062562
ASANA_TM_PROJECT_GID=1214148661083263
ASANA_COMPLIANCE_TASKS_PROJECT_GID=1214148898610839
ASANA_SHIPMENTS_PROJECT_GID=1214148898360626
ASANA_EMPLOYEES_PROJECT_GID=1214148854421310
ASANA_TRAINING_PROJECT_GID=1214148854927671
ASANA_GOVERNANCE_PROJECT_GID=1214148855187093
ASANA_AI_GOVERNANCE_PROJECT_GID=1214148855187093
ASANA_ROUTINES_PROJECT_GID=1214148910147230
ASANA_WORKBENCH_PROJECT_GID=1214148910059926
ASANA_ESG_LBMA_PROJECT_GID=1214148855758874
ASANA_EXPORT_CONTROL_PROJECT_GID=1214148895117190
ASANA_INSPECTOR_PROJECT_GID=1214148894992036
ASANA_GRIEVANCES_PROJECT_GID=1214148895117145

# ─── Secrets from Step 1 ──────────────────────────────────────────────────
HAWKEYE_JWT_SECRET=<Secret A (64 hex)>
JWT_SIGNING_SECRET=<Secret A again (same value — the code checks either)>
HAWKEYE_AUDIT_HMAC_KEY=<Secret B (64 hex)>
BCRYPT_PEPPER=<Secret C (64 hex)>

# ─── LLM provider ─────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=<your Anthropic API key from console.anthropic.com>

# ─── MLRO login / brain auth ──────────────────────────────────────────────
HAWKEYE_JWT_TTL_SEC=28800
HAWKEYE_BRAIN_TOKEN=<any random 32+ char hex string — your session token>
HAWKEYE_BRAIN_PASSWORD_HASH=<leave empty for now — set when you enable the login wizard>
HAWKEYE_APPROVER_KEYS=<comma-separated approver user IDs, e.g. luisa.fernanda,deputy.mlro>
HAWKEYE_ALERT_EMAIL=<email for CO alerts — e.g. mlro@yourcompany.ae>
HAWKEYE_LOGIN_RATE_LIMIT_DISABLED=false

# ─── CORS / origin policy ─────────────────────────────────────────────────
HAWKEYE_ALLOWED_ORIGIN=https://hawkeye-sterling-v2.netlify.app
PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app

# ─── Cron tenant routing ──────────────────────────────────────────────────
HAWKEYE_CLAMP_CRON_TENANTS=tenant-a
HAWKEYE_DELTA_SCREEN_TENANTS=tenant-a
HAWKEYE_CROSS_TENANT_SALT=<Secret C again — same value as BCRYPT_PEPPER>

# ─── Brain + telemetry ────────────────────────────────────────────────────
BRAIN_RATE_LIMIT_PER_15MIN=150
BRAIN_TELEMETRY_ENABLED=true
ASANA_RECONCILE_LIVE_READS_ENABLED=true

# ─── Optional / upload tokens ─────────────────────────────────────────────
SANCTIONS_UPLOAD_TOKEN=<Secret from openssl rand -hex 32 if you use the manual EOCN upload>
SETUP_MFA_TOTP_SECRET=<32-char base32 string — generate at https://totp.app/generator>
```

Make sure `.env` is **git-ignored** (it is by default in this repo — check `.gitignore`).

---

## Step 4 — Paste the same values into Netlify

1. Go to **Netlify Dashboard → Site `hawkeye-sterling-v2` → Site configuration → Environment variables**.
2. Click **"Import from a .env file"** (top-right button) — saves you 40 separate clicks.
3. Paste the `.env` contents.
4. Click **Import** → **Save**.

Every variable now exists in both places (local `.env` for the smoke test, Netlify for production).

---

## Step 5 — Run the all-in-one smoke test

From the repo root:

```bash
set -a && . ./.env && set +a
npx tsx scripts/smoke-test-all.ts
```

Expected output in under 30 seconds:

```
── ENV VALIDATION ──
  ✅ 41 required env vars present
  ✅ 19 distinct Asana project GIDs (+ 2 aliases pointing at correct project)
  ✅ 3 secrets are 64-char hex
  ✅ ANTHROPIC_API_KEY format valid

── ASANA — GIDs resolve ──
  ✅ Screenings         → Screening — Sanctions & Adverse Media
  ✅ Central MLRO       → Central MLRO — Daily Digest
  ... (20 rows total)

── ASANA — task-create endpoint ──
  ✅ source=workbench    → created + deleted test task
  ✅ source=logistics    → created + deleted test task
  ✅ source=compliance-ops → created + deleted test task
  ✅ source=routines     → created + deleted test task
  ✅ source=screening    → created + deleted test task

── ANTHROPIC — API reachable ──
  ✅ Claude Sonnet 4.6 responds (roundtrip 1.2s)
  ✅ Advisor beta header accepted

── SUMMARY ──
  ✅ 50 checks passed, 0 failed.
  Ready to merge PR #428.
```

If any row is ❌, the script prints the exact env var to fix and the error Asana returned.

---

## Step 6 — Bootstrap the Asana projects (one-time)

Only after smoke test passes 100%:

```bash
# Create workspace custom fields (once per workspace)
npx tsx scripts/asana-cf-bootstrap.ts --apply

# Create canonical sections in every project
npx tsx scripts/asana-modules-bootstrap.ts --no-webhooks --apply

# Subscribe webhooks so Asana syncs back to the tool
npx tsx scripts/asana-modules-bootstrap.ts --no-sections --apply
```

Each is idempotent — re-running is safe.

---

## Step 7 — Merge PR #428 + verify live

1. Merge PR #428 on GitHub.
2. Netlify auto-deploys.
3. Open `https://hawkeye-sterling-v2.netlify.app` → watermark should render on every page.
4. Sign in → go to `/screening-command` → run a screening → click **SEND TO ASANA** → task should appear in the **Screening** Asana project.
5. Click **DRAFT STR** → narrative should stream without the HTTP 400.
6. Click **Four-Eyes — approve** → task should appear in **Four-Eyes Approvals** Asana project.

---

## Troubleshooting quick map

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 401` on any API call | `HAWKEYE_BRAIN_TOKEN` missing or wrong | Set it in both `.env` and Netlify. |
| `HTTP 429` on screening | Rate limit hit | `BRAIN_RATE_LIMIT_PER_15MIN=300` (or higher). |
| `HTTP 503 ASANA_*_PROJECT_GID not configured` | Env var missing in Netlify | Check the variable name exactly; redeploy. |
| Watermark not visible | Browser cached the old 0.07-opacity CSS | Hard-refresh (Ctrl+Shift+R). |
| Smoke test `fetch failed` | Your local machine is offline | Check internet, try again. |
| Asana returns `403 Forbidden` | PAT revoked, or project in a different team | Regenerate PAT; verify `ASANA_WORKSPACE_GID`. |

## Regulatory basis

FDL No.(10)/2025 Art.20-21 (CO visibility), Art.24 (10-year retention), Art.29 (tipping-off) · Cabinet Res 74/2020 Art.4-7 · Cabinet Res 134/2025 Art.19 · Fed Decree-Law 32/2021.
