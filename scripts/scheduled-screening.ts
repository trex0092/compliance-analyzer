#!/usr/bin/env tsx
/**
 * Scheduled Screening — ongoing adverse-media monitoring for the
 * compliance watchlist.
 *
 * Runs twice per day via .github/workflows/scheduled-screening.yml
 * at 06:00 and 14:00 UTC (10:00 and 18:00 Dubai time).
 *
 * Flow:
 *
 *   1. GET /api/watchlist → fetch the current watchlist from Netlify Blobs
 *   2. For each subject on the watchlist:
 *      a. Build a delta adverse-media query (since lastScreenedAtIso,
 *         or the default 30-day window if never screened)
 *      b. Call the search provider (Brave / SerpAPI / Google CSE) via
 *         searchAdverseMedia()
 *      c. Fingerprint each hit, diff against seenHitFingerprints via
 *         updateAfterScreening() — returns NEW hits only
 *      d. If new hits exist: create an alert task in the SCREENINGS
 *         Asana project, assigned to Luisa Fernanda (resolved by name
 *         from the workspace on first run, cached in-memory afterward)
 *   3. Always: create ONE daily heartbeat task summarising the run
 *      (even on zero-alert days — "X subjects checked, 0 new alerts")
 *   4. POST /api/watchlist {action: "replace", watchlist: ...} → save
 *      the updated state (new lastScreenedAtIso, merged fingerprints,
 *      bumped alert counts) back to Blobs
 *   5. Emit a brain event with the run summary for the NORAD dashboard
 *   6. Exit 0 if the run completed (even with per-subject errors);
 *      exit 1 only on unrecoverable errors (cannot reach the API,
 *      watchlist corrupt, etc)
 *
 * Design principles:
 *
 *   - PER-SUBJECT FAILURE ISOLATION: one subject's search error never
 *     aborts the whole run. We log, record the error in the run
 *     summary, and move on to the next subject.
 *   - IDEMPOTENCY: the fingerprint-based delta means re-running within
 *     the same day produces zero new alerts the second time. Safe to
 *     trigger manually via workflow_dispatch without flooding Asana.
 *   - DRY-RUN MODE: set SCHEDULED_SCREENING_DRY_RUN=1 to skip all
 *     Asana + brain dispatches and just log what WOULD happen. Used
 *     by CI smoke tests and local debugging.
 *
 * Environment variables (set in GitHub Actions / Netlify env):
 *
 *   ASANA_TOKEN                        Asana Personal Access Token
 *   ASANA_SCREENINGS_PROJECT_GID       Target project for alert tasks
 *   ASANA_WORKSPACE_GID                Workspace for user resolution
 *   ASANA_DEFAULT_ASSIGNEE_NAME        e.g. "Luisa Fernanda"
 *   HAWKEYE_BRAIN_URL                  defaults to compliance-analyzer.netlify.app
 *   HAWKEYE_BRAIN_TOKEN                Bearer for /api/watchlist and /api/brain
 *   SCHEDULED_SCREENING_DRY_RUN        =1 to skip Asana + brain dispatches
 *   SCHEDULED_SCREENING_OFFLINE        =1 to skip adverse-media HTTP calls
 *                                      (uses an empty hit list for every subject)
 *
 * Exit codes:
 *   0 — run completed (may include per-subject errors)
 *   1 — fatal error (cannot reach API, cannot parse watchlist, auth failure)
 *   2 — usage error (invalid CLI args)
 *
 * Regulatory basis:
 *   - FATF Rec 10 (ongoing customer due diligence)
 *   - Cabinet Res 134/2025 Art.19 (periodic internal review)
 *   - Cabinet Res 134/2025 Art.14 (EDD triggers on new adverse media)
 *   - FDL No.10/2025 Art.26-27 (STR filing on suspicion)
 *   - FDL No.10/2025 Art.24 (record retention — the run log itself
 *     is a record under the retention obligation)
 */

import { searchAdverseMedia, type AdverseMediaHit } from '../src/services/adverseMediaSearch';
import {
  deserialiseWatchlist,
  listDueSubjects,
  updateAfterScreening,
  serialiseWatchlist,
  type SerialisedWatchlist,
  type WatchlistEntry,
} from '../src/services/screeningWatchlist';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface RunConfig {
  brainUrl: string;
  brainToken: string | undefined;
  asanaToken: string | undefined;
  asanaProjectGid: string | undefined;
  asanaWorkspaceGid: string | undefined;
  asanaAssigneeName: string | undefined;
  dryRun: boolean;
  offline: boolean;
}

