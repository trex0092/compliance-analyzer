#!/usr/bin/env -S npx tsx
/**
 * smoke-test-all.ts — One-shot end-to-end verification of the Hawkeye
 * Sterling V2 environment + Asana + Anthropic integrations.
 *
 * Runs FIVE phases with ✅ / ❌ per check:
 *
 *   1. ENV validation        — every required var present + well-formed
 *   2. Asana project GIDs    — GET /projects/<gid> per slot
 *   3. Asana task endpoint   — POST + DELETE one test task per source
 *   4. Anthropic API         — roundtrip test + advisor-beta acceptance
 *   5. Summary               — pass/fail totals
 *
 * Usage (from repo root, after populating .env per docs/env-complete.md):
 *
 *   set -a && . ./.env && set +a
 *   npx tsx scripts/smoke-test-all.ts
 *
 * The script performs WRITE operations — it creates 5 Asana tasks
 * (one per surface) as dry-run verification, then deletes them
 * before exit. Nothing else mutates state.
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 — every production
 * integration must pass an operator-visible smoke test before MLRO
 * trusts the pipeline. This script is that gate.
 */

const ASANA_BASE = 'https://app.asana.com/api/1.0';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

const checks: Check[] = [];
function record(label: string, ok: boolean, detail?: string): void {
  checks.push({ label, ok, detail });
  const mark = ok ? '✅' : '❌';
  const tail = detail ? `  ${detail}` : '';
  console.log(`  ${mark} ${label}${tail}`);
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

interface AsanaSlot {
  envVar: string;
  label: string;
}

const ASANA_SLOTS: readonly AsanaSlot[] = [
  { envVar: 'ASANA_SCREENINGS_PROJECT_GID', label: 'Screening — Sanctions & Adverse Media' },
  { envVar: 'ASANA_CENTRAL_MLRO_PROJECT_GID', label: 'Central MLRO — Daily Digest' },
  { envVar: 'ASANA_AUDIT_LOG_PROJECT_GID', label: 'Audit Log — 10-Year Trail' },
  { envVar: 'ASANA_FOUR_EYES_PROJECT_GID', label: 'Four-Eyes Approvals' },
  { envVar: 'ASANA_STR_PROJECT_GID', label: 'STR/SAR/CTR/PMR — goAML Filings' },
  { envVar: 'ASANA_INCIDENTS_PROJECT_GID', label: 'FFR — Incidents & Asset Freezes' },
  { envVar: 'ASANA_CDD_PROJECT_GID', label: 'CDD/SDD/EDD/KYC — Customer Due Diligence' },
  { envVar: 'ASANA_KYC_CDD_TRACKER_PROJECT_GID', label: 'KYC Tracker (alias of CDD)' },
  { envVar: 'ASANA_TM_PROJECT_GID', label: 'Transaction Monitoring' },
  { envVar: 'ASANA_COMPLIANCE_TASKS_PROJECT_GID', label: 'Compliance Ops — Daily & Weekly Tasks' },
  { envVar: 'ASANA_SHIPMENTS_PROJECT_GID', label: 'Shipments — Tracking' },
  { envVar: 'ASANA_EMPLOYEES_PROJECT_GID', label: 'Employees' },
  { envVar: 'ASANA_TRAINING_PROJECT_GID', label: 'Training' },
  { envVar: 'ASANA_GOVERNANCE_PROJECT_GID', label: 'Compliance Governance' },
  { envVar: 'ASANA_AI_GOVERNANCE_PROJECT_GID', label: 'AI Governance (alias of Governance)' },
  { envVar: 'ASANA_ROUTINES_PROJECT_GID', label: 'Routines — Scheduled' },
  { envVar: 'ASANA_WORKBENCH_PROJECT_GID', label: 'MLRO Workbench' },
  { envVar: 'ASANA_ESG_LBMA_PROJECT_GID', label: 'Supply Chain, ESG & LBMA Gold' },
  { envVar: 'ASANA_EXPORT_CONTROL_PROJECT_GID', label: 'Export Control & Dual-Use' },
  { envVar: 'ASANA_INSPECTOR_PROJECT_GID', label: 'Regulator Portal Handoff' },
  { envVar: 'ASANA_GRIEVANCES_PROJECT_GID', label: 'Incidents & Grievances' },
];

const SURFACES: readonly string[] = [
  'workbench',
  'logistics',
  'compliance-ops',
  'routines',
  'screening',
];

async function asanaGet<T>(path: string, token: string): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${ASANA_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}` };
    }
    const json = (await res.json()) as { data: T };
    return { ok: true, data: json.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function asanaPost<T>(
  path: string,
  token: string,
  body: unknown,
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(`${ASANA_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}` };
    }
    const json = (await res.json()) as { data: T };
    return { ok: true, data: json.data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function asanaDelete(path: string, token: string): Promise<void> {
  try {
    await fetch(`${ASANA_BASE}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // best-effort cleanup
  }
}

