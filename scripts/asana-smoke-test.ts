#!/usr/bin/env -S npx tsx
/**
 * asana-smoke-test.ts — Confirm every ASANA_*_PROJECT_GID resolves.
 *
 * Reads all `ASANA_*_PROJECT_GID` env vars from the process env (or a
 * local `.env` if the caller pre-loads one), groups them by GID, and
 * sends one `GET /projects/<gid>` per distinct GID. Prints ✅ / ❌
 * per slot.
 *
 * Why this exists: CLAUDE.md §9 "Error Recovery Playbook" —
 * mis-pointed GIDs cause silent mis-routing (STR filings into
 * Employees, freeze events into Training, etc.). This script is the
 * gate that catches typos before the dispatcher does.
 *
 * Usage (run locally — this repo's sandbox cannot reach app.asana.com):
 *
 *   ASANA_TOKEN=<personal access token> \
 *   npx tsx scripts/asana-smoke-test.ts
 *
 * With a .env file on disk:
 *
 *   set -a && . ./.env && set +a
 *   npx tsx scripts/asana-smoke-test.ts
 *
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO duty to verify
 * routing), Art.24 (10-year audit — misrouted events contaminate the
 * retained trail).
 */

interface SlotCheck {
  envVar: string;
  gid: string;
  ok: boolean;
  name?: string;
  error?: string;
}

const ASANA_BASE = 'https://app.asana.com/api/1.0';

const EXPECTED_SLOTS = [
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
  'ASANA_ROUTINES_PROJECT_GID',
  'ASANA_WORKBENCH_PROJECT_GID',
  'ASANA_ESG_LBMA_PROJECT_GID',
  'ASANA_EXPORT_CONTROL_PROJECT_GID',
  'ASANA_INSPECTOR_PROJECT_GID',
  'ASANA_GRIEVANCES_PROJECT_GID',
] as const;

async function getProject(
  gid: string,
  token: string,
): Promise<{ gid: string; name: string }> {
  const res = await fetch(`${ASANA_BASE}/projects/${gid}?opt_fields=name`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data: { gid: string; name: string } };
  return json.data;
}

async function main(): Promise<void> {
  const token =
    process.env.ASANA_TOKEN || process.env.ASANA_ACCESS_TOKEN;
  if (!token) {
    console.error('Missing ASANA_TOKEN (or ASANA_ACCESS_TOKEN).');
    console.error('Usage: ASANA_TOKEN=xxx npx tsx scripts/asana-smoke-test.ts');
    process.exit(1);
  }

  const slots: SlotCheck[] = [];
  for (const envVar of EXPECTED_SLOTS) {
    const gid = process.env[envVar];
    if (!gid) {
      slots.push({ envVar, gid: '', ok: false, error: 'not set' });
      continue;
    }
    slots.push({ envVar, gid, ok: false });
  }

  // Dedup by GID so we don't hammer Asana twice for the CDD=KYC
  // merge (and any other shared GIDs).
  const distinctGids = new Set(
    slots.filter((s) => s.gid).map((s) => s.gid),
  );
  const resolved = new Map<string, { name?: string; error?: string }>();

  for (const gid of distinctGids) {
    try {
      const p = await getProject(gid, token);
      resolved.set(gid, { name: p.name });
    } catch (err: unknown) {
      resolved.set(gid, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const s of slots) {
    if (!s.gid) continue;
    const r = resolved.get(s.gid);
    if (r?.name) {
      s.ok = true;
      s.name = r.name;
    } else {
      s.error = r?.error || 'unknown error';
    }
  }

  let okCount = 0;
  let failCount = 0;
  console.log('\n=== Asana smoke test — 19 project slots ===\n');
  for (const s of slots) {
    if (s.ok) {
      console.log(`✅ ${s.envVar.padEnd(40)}  ${s.gid}  "${s.name}"`);
      okCount++;
    } else {
      console.log(
        `❌ ${s.envVar.padEnd(40)}  ${s.gid || '(unset)'}  ${s.error || ''}`,
      );
      failCount++;
    }
  }
  console.log(`\n${okCount} ok, ${failCount} failed, ${slots.length} total`);
  console.log(`${distinctGids.size} distinct GID(s) queried.\n`);

  if (failCount > 0) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('[smoke-test] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
