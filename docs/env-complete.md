# Environment Setup — The Locked 67

**For:** the MLRO deploying Hawkeye Sterling V2.
**Locked:** 2026-04-21. These 67 variables are the canonical set — nothing more.
**Time:** 10 minutes from scratch.

---

## Step 1 — Generate 6 secrets

Run these commands once. Copy each output, label them A-F.

```bash
openssl rand -hex 32   # A → HAWKEYE_JWT_SECRET (+ JWT_SIGNING_SECRET, same value)
openssl rand -hex 32   # B → HAWKEYE_AUDIT_HMAC_KEY
openssl rand -hex 32   # C → BCRYPT_PEPPER (+ HAWKEYE_CROSS_TENANT_SALT, same value)
openssl rand -hex 32   # D → ASANA_WEBHOOK_SECRET
openssl rand -hex 32   # E → HAWKEYE_REGULATOR_MASTER_KEY
openssl rand -hex 32   # F → SANCTIONS_UPLOAD_TOKEN (+ HAWKEYE_BRAIN_TOKEN, same value)
```

No openssl? Use https://generate-random.org/encryption-key-generator → 64 hex → Generate.

---

## Step 2 — Get tokens + IDs

| Source | Value |
|---|---|
| **Asana PAT** | app.asana.com/0/my-apps → + Create new token → copy (starts with `1/`) |
| **Asana Team GID** | Open HAWKEYE STERLING V2 team → URL `app.asana.com/0/<team-gid>/overview` |
| **Anthropic key** | console.anthropic.com → API keys → Create |
| **Tavily key** | tavily.com (free tier) |
| **SerpAPI key** | serpapi.com (free tier) |
| **Brave Search key** | api.search.brave.com (free tier) |
| **TOTP secret** | totp.app/generator → 32 base32 chars |
| **bcrypt hash** | https://bcrypt-generator.com (hash your MLRO password) |

---

## Step 3 — Create `.env` — the exact 67 vars

Paste this block into `.env` in the repo root. Replace `<…>` placeholders. GIDs are pre-filled with real values.