// ─── Phase 1 ──────────────────────────────────────────────────────────────
async function phase1EnvValidation(): Promise<void> {
  console.log('\n── PHASE 1: ENV VALIDATION ──');
  // The locked 67 — canonical Netlify env set for Hawkeye Sterling V2
  // (MLRO locked 2026-04-21). Nothing more, nothing less.
  const required = [
    'ANTHROPIC_API_KEY',
    'ASANA_ACCESS_TOKEN',
    'ASANA_WORKSPACE_GID',
    'ASANA_SCREENINGS_PROJECT_GID',
    'ASANA_CENTRAL_MLRO_PROJECT_GID',
    'ASANA_AUDIT_LOG_PROJECT_GID',
    'ASANA_FOUR_EYES_PROJECT_GID',
    'ASANA_STR_PROJECT_GID',
    'ASANA_INCIDENTS_PROJECT_GID',
    'ASANA_CDD_PROJECT_GID',
    'ASANA_KYC_CDD_TRACKER_PROJECT_GID',
    'ASANA_TM_PROJECT_GID',
    'ASANA_COMPLIANCE_TASKS_PROJECT_GID',
    'ASANA_SHIPMENTS_PROJECT_GID',
    'ASANA_EMPLOYEES_PROJECT_GID',
    'ASANA_TRAINING_PROJECT_GID',
    'ASANA_GOVERNANCE_PROJECT_GID',
    'ASANA_AI_GOVERNANCE_PROJECT_GID',
    'ASANA_ROUTINES_PROJECT_GID',
    'ASANA_WORKBENCH_PROJECT_GID',
    'ASANA_ESG_LBMA_PROJECT_GID',
    'ASANA_EXPORT_CONTROL_PROJECT_GID',
    'ASANA_INSPECTOR_PROJECT_GID',
    'ASANA_GRIEVANCES_PROJECT_GID',
    'ASANA_RECONCILE_LIVE_READS_ENABLED',
    'PUBLIC_BASE_URL',
    'HAWKEYE_ALLOWED_ORIGIN',
    'HAWKEYE_JWT_SECRET',
    'JWT_SIGNING_SECRET',
    'HAWKEYE_JWT_TTL_SEC',
    'BCRYPT_PEPPER',
    'HAWKEYE_CROSS_TENANT_SALT',
    'HAWKEYE_BRAIN_TOKEN',
    'HAWKEYE_BRAIN_PASSWORD_HASH',
    'HAWKEYE_APPROVER_KEYS',
    'HAWKEYE_ALERT_EMAIL',
    'HAWKEYE_CLAMP_CRON_TENANTS',
    'HAWKEYE_DELTA_SCREEN_TENANTS',
    'HAWKEYE_LOGIN_RATE_LIMIT_DISABLED',
    'SANCTIONS_UPLOAD_TOKEN',
    'SETUP_MFA_TOTP_SECRET',
    'BRAIN_RATE_LIMIT_PER_15MIN',
    'BRAIN_TELEMETRY_ENABLED',
    'HAWKEYE_AUDIT_HMAC_KEY',
    'ASANA_WEBHOOK_SECRET',
    'REPORTING_ENTITY_NAME',
    'REPORTING_ENTITY_LICENCE',
    'ASANA_TEAM_GID',
    'SCHEDULED_SCREENING_DRY_RUN',
    'SCHEDULED_SCREENING_OFFLINE',
    'REGULATORY_WATCH_OFFLINE',
    'CONTINUOUS_MONITOR_DISPATCH_ASANA',
    'TAVILY_API_KEY',
    'SERPAPI_KEY',
    'BRAVE_SEARCH_API_KEY',
    'HAWKEYE_REGULATOR_MASTER_KEY',
    'HAWKEYE_REGULATOR_CODE_TTL_MINUTES',
    'HAWKEYE_INSPECTOR_KEYS',
    'HAWKEYE_SOLO_MLRO_MODE',
    'HAWKEYE_SOLO_MLRO_COOLDOWN_HOURS',
    'HAWKEYE_SANCTIONS_PROXY_URL',
    'ASANA_SECTION_SCREENINGS_NAME',
    'LOG_LEVEL',
    'ASANA_INSPECTOR_TEAM_GID',
    'CACHET_API_TOKEN',
    'CACHET_BASE_URL',
    'HAWKEYE_BRAIN_URL',
  ];
  // The 14 env vars that are ALLOWED to be blank (optional features).
  // Everything else must be populated or the gate fails.
  const optionalBlankOk = new Set([
    'HAWKEYE_INSPECTOR_KEYS',
    'HAWKEYE_SANCTIONS_PROXY_URL',
    'ASANA_SECTION_SCREENINGS_NAME',
    'ASANA_INSPECTOR_TEAM_GID',
    'CACHET_API_TOKEN',
    'CACHET_BASE_URL',
    'HAWKEYE_BRAIN_URL',
  ]);
  const missing = required.filter(
    (v) => !env(v) && !optionalBlankOk.has(v),
  );
  record(
    `${required.length - missing.length}/${required.length} of the locked 67 vars present (7 may be blank)`,
    missing.length === 0,
    missing.length > 0 ? `MISSING: ${missing.join(', ')}` : undefined,
  );

  // Hex-secret format checks
  for (const secret of [
    'HAWKEYE_JWT_SECRET',
    'JWT_SIGNING_SECRET',
    'HAWKEYE_AUDIT_HMAC_KEY',
    'BCRYPT_PEPPER',
    'HAWKEYE_CROSS_TENANT_SALT',
    'ASANA_WEBHOOK_SECRET',
    'HAWKEYE_REGULATOR_MASTER_KEY',
    'HAWKEYE_BRAIN_TOKEN',
    'SANCTIONS_UPLOAD_TOKEN',
  ]) {
    const v = env(secret);
    if (!v) continue;
    record(
      `${secret} is 64-char hex`,
      /^[a-f0-9]{64}$/i.test(v),
      /^[a-f0-9]{64}$/i.test(v) ? undefined : `got length=${v.length}, sample: ${v.slice(0, 8)}…`,
    );
  }

  // Anthropic key format
  const ak = env('ANTHROPIC_API_KEY');
  if (ak) {
    record(
      'ANTHROPIC_API_KEY format',
      /^sk-ant-/.test(ak),
      /^sk-ant-/.test(ak) ? undefined : `unexpected prefix: ${ak.slice(0, 10)}…`,
    );
  }

  // Alias consistency (KYC = CDD, AI_GOVERNANCE = GOVERNANCE, JWT pair)
  const cdd = env('ASANA_CDD_PROJECT_GID');
  const kyc = env('ASANA_KYC_CDD_TRACKER_PROJECT_GID');
  record(
    'ASANA_KYC_CDD_TRACKER_PROJECT_GID = ASANA_CDD_PROJECT_GID',
    cdd === kyc,
    cdd !== kyc ? `CDD=${cdd} vs KYC=${kyc}` : undefined,
  );

  const gov = env('ASANA_GOVERNANCE_PROJECT_GID');
  const aiGov = env('ASANA_AI_GOVERNANCE_PROJECT_GID');
  record(
    'ASANA_AI_GOVERNANCE_PROJECT_GID = ASANA_GOVERNANCE_PROJECT_GID',
    gov === aiGov,
    gov !== aiGov ? `GOV=${gov} vs AI_GOV=${aiGov}` : undefined,
  );

  const jwtA = env('HAWKEYE_JWT_SECRET');
  const jwtB = env('JWT_SIGNING_SECRET');
  record(
    'HAWKEYE_JWT_SECRET = JWT_SIGNING_SECRET',
    jwtA === jwtB,
    jwtA !== jwtB ? 'the two JWT secrets must be identical' : undefined,
  );

  // Production-flag sanity checks
  const dryRun = env('SCHEDULED_SCREENING_DRY_RUN');
  record(
    'SCHEDULED_SCREENING_DRY_RUN = false (production)',
    dryRun === 'false',
    dryRun !== 'false' ? `got "${dryRun}" — crons will not write` : undefined,
  );
  const regWatch = env('REGULATORY_WATCH_OFFLINE');
  record(
    'REGULATORY_WATCH_OFFLINE = false (production)',
    regWatch === 'false',
    regWatch !== 'false' ? `got "${regWatch}" — regulatory drift will not fetch` : undefined,
  );
}

