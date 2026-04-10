/**
 * Minimal Cachet v3 REST client.
 *
 * Cachet is the public-facing status page (https://github.com/cachethq/cachet).
 * The compliance suite pushes incidents here when a user-visible issue
 * needs to be communicated (scheduled maintenance, partial outage of the
 * screening service, regulator portal unreachable, etc.).
 *
 * Security:
 *  - CACHET_BASE_URL and CACHET_API_TOKEN must come from env vars.
 *  - No secrets are logged.
 *  - Requests time out after 10s to avoid hanging the autopilot.
 */
const TIMEOUT_MS = 10_000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Cachet: missing required env var ${name}`);
  return v;
}

async function cachetFetch(path, init = {}) {
  const base = requireEnv("CACHET_BASE_URL").replace(/\/+$/, "");
  const token = requireEnv("CACHET_API_TOKEN");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api/v1${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Cachet-Token": token,
        ...(init.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Cachet ${init.method ?? "GET"} ${path} -> ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cachet incident statuses:
 *   1 Investigating, 2 Identified, 3 Watching, 4 Fixed
 */
export const IncidentStatus = Object.freeze({
  INVESTIGATING: 1,
  IDENTIFIED: 2,
  WATCHING: 3,
  FIXED: 4,
});

export async function createIncident({
  name,
  message,
  status = IncidentStatus.INVESTIGATING,
  visible = 1,
  componentId,
  componentStatus,
}) {
  const body = { name, message, status, visible };
  if (componentId) body.component_id = componentId;
  if (componentStatus) body.component_status = componentStatus;
  return cachetFetch("/incidents", { method: "POST", body: JSON.stringify(body) });
}

export async function updateIncident(id, patch) {
  return cachetFetch(`/incidents/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export async function listIncidents() {
  return cachetFetch("/incidents");
}

export default { IncidentStatus, createIncident, updateIncident, listIncidents };
