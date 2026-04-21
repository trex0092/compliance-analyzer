/**
 * CDD Weekly Status — Asana task creator.
 *
 * Fetches the cdd-weekly-status-cron endpoint, parses the JSON, and
 * creates the appropriate Asana task(s) based on the result:
 *
 *   ok !== true  → ONE failure task in "KYC / CDD TRACKER" (ASANA_CDD_PROJECT_GID)
 *   ok === true  → Task A in "KYC / CDD TRACKER"  +
 *                  Task B in "Compliance Audit Log" (ASANA_AUDIT_LOG_PROJECT_GID)
 *
 * Run:
 *   npx tsx scripts/cdd-weekly-asana-tasks.ts
 *
 * Required env vars:
 *   ASANA_TOKEN              — Asana personal access token
 *   ASANA_WORKSPACE_GID      — workspace GID (for MLRO user resolution)
 *   ASANA_CDD_PROJECT_GID    — "KYC / CDD TRACKER" project GID
 *   ASANA_AUDIT_LOG_PROJECT_GID — "Compliance Audit Log" project GID
 *
 * Regulatory basis:
 *   Cabinet Res 134/2025 Art.7  (risk-based periodic CDD)
 *   FDL No.10/2025 Art.12-14    (CDD obligations)
 *   FDL No.10/2025 Art.24       (10-year record retention)
 *   FDL No.10/2025 Art.29       (no tipping off)
 */

import {
  createAsanaTask,
  resolveAsanaUserByName,
} from '../src/services/asanaClient.js';

const CRON_URL =
  'https://hawkeye-sterling-v2.netlify.app/.netlify/functions/cdd-weekly-status-cron';

const REGULATORY_FOOTER = `
---
REGULATORY BASIS: Cabinet Res 134/2025 Art.7 (risk-based periodic CDD),
FDL No.10/2025 Art.12-14 (CDD), Art.24 (10-yr retention).
NO TIPPING OFF (FDL Art.29). Archive retained for 10 years.
`.trimStart();

// ─── ISO week helpers ────────────────────────────────────────────────────────

/** Returns "YYYY-WW" for the ISO week containing `date`. */
function isoWeekLabel(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Shift to nearest Thursday to find the ISO year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(weekNum).padStart(2, '0')}`;
}

/** Returns "YYYY-MM-DD" for the Friday of the ISO week containing `date`. */
function fridayOfWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  d.setUTCDate(d.getUTCDate() + (5 - day)); // shift to Friday
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" for `date`. */
function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─── Env / config ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface CronResult {
  ok: boolean;
  markdown?: string;
  error?: string;
  [k: string]: unknown;
}

async function fetchCron(): Promise<{ ok: true; data: CronResult } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(CRON_URL, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return { ok: false, error: `Network error fetching cron: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    // Netlify scheduled functions return 403 on direct HTTP access —
    // treat as a failure so the MLRO is alerted.
    return {
      ok: false,
      error: `HTTP ${res.status} ${res.statusText} — cron endpoint returned non-2xx. The cdd-weekly-status-cron runs on schedule (Mon 05:00 UTC) and blocks direct HTTP access (403 expected). Investigate whether the last scheduled run succeeded via the Netlify function logs.`,
    };
  }

  let data: CronResult;
  try {
    data = (await res.json()) as CronResult;
  } catch {
    return { ok: false, error: 'cron response was not valid JSON' };
  }

  return { ok: true, data };
}