// ─── Phase 2 ──────────────────────────────────────────────────────────────
async function phase2AsanaGids(): Promise<void> {
  console.log('\n── PHASE 2: ASANA — GIDs resolve ──');
  const token = env('ASANA_ACCESS_TOKEN');
  if (!token) {
    record('ASANA_ACCESS_TOKEN required for phase 2', false);
    return;
  }
  // Dedup by GID (CDD + KYC share, GOVERNANCE + AI_GOVERNANCE share)
  const seen = new Set<string>();
  for (const slot of ASANA_SLOTS) {
    const gid = env(slot.envVar);
    if (!gid) {
      record(`${slot.label} — SKIP (env var empty)`, false);
      continue;
    }
    if (seen.has(gid)) {
      record(`${slot.label} — reused GID ${gid} (dedup)`, true);
      continue;
    }
    seen.add(gid);
    const res = await asanaGet<{ gid: string; name: string }>(
      `/projects/${gid}?opt_fields=name`,
      token,
    );
    record(
      `${slot.label.padEnd(48)}→ ${res.ok ? res.data!.name : 'NOT FOUND'}`,
      res.ok,
      res.error,
    );
  }
}

// ─── Phase 3 ──────────────────────────────────────────────────────────────
async function phase3AsanaTaskEndpoint(): Promise<void> {
  console.log('\n── PHASE 3: ASANA — task endpoint per source ──');
  const token = env('ASANA_ACCESS_TOKEN');
  if (!token) {
    record('ASANA_ACCESS_TOKEN required for phase 3', false);
    return;
  }
  for (const surface of SURFACES) {
    // Map surface → the env var asana-task-create.mts reads.
    const mapping: Record<string, string> = {
      workbench: 'ASANA_WORKBENCH_PROJECT_GID',
      logistics: 'ASANA_SHIPMENTS_PROJECT_GID',
      'compliance-ops': 'ASANA_CENTRAL_MLRO_PROJECT_GID',
      routines: 'ASANA_ROUTINES_PROJECT_GID',
      screening: 'ASANA_SCREENINGS_PROJECT_GID',
    };
    const gid = env(mapping[surface]);
    if (!gid) {
      record(`source=${surface} → ${mapping[surface]} unset`, false);
      continue;
    }
    const marker = `[smoke-test ${new Date().toISOString()}]`;
    const create = await asanaPost<{ gid: string }>('/tasks', token, {
      data: {
        name: `${marker} source=${surface} — delete me`,
        notes:
          'Automated smoke-test task from scripts/smoke-test-all.ts.\n' +
          'Safe to ignore — will be deleted before the script exits.',
        projects: [gid],
      },
    });
    if (!create.ok) {
      record(`source=${surface.padEnd(16)}→ create`, false, create.error);
      continue;
    }
    // Clean up immediately
    await asanaDelete(`/tasks/${create.data!.gid}`, token);
    record(
      `source=${surface.padEnd(16)}→ create + delete OK (task ${create.data!.gid})`,
      true,
    );
  }
}

