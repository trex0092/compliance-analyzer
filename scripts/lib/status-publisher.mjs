/**
 * Status Publisher — abstract over Cachet + in-repo fallback
 *
 * The autopilot and the brain endpoint want to publish user-visible
 * incidents (sanctions freeze, filing breach, evidence-chain break)
 * somewhere operators can see them. We support two backends:
 *
 *   1. Cachet   — external status page (https://github.com/cachethq/cachet)
 *                 Active when CACHET_BASE_URL + CACHET_API_TOKEN are set.
 *   2. Blob log — in-repo Netlify Blobs store `status-incidents` with
 *                 a JSON log that the React app reads.
 *                 Always active (free, no external setup).
 *
 * The publisher fires on BOTH backends — one is the source of truth,
 * the other a fallback for UI that doesn't have Cachet configured yet.
 *
 * Rationale: recommendation #5 from the closing summary — get the
 * status publishing working without waiting on Cachet VPS setup.
 */
import cachet, { IncidentStatus } from './cachet-client.mjs';

export const SEVERITY_TO_CACHET_STATUS = Object.freeze({
  investigating: IncidentStatus.INVESTIGATING,
  identified:    IncidentStatus.IDENTIFIED,
  watching:      IncidentStatus.WATCHING,
  fixed:         IncidentStatus.FIXED,
});

/**
 * Check whether Cachet is configured.
 * @returns {boolean}
 */
export function isCachetConfigured() {
  return Boolean(process.env.CACHET_BASE_URL && process.env.CACHET_API_TOKEN);
}

/**
 * Append an incident to the in-repo Blob log. Best-effort; returns
 * a result object instead of throwing on failure so the caller can
 * decide whether to escalate.
 *
 * @param {object} incident
 * @returns {Promise<{published: boolean, reason?: string}>}
 */
async function publishToBlobLog(incident) {
  // Lazy-load @netlify/blobs so this module is usable from tests
  // that don't have the Netlify runtime.
  let getStore;
  try {
    ({ getStore } = await import('@netlify/blobs'));
  } catch (err) {
    return { published: false, reason: `blobs_unavailable:${err.message}` };
  }

  try {
    const store = getStore('status-incidents');
    const today = new Date().toISOString().slice(0, 10);
    const key = `incidents/${today}.json`;
    const existing = (await store.get(key, { type: 'json' })) ?? [];
    const next = [
      ...existing,
      {
        at: new Date().toISOString(),
        ...incident,
      },
    ];
    // Cap the per-day log at 1000 entries to avoid blob bloat.
    const trimmed = next.slice(-1000);
    await store.setJSON(key, trimmed);
    return { published: true };
  } catch (err) {
    return { published: false, reason: `blob_error:${err.message}` };
  }
}

/**
 * Publish a single incident to all configured backends.
 *
 * @param {{
 *   name: string,
 *   message: string,
 *   severity?: 'investigating' | 'identified' | 'watching' | 'fixed',
 *   visible?: boolean,
 *   componentId?: number,
 *   componentStatus?: number
 * }} incident
 * @returns {Promise<{
 *   cachet: { published: boolean, reason?: string },
 *   blob:   { published: boolean, reason?: string }
 * }>}
 */
export async function publishIncident(incident) {
  if (!incident || typeof incident !== 'object') {
    throw new TypeError('publishIncident requires an incident object');
  }
  if (!incident.name || typeof incident.name !== 'string') {
    throw new TypeError('incident.name is required');
  }
  if (!incident.message || typeof incident.message !== 'string') {
    throw new TypeError('incident.message is required');
  }

  const severity = incident.severity ?? 'investigating';
  const cachetStatus = SEVERITY_TO_CACHET_STATUS[severity];
  if (!cachetStatus) {
    throw new TypeError(
      `unknown severity: ${severity}. Valid: ${Object.keys(SEVERITY_TO_CACHET_STATUS).join(', ')}`,
    );
  }

  // 1. Cachet (if configured)
  let cachetResult = { published: false, reason: 'cachet_not_configured' };
  if (isCachetConfigured()) {
    try {
      await cachet.createIncident({
        name: incident.name.slice(0, 120),
        message: incident.message.slice(0, 2000),
        status: cachetStatus,
        visible: incident.visible === false ? 0 : 1,
        ...(incident.componentId ? { componentId: incident.componentId } : {}),
        ...(incident.componentStatus ? { componentStatus: incident.componentStatus } : {}),
      });
      cachetResult = { published: true };
    } catch (err) {
      cachetResult = { published: false, reason: `cachet_error:${err.message}` };
    }
  }

  // 2. Blob log (always)
  const blobResult = await publishToBlobLog({
    name: incident.name.slice(0, 120),
    message: incident.message.slice(0, 2000),
    severity,
    visible: incident.visible !== false,
  });

  return { cachet: cachetResult, blob: blobResult };
}

/**
 * Convenience for tests: truncate + normalise an incident without
 * actually publishing.
 */
export function normalizeIncident(incident) {
  return {
    name: (incident?.name ?? '').slice(0, 120),
    message: (incident?.message ?? '').slice(0, 2000),
    severity: incident?.severity ?? 'investigating',
    visible: incident?.visible !== false,
  };
}

export default { publishIncident, isCachetConfigured, normalizeIncident };