async function main(): Promise<void> {
  const token = requireEnv('ASANA_TOKEN');
  const workspaceGid = requireEnv('ASANA_WORKSPACE_GID');
  const cddProjectGid = requireEnv('ASANA_CDD_PROJECT_GID');
  const auditLogProjectGid = requireEnv('ASANA_AUDIT_LOG_PROJECT_GID');

  void token; // consumed by asanaClient via process.env

  const now = new Date();
  const weekLabel = isoWeekLabel(now);
  const todayStr = toDateStr(now);
  const fridayStr = fridayOfWeek(now);

  console.log(`[cdd-weekly-asana-tasks] week=${weekLabel} today=${todayStr} friday=${fridayStr}`);

  // Resolve MLRO user GID (best-effort; task is created unassigned on failure).
  const mlroName = process.env.ASANA_DEFAULT_ASSIGNEE_NAME ?? 'Luisa Fernanda';
  const userResult = await resolveAsanaUserByName(workspaceGid, mlroName);
  const mlroGid = userResult.ok ? userResult.user?.gid : undefined;
  if (!userResult.ok) {
    console.warn(`[cdd-weekly-asana-tasks] MLRO user not resolved: ${userResult.error} — task will be unassigned`);
  } else if (userResult.warning) {
    console.warn(`[cdd-weekly-asana-tasks] ${userResult.warning}`);
  }

  // ─── Fetch cron ─────────────────────────────────────────────────────────────
  const fetchResult = await fetchCron();
  const cronOk = fetchResult.ok && fetchResult.data.ok === true;

  if (!cronOk) {
    // ── FAILURE PATH: one task in KYC / CDD TRACKER ────────────────────────
    const error = fetchResult.ok ? (fetchResult.data.error ?? 'cron returned ok=false') : fetchResult.error;
    const title = `CDD Weekly run FAILED — ${weekLabel}`;
    const notes =
      `**Status:** FAILED\n` +
      `**Week:** ${weekLabel}\n` +
      `**Date:** ${todayStr}\n` +
      `**Error:** ${error}\n` +
      `**Tag:** #routine-failure\n\n` +
      `Action required: investigate cron failure and re-run manually if the Monday report was missed.\n\n` +
      REGULATORY_FOOTER;

    console.log(`[cdd-weekly-asana-tasks] Creating FAILURE task: "${title}"`);

    const result = await createAsanaTask({
      name: title,
      notes,
      projects: [cddProjectGid],
      due_on: todayStr,
      ...(mlroGid ? { assignee: mlroGid } : {}),
      tags: ['#routine-failure'],
    });

    if (result.ok) {
      console.log(`[cdd-weekly-asana-tasks] Task created: gid=${result.gid}`);
    } else {
      console.error(`[cdd-weekly-asana-tasks] Task creation failed: ${result.error}`);
      process.exitCode = 1;
    }
    return;
  }

  // ── SUCCESS PATH: Task A + Task B ──────────────────────────────────────────
  const markdown = fetchResult.data.markdown ?? '*(no markdown returned by cron)*';
  const bodyA =
    markdown +
    '\n\n' +
    REGULATORY_FOOTER;

  // Task A — KYC / CDD TRACKER
  const titleA = `CDD Weekly Status · Week ${weekLabel}`;
  console.log(`[cdd-weekly-asana-tasks] Creating Task A: "${titleA}"`);

  const resultA = await createAsanaTask({
    name: titleA,
    notes: bodyA,
    projects: [cddProjectGid],
    due_on: fridayStr,
    ...(mlroGid ? { assignee: mlroGid } : {}),
    tags: ['#cdd-weekly', '#mlro-review'],
  });

  if (resultA.ok) {
    console.log(`[cdd-weekly-asana-tasks] Task A created: gid=${resultA.gid}`);
  } else {
    console.error(`[cdd-weekly-asana-tasks] Task A failed: ${resultA.error}`);
    process.exitCode = 1;
  }

  // Task B — Compliance Audit Log (same body, no assignee, 10yr retention tags)
  const titleB = `ARCHIVE · CDD Weekly · ${todayStr}`;
  console.log(`[cdd-weekly-asana-tasks] Creating Task B: "${titleB}"`);

  const resultB = await createAsanaTask({
    name: titleB,
    notes: bodyA,
    projects: [auditLogProjectGid],
    // no assignee — archive task
    tags: ['#archive', '#retention-10yr'],
  });

  if (resultB.ok) {
    console.log(`[cdd-weekly-asana-tasks] Task B created: gid=${resultB.gid}`);
  } else {
    console.error(`[cdd-weekly-asana-tasks] Task B failed: ${resultB.error}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[cdd-weekly-asana-tasks] Fatal:', err);
  process.exitCode = 1;
});