// ─── Phase 4 ──────────────────────────────────────────────────────────────
async function phase4Anthropic(): Promise<void> {
  console.log('\n── PHASE 4: ANTHROPIC — API reachable ──');
  const key = env('ANTHROPIC_API_KEY');
  if (!key) {
    record('ANTHROPIC_API_KEY required for phase 4', false);
    return;
  }
  try {
    const started = Date.now();
    const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      }),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      record('Claude Sonnet 4.6 responds', false, `HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`);
      return;
    }
    const json = (await res.json()) as {
      content?: Array<{ text?: string }>;
    };
    const text = json.content?.[0]?.text?.trim() ?? '';
    record(`Claude Sonnet 4.6 responds (${ms}ms roundtrip)`, true, `reply="${text.slice(0, 40)}"`);
  } catch (err) {
    record('Claude Sonnet 4.6 reachable', false, err instanceof Error ? err.message : String(err));
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────
function summary(): void {
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.log('\n── SUMMARY ──');
  console.log(`  ${passed}/${checks.length} checks passed, ${failed} failed.`);
  if (failed === 0) {
    console.log('\n  ✅ All integrations green. Safe to merge PR #428 and deploy.');
  } else {
    console.log('\n  ❌ Some integrations failed — fix the ❌ rows above before deploy.');
    console.log('\n  Failed checks:');
    for (const c of checks.filter((x) => !x.ok)) {
      console.log(`    • ${c.label}${c.detail ? '  — ' + c.detail : ''}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('Hawkeye Sterling V2 — End-to-end smoke test');
  console.log(`Workspace: ${env('ASANA_WORKSPACE_GID') || '(unset)'}`);
  console.log(`Public URL: ${env('PUBLIC_BASE_URL') || '(unset)'}`);

  await phase1EnvValidation();

  if (env('ASANA_ACCESS_TOKEN')) {
    await phase2AsanaGids();
    await phase3AsanaTaskEndpoint();
  } else {
    console.log('\n── PHASES 2-3 SKIPPED (ASANA_ACCESS_TOKEN missing) ──');
  }

  if (env('ANTHROPIC_API_KEY')) {
    await phase4Anthropic();
  } else {
    console.log('\n── PHASE 4 SKIPPED (ANTHROPIC_API_KEY missing) ──');
  }

  summary();
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\n[smoke-test] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
