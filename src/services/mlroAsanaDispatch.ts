/**
 * MLRO Asana Dispatch.
 *
 * Shared helper for posting compliance report snapshots to the central
 * MLRO Asana project as Asana "status_updates". Used by the three
 * briefing crons (morning briefing, sanctions watch, weekly CDD status)
 * so the MLRO sees reports inline in the project they already monitor,
 * not only as blobs.
 *
 * Env contract: reads ASANA_CENTRAL_MLRO_PROJECT_GID (already defined in
 * the project's existing Asana integration) to know where to post. If
 * the env var is not set the dispatch is a graceful no-op — the blob
 * write remains the system of record.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-22 (CO visibility)
 *   - FDL No.10/2025 Art.24 (audit trail — status_update gid returned)
 *   - Cabinet Res 134/2025 Art.19 (internal review cadence)
 *
 * No tipping off (FDL Art.29): the MLRO project is internal to
 * compliance. The helper does NOT post to customer-facing projects.
 */

import { asanaRequestWithRetry } from './asanaClient';

export type MlroStatusColor = 'on_track' | 'at_risk' | 'off_track';

export interface MlroDispatchInput {
  title: string;
  /** Markdown-ish body. Asana accepts newlines + bullets on the `text` field. */
  markdown: string;
  /** Asana status_update colour. Defaults to 'on_track'. */
  statusType?: MlroStatusColor;
  /** Override the env-var project GID (primarily for tests). */
  projectGidOverride?: string;
}

export interface MlroDispatchResult {
  ok: boolean;
  /** True when the helper deliberately did nothing (env var absent). */
  skipped?: 'no-project-gid' | 'no-asana-token';
  statusUpdateGid?: string;
  error?: string;
}

/**
 * Asana has a server-side cap on status_update body length. We cap at
 * 58000 characters to leave headroom for Asana's own overhead and a
 * truncation footer.
 */
const ASANA_TEXT_LIMIT = 58_000;
const TRUNCATION_FOOTER =
  '\n\n[Report truncated for Asana delivery. Full markdown persisted in the blob store — see reportKey in audit.]';

function clampToAsanaLimit(markdown: string): string {
  if (markdown.length <= ASANA_TEXT_LIMIT) return markdown;
  const keep = ASANA_TEXT_LIMIT - TRUNCATION_FOOTER.length;
  return markdown.slice(0, Math.max(0, keep)) + TRUNCATION_FOOTER;
}

/**
 * Post a compliance report as an Asana status_update to the central
 * MLRO project. Pure in the sense that it only performs the intended
 * network call; all other state is passed in.
 */
export async function postMlroStatusUpdate(input: MlroDispatchInput): Promise<MlroDispatchResult> {
  const projectGid = input.projectGidOverride ?? process.env.ASANA_CENTRAL_MLRO_PROJECT_GID;
  if (!projectGid) {
    return { ok: true, skipped: 'no-project-gid' };
  }
  // asanaRequestWithRetry reports a config error when the token is
  // absent. Honour the same contract explicitly so callers can tell
  // "MLRO dispatch intentionally skipped" apart from "Asana down".
  // Accept the three legacy env var names the rest of the codebase
  // uses — ASANA_TOKEN (canonical), ASANA_ACCESS_TOKEN, ASANA_API_TOKEN.
  const hasToken =
    !!process.env.ASANA_TOKEN || !!process.env.ASANA_ACCESS_TOKEN || !!process.env.ASANA_API_TOKEN;
  if (!hasToken) {
    return { ok: true, skipped: 'no-asana-token' };
  }

  const text = clampToAsanaLimit(input.markdown);
  const statusType: MlroStatusColor = input.statusType ?? 'on_track';

  const payload = {
    data: {
      parent: projectGid,
      title: input.title,
      text,
      status_type: statusType,
    },
  };

  const result = await asanaRequestWithRetry<{ gid?: string }>('/status_updates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, statusUpdateGid: result.data?.gid };
}

/**
 * Decide the status colour for a report based on simple signals.
 * Pure, deterministic — tests pin the thresholds.
 */
export function deriveStatusColor(signals: {
  anyListMissing?: boolean;
  confirmedHits?: number;
  imminentBreaches?: number;
  overdueFilings?: number;
}): MlroStatusColor {
  if (
    signals.anyListMissing ||
    (signals.imminentBreaches ?? 0) > 0 ||
    (signals.confirmedHits ?? 0) > 0
  ) {
    return 'off_track';
  }
  if ((signals.overdueFilings ?? 0) > 0) {
    return 'at_risk';
  }
  return 'on_track';
}
