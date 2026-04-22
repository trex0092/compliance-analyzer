#!/usr/bin/env -S npx tsx
/**
 * cdd-weekly-asana-tasks.ts
 *
 * Fetches the CDD weekly status cron, parses the JSON, and creates the
 * correct Asana tasks:
 *
 *   ok === false → ONE failure task in "KYC / CDD TRACKER"
 *                  (title: "CDD Weekly run FAILED — <YYYY-WW>", due today,
 *                   assignee MLRO, tag #routine-failure, body = error)
 *
 *   ok === true  → TWO identical tasks:
 *                  Task A — "KYC / CDD TRACKER"
 *                    title: "CDD Weekly Status · Week <YYYY-WW>"
 *                    due: Friday of current week
 *                    assignee: MLRO, tags: #cdd-weekly #mlro-review
 *                  Task B — "Compliance Audit Log"
 *                    title: "ARCHIVE · CDD Weekly · <YYYY-MM-DD>"
 *                    assignee: (none), tags: #archive #retention-10yr
 *
 * Both tasks append the regulatory footer required by CLAUDE.md.
 *
 * Usage:
 *   ASANA_TOKEN=<PAT> \
 *   ASANA_WORKSPACE_GID=<gid> \
 *   npx tsx scripts/cdd-weekly-asana-tasks.ts
 *
 * Optional env vars (fall back to defaults from .env.example):
 *   ASANA_KYC_CDD_TRACKER_PROJECT_GID  (default: 1214148898062562)
 *   ASANA_AUDIT_LOG_PROJECT_GID        (default: 1214148643197211)
 *   ASANA_DEFAULT_ASSIGNEE_NAME        (default: Luisa Fernanda)
 *
 * Regulatory basis:
 *   Cabinet Res 134/2025 Art.7  (risk-based periodic CDD review)
 *   FDL No.10/2025 Art.12-14   (CDD obligations)
 *   FDL No.10/2025 Art.24      (10-year record retention)
 *   FDL No.10/2025 Art.29      (no tipping off)
 */

import { createAsanaTask, resolveAsanaUserByName } from '../src/services/asanaClient';

const CRON_URL =
  'https://hawkeye-sterling-v2.netlify.app/.netlify/functions/cdd-weekly-status-cron';

const KYC_CDD_GID =
  process.env.ASANA_KYC_CDD_TRACKER_PROJECT_GID ?? '1214148898062562';
const AUDIT_LOG_GID =
  process.env.ASANA_AUDIT_LOG_PROJECT_GID ?? '1214148643197211';
const WORKSPACE_GID = process.env.ASANA_WORKSPACE_GID ?? '';
const MLRO_NAME = process.env.ASANA_DEFAULT_ASSIGNEE_NAME ?? 'Luisa Fernanda';

const FOOTER = `
---
REGULATORY BASIS: Cabinet Res 134/2025 Art.7 (risk-based periodic CDD),
FDL No.10/2025 Art.12-14 (CDD), Art.24 (10-yr retention).
NO TIPPING OFF (FDL Art.29). Archive retained for 10 years.`;

function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

function fridayOfWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (5 - dow));
  return d.toISOString().slice(0, 10);
}

async function resolveMlro(): Promise<string | undefined> {
  if (!WORKSPACE_GID) {
    console.warn('[warn] ASANA_WORKSPACE_GID not set — task will be unassigned');
    return undefined;
  }
  const res = await resolveAsanaUserByName(WORKSPACE_GID, MLRO_NAME);
  if (res.ok && res.user) {
    if (res.warning) console.warn('[warn]', res.warning);
    return res.user.gid;
  }
  console.warn('[warn] Could not resolve MLRO:', res.error, '— task will be unassigned');
  return undefined;
}

async function main(): Promise<void> {
  const now = new Date();
  const week = isoWeek(now);
  const today = now.toISOString().slice(0, 10);
  const friday = fridayOfWeek(now);

  // Fetch cron
  let cronOk = false;
  let cronMarkdown: string | undefined;
  let cronError: string | undefined;

  try {
    const res = await fetch(CRON_URL);
    if (res.ok) {
      const json = (await res.json()) as {
        ok?: boolean;
        markdown?: string;
        error?: string;
      };
      cronOk = json.ok === true;
      cronMarkdown = json.markdown;
      cronError = json.error;
    } else {
      cronError = `HTTP ${res.status} ${res.statusText}`;
    }
  } catch (err) {
    cronError = err instanceof Error ? err.message : String(err);
  }

  if (!cronOk) {
    const mlroGid = await resolveMlro();
    const body =
      `CDD Weekly Status cron FAILED.\n\nError: ${cronError ?? 'unknown'}\n\n` +
      `This task requires immediate MLRO attention.\n\nTags: #routine-failure${FOOTER}`;

    const result = await createAsanaTask({
      name: `CDD Weekly run FAILED — ${week}`,
      notes: body,
      projects: [KYC_CDD_GID],
      due_on: today,
      assignee: mlroGid,
      tags: ['#routine-failure'] as const,
    });

    if (result.ok) {
      console.log(`[ok] Failure task created (GID: ${result.gid})`);
    } else {
      console.error(`[error] Could not create failure task: ${result.error}`);
      process.exit(1);
    }
    return;
  }

  // Success path — two identical-body tasks
  const mlroGid = await resolveMlro();
  const body = `${cronMarkdown ?? '(no markdown in cron response)'}${FOOTER}`;

  const [taskA, taskB] = await Promise.all([
    createAsanaTask({
      name: `CDD Weekly Status · Week ${week}`,
      notes: body,
      projects: [KYC_CDD_GID],
      due_on: friday,
      assignee: mlroGid,
      tags: ['#cdd-weekly', '#mlro-review'] as const,
    }),
    createAsanaTask({
      name: `ARCHIVE · CDD Weekly · ${today}`,
      notes: body,
      projects: [AUDIT_LOG_GID],
      tags: ['#archive', '#retention-10yr'] as const,
    }),
  ]);

  if (taskA.ok) {
    console.log(`[ok] Task A "KYC / CDD TRACKER" created (GID: ${taskA.gid})`);
  } else {
    console.error(`[error] Task A failed: ${taskA.error}`);
  }

  if (taskB.ok) {
    console.log(`[ok] Task B "Compliance Audit Log" created (GID: ${taskB.gid})`);
  } else {
    console.error(`[error] Task B failed: ${taskB.error}`);
  }

  if (!taskA.ok || !taskB.ok) process.exit(1);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