```bash
# ─── LLM + Asana core ────────────────────────────────────────────────────
ANTHROPIC_API_KEY=<your Anthropic API key>
ASANA_ACCESS_TOKEN=<your Asana PAT, starts with 1/>
ASANA_WORKSPACE_GID=1213645083721316
ASANA_TEAM_GID=<HAWKEYE STERLING V2 team GID>

# ─── 19-project catalog (+ 2 aliases) ────────────────────────────────────
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
ASANA_RECONCILE_LIVE_READS_ENABLED=true
ASANA_INSPECTOR_TEAM_GID=

# ─── Optional Asana knobs ───────────────────────────────────────────────
ASANA_SECTION_SCREENINGS_NAME=
ASANA_WEBHOOK_SECRET=<Secret D (64 hex)>

# ─── URLs / CORS ────────────────────────────────────────────────────────
PUBLIC_BASE_URL=https://hawkeye-sterling-v2.netlify.app
HAWKEYE_ALLOWED_ORIGIN=https://hawkeye-sterling-v2.netlify.app
HAWKEYE_BRAIN_URL=

# ─── Secrets ────────────────────────────────────────────────────────────
HAWKEYE_JWT_SECRET=<Secret A>
JWT_SIGNING_SECRET=<Secret A — same value>
HAWKEYE_JWT_TTL_SEC=28800
BCRYPT_PEPPER=<Secret C>
HAWKEYE_CROSS_TENANT_SALT=<Secret C — same value>
HAWKEYE_AUDIT_HMAC_KEY=<Secret B>
HAWKEYE_BRAIN_TOKEN=<Secret F>
HAWKEYE_BRAIN_PASSWORD_HASH=<bcrypt hash of MLRO password>
HAWKEYE_APPROVER_KEYS=luisa.fernanda,deputy.mlro
HAWKEYE_ALERT_EMAIL=<mlro@yourcompany.ae>
HAWKEYE_LOGIN_RATE_LIMIT_DISABLED=false
SANCTIONS_UPLOAD_TOKEN=<Secret F — same value>
SETUP_MFA_TOTP_SECRET=<32 base32 chars>

# ─── Reporting entity (required for goAML XML) ──────────────────────────
REPORTING_ENTITY_NAME=<your DPMS legal name>
REPORTING_ENTITY_LICENCE=<your MoE licence number>

# ─── Brain / telemetry ──────────────────────────────────────────────────
BRAIN_RATE_LIMIT_PER_15MIN=150
BRAIN_TELEMETRY_ENABLED=true

# ─── Cron routing ───────────────────────────────────────────────────────
HAWKEYE_CLAMP_CRON_TENANTS=tenant-a
HAWKEYE_DELTA_SCREEN_TENANTS=tenant-a

# ─── Production flags ───────────────────────────────────────────────────
SCHEDULED_SCREENING_DRY_RUN=false
SCHEDULED_SCREENING_OFFLINE=false
REGULATORY_WATCH_OFFLINE=false
CONTINUOUS_MONITOR_DISPATCH_ASANA=true
LOG_LEVEL=info

# ─── Adverse-media search (3 providers for redundancy) ──────────────────
TAVILY_API_KEY=<tavily.com>
SERPAPI_KEY=<serpapi.com>
BRAVE_SEARCH_API_KEY=<api.search.brave.com>

# ─── Regulator portal ───────────────────────────────────────────────────
HAWKEYE_REGULATOR_MASTER_KEY=<Secret E>
HAWKEYE_REGULATOR_CODE_TTL_MINUTES=60
HAWKEYE_INSPECTOR_KEYS=

# ─── Solo-MLRO mode ─────────────────────────────────────────────────────
HAWKEYE_SOLO_MLRO_MODE=false
HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS=4

# ─── Sanctions proxy (optional) ─────────────────────────────────────────
HAWKEYE_SANCTIONS_PROXY_URL=

# ─── Status page (optional) ─────────────────────────────────────────────
CACHET_API_TOKEN=
CACHET_BASE_URL=
```

Ensure `.env` is in `.gitignore`.

---

## Step 4 — Paste into Netlify

Site config → Environment variables → **"Import from a .env file"** → paste the whole block → Import → Save.

---

## Step 5 — Run the smoke test

```bash
set -a && . ./.env && set +a
npx tsx scripts/smoke-test-all.ts
```

Expect all 67 vars present, 21 Asana GIDs resolve, 5 task-endpoint posts succeed, Anthropic roundtrip OK.

---

## Step 6 — Bootstrap Asana (one-time)

```bash
npx tsx scripts/asana-cf-bootstrap.ts --apply
npx tsx scripts/asana-modules-bootstrap.ts --apply
```

---

## Step 7 — Merge PR #428

Netlify auto-deploys. Test the 3 flows: screen → DRAFT STR → SEND TO ASANA.

---

## The locked 67 — complete list

