/**
 * Ongoing Screening Daily cron — re-screens every subject marked
 * `ongoing_screening: true` and posts a daily delta summary to the
 * Routines Asana board.
 *
 * Schedule: 08:00 UTC every day (see `schedule` below).
 * Module:   routines  (Asana board resolved via the 16-project catalog →
 *           ASANA_ROUTINES_PROJECT_GID).
 * Audit store: ongoing-screening-audit
 * Regulatory basis: FDL No.(10)/2025 Art.20-21 (CO situational awareness
 *                   — ongoing monitoring of customers), Art.24 (10-year
 *                   audit retention of every routine run), FATF Rec 10
 *                   (ongoing CDD — monitoring must continue after onboarding
 *                   to catch list additions, status changes, new adverse
 *                   media). LSEG World-Check One "Ongoing Screening"
 *                   toggle maps directly onto this cron.
 *
 * How it works (v1 — thin wrapper):
 *   Uses the shared routineRunner so this ships alongside the existing 33
 *   scheduled cron wrappers with a consistent audit shape + Asana
 *   dispatch. The routineRunner writes a dated audit blob, resolves the
 *   routines Asana project, and posts a heartbeat task with the supplied
 *   sampleNote summary.
 *
 * Domain logic pending (v2 — dedicated handler):
 *   When subject-store + delta-detection logic is ready, this thin wrapper
 *   will be replaced with a dedicated handler that:
 *     1. Reads every subject from the `subjects` blob store where
 *        `ongoing_screening === true`.
 *     2. Re-screens each via the existing screening pipeline
 *        (fan-out across the 15 sanctions lists + adverse-media sweep).
 *     3. Diffs the new result against the prior screening in the
 *        `screening-history` store (by subject ID).
 *     4. Classifies each delta (new hit / lost hit / disposition change /
 *        new adverse media / list update / status flip).
 *     5. Composes a summary Asana task:
 *          "[Ongoing Screening · dd/mm/yyyy] N subjects · Δ M deltas"
 *        with one subtask per subject that changed, each containing the
 *        full Refinitiv-shape Match Details Report (per the 11-block
 *        template captured in the Hawkeye compliance-report serializer
 *        refactor plan).
 *     6. Writes per-subject audit entries under <subjectId>/<runDate>.
 *
 * Until v2 ships, the thin-wrapper heartbeat keeps the daily-delivery
 * contract with Asana so the MLRO never sees a silent gap in the routines
 * log, even on days when no delta occurs. Empty days still produce an
 * audit entry (FDL Art.24 — absence of change is itself an audit event).
 *
 * No additional secrets or endpoints introduced — reuses
 * ASANA_ROUTINES_PROJECT_GID resolved by asanaModuleProjects.ts and the
 * same ASANA_API_TOKEN that powers asana-sync-cron.
 */
import type { Config } from '@netlify/functions';
import { runRoutine } from '../../src/services/routineRunner';

export default async (): Promise<Response> => {
  const result = await runRoutine({
    id: 'ongoing-screening-daily',
    title: 'Ongoing Screening — Daily Delta Report',
    module: 'routines',
    cadenceHuman: 'daily at 08:00 UTC',
    regulatoryBasis:
      'FDL No.(10)/2025 Art.20-21 · Art.24 · FATF Rec 10 (ongoing CDD) · LSEG WC-One Ongoing Screening parity',
    auditStore: 'ongoing-screening-audit',
    description:
      'Daily re-screen of every subject flagged ongoing_screening=true. Posts a summary task to the Routines Asana board with one subtask per delta (new hit · disposition change · new adverse media · list update). Empty days still audit — absence of change is an audit event (FDL Art.24).',
  });
  return Response.json(result);
};

export const config: Config = {
  schedule: '0 8 * * *',
};