function loadConfig(): RunConfig {
  return {
    brainUrl: process.env.HAWKEYE_BRAIN_URL ?? 'https://compliance-analyzer.netlify.app',
    brainToken: process.env.HAWKEYE_BRAIN_TOKEN,
    asanaToken: process.env.ASANA_TOKEN,
    asanaProjectGid: process.env.ASANA_SCREENINGS_PROJECT_GID,
    asanaWorkspaceGid: process.env.ASANA_WORKSPACE_GID,
    asanaAssigneeName: process.env.ASANA_DEFAULT_ASSIGNEE_NAME,
    dryRun: process.env.SCHEDULED_SCREENING_DRY_RUN === '1',
    offline: process.env.SCHEDULED_SCREENING_OFFLINE === '1',
  };
}

// ---------------------------------------------------------------------------
// Watchlist API client — talks to /api/watchlist
// ---------------------------------------------------------------------------

async function fetchWatchlist(cfg: RunConfig): Promise<SerialisedWatchlist> {
  if (!cfg.brainToken) {
    throw new Error('HAWKEYE_BRAIN_TOKEN is not set — cannot fetch watchlist');
  }
  const url = `${cfg.brainUrl.replace(/\/+$/, '')}/api/watchlist`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cfg.brainToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetchWatchlist: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { ok: boolean; watchlist?: SerialisedWatchlist; error?: string };
  if (!data.ok || !data.watchlist) {
    throw new Error(`fetchWatchlist: ${data.error ?? 'malformed response'}`);
  }
  return data.watchlist;
}