| # | Variable |
|---|---|
| 1 | ANTHROPIC_API_KEY |
| 2 | ASANA_ACCESS_TOKEN |
| 3 | ASANA_WORKSPACE_GID |
| 4 | ASANA_SCREENINGS_PROJECT_GID |
| 5 | ASANA_CENTRAL_MLRO_PROJECT_GID |
| 6 | ASANA_AUDIT_LOG_PROJECT_GID |
| 7 | ASANA_FOUR_EYES_PROJECT_GID |
| 8 | ASANA_STR_PROJECT_GID |
| 9 | ASANA_INCIDENTS_PROJECT_GID |
| 10 | ASANA_CDD_PROJECT_GID |
| 11 | ASANA_KYC_CDD_TRACKER_PROJECT_GID |
| 12 | ASANA_TM_PROJECT_GID |
| 13 | ASANA_COMPLIANCE_TASKS_PROJECT_GID |
| 14 | ASANA_SHIPMENTS_PROJECT_GID |
| 15 | ASANA_EMPLOYEES_PROJECT_GID |
| 16 | ASANA_TRAINING_PROJECT_GID |
| 17 | ASANA_GOVERNANCE_PROJECT_GID |
| 18 | ASANA_AI_GOVERNANCE_PROJECT_GID |
| 19 | ASANA_ROUTINES_PROJECT_GID |
| 20 | ASANA_WORKBENCH_PROJECT_GID |
| 21 | ASANA_ESG_LBMA_PROJECT_GID |
| 22 | ASANA_EXPORT_CONTROL_PROJECT_GID |
| 23 | ASANA_INSPECTOR_PROJECT_GID |
| 24 | ASANA_GRIEVANCES_PROJECT_GID |
| 25 | ASANA_RECONCILE_LIVE_READS_ENABLED |
| 26 | PUBLIC_BASE_URL |
| 27 | HAWKEYE_ALLOWED_ORIGIN |
| 28 | HAWKEYE_JWT_SECRET |
| 29 | JWT_SIGNING_SECRET |
| 30 | HAWKEYE_JWT_TTL_SEC |
| 31 | BCRYPT_PEPPER |
| 32 | HAWKEYE_CROSS_TENANT_SALT |
| 33 | HAWKEYE_BRAIN_TOKEN |
| 34 | HAWKEYE_BRAIN_PASSWORD_HASH |
| 35 | HAWKEYE_APPROVER_KEYS |
| 36 | HAWKEYE_ALERT_EMAIL |
| 37 | HAWKEYE_CLAMP_CRON_TENANTS |
| 38 | HAWKEYE_DELTA_SCREEN_TENANTS |
| 39 | HAWKEYE_LOGIN_RATE_LIMIT_DISABLED |
| 40 | SANCTIONS_UPLOAD_TOKEN |
| 41 | SETUP_MFA_TOTP_SECRET |
| 42 | BRAIN_RATE_LIMIT_PER_15MIN |
| 43 | BRAIN_TELEMETRY_ENABLED |
| 44 | HAWKEYE_AUDIT_HMAC_KEY |
| 45 | ASANA_WEBHOOK_SECRET |
| 46 | REPORTING_ENTITY_NAME |
| 47 | REPORTING_ENTITY_LICENCE |
| 48 | ASANA_TEAM_GID |
| 49 | SCHEDULED_SCREENING_DRY_RUN |
| 50 | SCHEDULED_SCREENING_OFFLINE |
| 51 | REGULATORY_WATCH_OFFLINE |
| 52 | CONTINUOUS_MONITOR_DISPATCH_ASANA |
| 53 | TAVILY_API_KEY |
| 54 | SERPAPI_KEY |
| 55 | BRAVE_SEARCH_API_KEY |
| 56 | HAWKEYE_REGULATOR_MASTER_KEY |
| 57 | HAWKEYE_REGULATOR_CODE_TTL_MINUTES |
| 58 | HAWKEYE_INSPECTOR_KEYS |
| 59 | HAWKEYE_SOLO_MLRO_MODE |
| 60 | HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS |
| 61 | HAWKEYE_SANCTIONS_PROXY_URL |
| 62 | ASANA_SECTION_SCREENINGS_NAME |
| 63 | LOG_LEVEL |
| 64 | ASANA_INSPECTOR_TEAM_GID |
| 65 | CACHET_API_TOKEN |
| 66 | CACHET_BASE_URL |
| 67 | HAWKEYE_BRAIN_URL |

---

## Regulatory basis

FDL No.(10)/2025 Art.20-21 (CO visibility), Art.24 (10-year retention), Art.26-27 (STR filing), Art.29 (tipping-off) · Cabinet Res 74/2020 Art.4-7 · Cabinet Res 134/2025 Art.19.