async function saveWatchlist(cfg: RunConfig, watchlist: SerialisedWatchlist): Promise<void> {
  if (!cfg.brainToken) throw new Error('HAWKEYE_BRAIN_TOKEN is not set');
  const url = `${cfg.brainUrl.replace(/\/+$/, '')}/api/watchlist`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.brainToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'replace', watchlist }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`saveWatchlist: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Asana dispatch — the alert and heartbeat tasks
// ---------------------------------------------------------------------------

interface AsanaDispatchResult {
  ok: boolean;
  gid?: string;
  error?: string;
}

async function createScreeningTask(
  cfg: RunConfig,
  assigneeGid: string | undefined,
  name: string,
  notes: string,
  dueOn: string | undefined
): Promise<AsanaDispatchResult> {
  if (cfg.dryRun) {
    console.log(`[dry-run] would create Asana task: ${name}`);
    return { ok: true, gid: 'dry-run' };
  }
  if (!cfg.asanaToken || !cfg.asanaProjectGid) {
    return { ok: false, error: 'ASANA_TOKEN or ASANA_SCREENINGS_PROJECT_GID not set' };
  }

  const payload: Record<string, unknown> = {
    name: name.slice(0, 300),
    notes: notes.slice(0, 60_000), // Asana's hard limit is ~65k chars
    projects: [cfg.asanaProjectGid],
  };
  if (assigneeGid) payload.assignee = assigneeGid;
  if (dueOn) payload.due_on = dueOn;

  try {
    const res = await fetch('https://app.asana.com/api/1.0/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.asanaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: payload }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `Asana ${res.status}: ${body.slice(0, 200)}` };
    }
    const json = (await res.json()) as { data?: { gid?: string } };
    return { ok: true, gid: json.data?.gid };
  } catch (err) {
    return { ok: false, error: `asana fetch failed: ${(err as Error).message}` };
  }
}

async function resolveAssigneeGid(cfg: RunConfig): Promise<string | undefined> {
  if (!cfg.asanaToken || !cfg.asanaWorkspaceGid || !cfg.asanaAssigneeName) {
    return undefined;
  }
  if (cfg.dryRun) {
    console.log(`[dry-run] would resolve assignee "${cfg.asanaAssigneeName}"`);
    return 'dry-run-gid';
  }
  try {
    const url = `https://app.asana.com/api/1.0/workspaces/${encodeURIComponent(cfg.asanaWorkspaceGid)}/users?opt_fields=gid,name,email`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.asanaToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[resolveAssignee] HTTP ${res.status} — alert tasks will be unassigned`);
      return undefined;
    }
    const json = (await res.json()) as { data?: Array<{ gid: string; name: string }> };
    const users = json.data ?? [];
    const needle = cfg.asanaAssigneeName.toLowerCase().trim();
    const match = users.find((u) => u.name.toLowerCase().includes(needle));
    if (!match) {
      console.warn(
        `[resolveAssignee] no user found matching "${cfg.asanaAssigneeName}" in workspace ${cfg.asanaWorkspaceGid} — alert tasks will be unassigned`
      );
      return undefined;
    }
    console.log(`[resolveAssignee] resolved "${cfg.asanaAssigneeName}" → ${match.gid} (${match.name})`);
    return match.gid;
  } catch (err) {
    console.warn(`[resolveAssignee] failed: ${(err as Error).message}`);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Task content builders
// ---------------------------------------------------------------------------

function buildAlertTaskName(entry: WatchlistEntry, newHitCount: number): string {
  const severity =
    newHitCount >= 3 ? 'CRITICAL' : newHitCount >= 2 ? 'HIGH' : 'MEDIUM';
  return `[${severity}] Adverse media — ${entry.subjectName} — ${newHitCount} new hit${newHitCount === 1 ? '' : 's'}`;
}

function buildAlertTaskNotes(
  entry: WatchlistEntry,
  newHits: readonly AdverseMediaHit[],
  runAt: string
): string {
  const lines: string[] = [];
  lines.push(`Entity: ${entry.subjectName}`);
  lines.push(`Watchlist id: ${entry.id}`);
  lines.push(`Risk tier: ${entry.riskTier.toUpperCase()}`);
  if (entry.lastScreenedAtIso) {
    lines.push(`Previous screening: ${entry.lastScreenedAtIso}`);
  } else {
    lines.push(`Previous screening: (first run for this subject)`);
  }
  lines.push(`This run: ${runAt}`);
  lines.push(`Total alerts for this subject: ${entry.alertCount}`);
  lines.push('');
  lines.push(`NEW HITS (${newHits.length}):`);
  lines.push('─'.repeat(60));

  newHits.forEach((hit, i) => {
    lines.push(`${i + 1}. ${hit.title}`);
    lines.push(`   Source: ${hit.source}`);
    if (hit.publishedAt) lines.push(`   Published: ${hit.publishedAt}`);
    lines.push(`   URL: ${hit.url}`);
    if (hit.snippet) lines.push(`   Snippet: ${hit.snippet.slice(0, 300)}`);
    lines.push('');
  });

  lines.push('Recommended action:');
  if (newHits.length >= 3) {
    lines.push('  - EDD + four-eyes review (Cabinet Res 134/2025 Art.14)');
    lines.push('  - Consider STR filing (FDL Art.26-27)');
  } else if (newHits.length >= 2) {
    lines.push('  - Enhanced review by MLRO');
    lines.push('  - Escalate to Compliance Officer');
  } else {
    lines.push('  - Review and document in compliance log');
  }
  lines.push('');
  lines.push(`Metadata: ${JSON.stringify(entry.metadata ?? {})}`);
  lines.push('');
  lines.push('— Auto-generated by scheduled-screening.ts');
  lines.push(`  Regulatory basis: FATF Rec 10; Cabinet Res 134/2025 Art.14; FDL Art.26-27`);

  return lines.join('\n');
}

function buildHeartbeatTaskName(runAtIso: string, totalChecked: number, alertCount: number): string {
  const date = runAtIso.slice(0, 10);
  const time = runAtIso.slice(11, 16);
  return `Monitoring summary ${date} ${time} UTC — ${totalChecked} checked, ${alertCount} alert${alertCount === 1 ? '' : 's'}`;
}

interface RunSummary {
  runAtIso: string;
  totalChecked: number;
  totalNewHits: number;
  subjectsWithAlerts: Array<{ id: string; subjectName: string; newHitCount: number; asanaGid?: string }>;
  subjectsWithErrors: Array<{ id: string; subjectName: string; error: string }>;
  subjectsClean: Array<{ id: string; subjectName: string }>;
}

function buildHeartbeatTaskNotes(summary: RunSummary): string {
  const lines: string[] = [];
  lines.push(`Ongoing monitoring cycle: ${summary.runAtIso}`);
  lines.push(`Subjects checked: ${summary.totalChecked}`);
  lines.push(`New alerts fired: ${summary.subjectsWithAlerts.length}`);
  lines.push(`Total new hits across all subjects: ${summary.totalNewHits}`);
  lines.push(`Subjects with errors: ${summary.subjectsWithErrors.length}`);
  lines.push('');

  if (summary.subjectsWithAlerts.length > 0) {
    lines.push('SUBJECTS WITH NEW HITS:');
    for (const s of summary.subjectsWithAlerts) {
      const gidSuffix = s.asanaGid && s.asanaGid !== 'dry-run' ? ` (task: ${s.asanaGid})` : '';
      lines.push(`  • ${s.subjectName} — ${s.newHitCount} new hit${s.newHitCount === 1 ? '' : 's'}${gidSuffix}`);
    }
    lines.push('');
  }

  if (summary.subjectsWithErrors.length > 0) {
    lines.push('SUBJECTS WITH SEARCH ERRORS:');
    for (const s of summary.subjectsWithErrors) {
      lines.push(`  • ${s.subjectName} — ${s.error}`);
    }
    lines.push('');
  }

  lines.push(`Clean subjects (no new hits): ${summary.subjectsClean.length}`);
  if (summary.subjectsClean.length > 0 && summary.subjectsClean.length <= 50) {
    for (const s of summary.subjectsClean) {
      lines.push(`  • ${s.subjectName}`);
    }
  } else if (summary.subjectsClean.length > 50) {
    lines.push(`  (list omitted — ${summary.subjectsClean.length} subjects)`);
  }

  lines.push('');
  lines.push('— Auto-generated by scheduled-screening.ts');
  lines.push('  Regulatory basis: FATF Rec 10; Cabinet Res 134/2025 Art.19');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Per-subject screening
// ---------------------------------------------------------------------------

export async function screenOneSubject(
  entry: WatchlistEntry,
  cfg: RunConfig
): Promise<
  | { ok: true; newHits: AdverseMediaHit[] }
  | { ok: false; error: string }
> {
  if (cfg.offline) {
    return { ok: true, newHits: [] };
  }

  const sinceDate = entry.lastScreenedAtIso
    ? entry.lastScreenedAtIso.slice(0, 10)
    : undefined; // undefined → module default (30 days)

  try {
    const result = await searchAdverseMedia(entry.subjectName, { sinceDate });
    return { ok: true, newHits: result.hits };
  } catch (err) {
    return { ok: false, error: `searchAdverseMedia failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Brain event emission
// ---------------------------------------------------------------------------

async function emitBrainEvent(cfg: RunConfig, summary: RunSummary): Promise<void> {
  if (cfg.dryRun) {
    console.log(`[dry-run] would emit brain event: ${summary.subjectsWithAlerts.length} alerts`);
    return;
  }
  if (!cfg.brainToken) return;

  const severity =
    summary.subjectsWithAlerts.length === 0
      ? 'info'
      : summary.totalNewHits >= 3
        ? 'high'
        : 'medium';

  const url = `${cfg.brainUrl.replace(/\/+$/, '')}/api/brain`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.brainToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'manual',
        severity,
        summary: `Scheduled screening: ${summary.totalChecked} subjects checked, ${summary.subjectsWithAlerts.length} new alerts`,
        meta: {
          source: 'scheduled-screening',
          runAtIso: summary.runAtIso,
          totalChecked: summary.totalChecked,
          totalNewHits: summary.totalNewHits,
          alertCount: summary.subjectsWithAlerts.length,
          errorCount: summary.subjectsWithErrors.length,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.warn(`[emitBrainEvent] failed (non-fatal): ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runScheduledScreening(cfg?: RunConfig): Promise<RunSummary> {
  const runCfg = cfg ?? loadConfig();
  const runAtIso = new Date().toISOString();

  console.log(`[scheduled-screening] starting run at ${runAtIso}`);
  console.log(
    `[scheduled-screening] mode: ${runCfg.dryRun ? 'DRY-RUN ' : ''}${runCfg.offline ? 'OFFLINE ' : ''}${!runCfg.dryRun && !runCfg.offline ? 'LIVE' : ''}`.trim()
  );

  // 1. Fetch the current watchlist
  const serialised = await fetchWatchlist(runCfg);
  const wl = deserialiseWatchlist(serialised);
  const due = listDueSubjects(wl);
  console.log(`[scheduled-screening] watchlist: ${due.length} subject(s) due`);

  if (due.length === 0) {
    console.log(`[scheduled-screening] nothing to do — watchlist empty`);
    const emptySummary: RunSummary = {
      runAtIso,
      totalChecked: 0,
      totalNewHits: 0,
      subjectsWithAlerts: [],
      subjectsWithErrors: [],
      subjectsClean: [],
    };
    return emptySummary;
  }

  // 2. Resolve assignee once (cached for this run)
  const assigneeGid = await resolveAssigneeGid(runCfg);

  // 3. Screen each subject, dispatch alerts per subject
  const summary: RunSummary = {
    runAtIso,
    totalChecked: due.length,
    totalNewHits: 0,
    subjectsWithAlerts: [],
    subjectsWithErrors: [],
    subjectsClean: [],
  };

  for (const entry of due) {
    const result = await screenOneSubject(entry, runCfg);
    if (!result.ok) {
      console.warn(`[scheduled-screening] ${entry.subjectName}: ${result.error}`);
      summary.subjectsWithErrors.push({
        id: entry.id,
        subjectName: entry.subjectName,
        error: result.error,
      });
      continue;
    }

    const update = await updateAfterScreening(wl, entry.id, result.newHits, new Date(runAtIso));

    if (update.newHits.length === 0) {
      summary.subjectsClean.push({ id: entry.id, subjectName: entry.subjectName });
      continue;
    }

    // Dispatch an alert task for this subject
    const taskName = buildAlertTaskName(entry, update.newHits.length);
    const taskNotes = buildAlertTaskNotes(entry, update.newHits, runAtIso);
    // Due on today — MLRO should triage the same day
    const dueOn = runAtIso.slice(0, 10);
    const dispatch = await createScreeningTask(runCfg, assigneeGid, taskName, taskNotes, dueOn);

    if (dispatch.ok) {
      summary.subjectsWithAlerts.push({
        id: entry.id,
        subjectName: entry.subjectName,
        newHitCount: update.newHits.length,
        asanaGid: dispatch.gid,
      });
      summary.totalNewHits += update.newHits.length;
    } else {
      summary.subjectsWithErrors.push({
        id: entry.id,
        subjectName: entry.subjectName,
        error: `Asana dispatch failed: ${dispatch.error}`,
      });
    }
  }

  // 4. Save updated watchlist state back to /api/watchlist
  const updated = serialiseWatchlist(wl);
  await saveWatchlist(runCfg, updated);
  console.log(`[scheduled-screening] state saved: ${updated.entries.length} entries`);

  // 5. Create the heartbeat summary task (always — on zero-alert days too)
  const heartbeatName = buildHeartbeatTaskName(runAtIso, summary.totalChecked, summary.subjectsWithAlerts.length);
  const heartbeatNotes = buildHeartbeatTaskNotes(summary);
  await createScreeningTask(runCfg, assigneeGid, heartbeatName, heartbeatNotes, runAtIso.slice(0, 10));

  // 6. Emit brain event
  await emitBrainEvent(runCfg, summary);

  // 7. Summary to stdout
  console.log(
    `[scheduled-screening] done: ${summary.totalChecked} checked, ${summary.subjectsWithAlerts.length} alerts, ${summary.subjectsWithErrors.length} errors`
  );

  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

// Only run main when executed directly, not when imported by tests.
const isMain =
  typeof import.meta !== 'undefined' &&
  typeof process !== 'undefined' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  runScheduledScreening()
    .then((summary) => {
      // Exit non-zero if there were errors, so CI surfaces them
      if (summary.subjectsWithErrors.length > 0) {
        process.exit(0); // still 0 — per-subject errors aren't fatal
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[scheduled-screening] FATAL:`, err);
      process.exit(1);
    });
}

// Exported for tests
export const __test__ = {
  buildAlertTaskName,
  buildAlertTaskNotes,
  buildHeartbeatTaskName,
  buildHeartbeatTaskNotes,
  loadConfig,
};
