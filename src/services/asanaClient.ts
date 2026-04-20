/**
 * Asana API client with retry, rate limiting, and customer-specific project routing.
 */

export interface AsanaConfig {
  token?: string;
  proxyUrl?: string;
  defaultProjectId: string;
}

export interface AsanaTaskPayload {
  name: string;
  notes: string;
  projects: string[];
  due_on?: string;
  /**
   * Optional Asana custom fields. Keys must be custom field GIDs from the
   * target workspace. Values are the raw payload shape Asana expects
   * (enum GID for enum fields, number for number fields, string for text).
   *
   * Built via src/services/asanaCustomFields.ts so callers never hand-craft
   * the map — they pass compliance enums and the builder maps them to the
   * configured field GIDs.
   */
  custom_fields?: Record<string, string | number | boolean>;
  /**
   * Optional assignee GID. Resolved via resolveAsanaUserByName() for
   * scheduled jobs, or set directly when the caller already knows the GID.
   */
  assignee?: string;
  /**
   * Optional parent task GID. When set, Asana creates this task as a
   * subtask of the given parent. Used by the brain → Asana orchestrator
   * to build parent + subtask hierarchies in a single atomic create call.
   */
  parent?: string;
  /**
   * Optional free-form tag labels. These are NOT Asana tag GIDs — they
   * are compliance-orchestrator labels mirrored into the task notes for
   * downstream filtering and reporting.
   */
  tags?: readonly string[];
}

export interface AsanaTaskResponse {
  gid: string;
  name: string;
  completed: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000];
const RATE_LIMIT_DELAY_DEFAULT = 250; // ms between requests to stay under 250 req/min

// Adaptive rate limiting state. The current delay starts at the default
// (250ms) and grows toward the server's Retry-After value when Asana
// returns 429. It decays back toward the default on successful responses.
// This replaces the previous fixed 250ms delay with something that
// actually respects server-side backpressure.
let lastRequestTime = 0;
let currentDelayMs = RATE_LIMIT_DELAY_DEFAULT;

/** Exposed for tests to reset adaptive-rate-limit state between runs. */
export function __resetAdaptiveRateLimit(): void {
  lastRequestTime = 0;
  currentDelayMs = RATE_LIMIT_DELAY_DEFAULT;
}

/**
 * Resolve the Asana config at call time.
 *
 * Two-layer lookup:
 *   1. Browser (legacy): window.ASANA_TOKEN / window.PROXY_URL / localStorage
 *   2. Server (new, for scheduled functions): process.env.ASANA_TOKEN /
 *      process.env.ASANA_SCREENINGS_PROJECT_GID
 *
 * The browser path is unchanged for backwards compatibility with the
 * existing in-tool Settings panel. Server-side callers (Netlify
 * functions, GitHub Actions scripts) don't have window/localStorage
 * and fall through to the process.env branch automatically.
 */
function getConfig(): AsanaConfig {
  // Browser-side (existing behavior)
  const browserToken =
    (typeof window !== 'undefined' &&
      ((window as unknown as Record<string, unknown>).ASANA_TOKEN as string)) ||
    undefined;
  const browserProxy =
    (typeof window !== 'undefined' &&
      ((window as unknown as Record<string, unknown>).PROXY_URL as string)) ||
    undefined;
  // Defensive guard — several sibling tests set globalThis.localStorage
  // to a partial shim in beforeEach without clearing it in afterEach, so
  // the stale global can reach this module as an `{}` object that passes
  // `typeof !== 'undefined'` but has no getItem. Require getItem to be
  // a callable function before we use it. Server-side callers (Netlify
  // functions, crons) still fall through to the process.env branch
  // below because typeof localStorage is strictly 'undefined' there.
  const browserProjectId =
    (typeof localStorage !== 'undefined' &&
      typeof localStorage.getItem === 'function' &&
      localStorage.getItem('asanaProjectId')) ||
    undefined;

  // Server-side (new — reads from Netlify env vars / Node env).
  // Accept three legacy env var names for the Asana PAT: ASANA_TOKEN
  // (canonical), ASANA_ACCESS_TOKEN and ASANA_API_TOKEN (both in use
  // across existing crons + setup scripts). First hit wins.
  const serverToken =
    typeof process !== 'undefined'
      ? process.env?.ASANA_TOKEN ||
        process.env?.ASANA_ACCESS_TOKEN ||
        process.env?.ASANA_API_TOKEN ||
        undefined
      : undefined;
  const serverProjectId =
    typeof process !== 'undefined' && process.env?.ASANA_SCREENINGS_PROJECT_GID
      ? process.env.ASANA_SCREENINGS_PROJECT_GID
      : undefined;

  return {
    token: browserToken || serverToken,
    proxyUrl: browserProxy,
    defaultProjectId: browserProjectId || serverProjectId || '1213759768596515',
  };
}

/**
 * Server-only configuration used by scheduled monitoring jobs.
 * Reads workspace GID and default assignee name from env vars set in
 * Netlify dashboard. Returns undefined fields when running in the
 * browser or when the env vars are missing.
 */
export interface AsanaServerConfig {
  workspaceGid?: string;
  assigneeName?: string;
}

export function getAsanaServerConfig(): AsanaServerConfig {
  if (typeof process === 'undefined' || !process.env) return {};
  return {
    workspaceGid: process.env.ASANA_WORKSPACE_GID,
    assigneeName: process.env.ASANA_DEFAULT_ASSIGNEE_NAME,
  };
}

export function isAsanaConfigured(): boolean {
  const cfg = getConfig();
  return !!(cfg.token || cfg.proxyUrl);
}

async function rateLimitedWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < currentDelayMs) {
    await new Promise((r) => setTimeout(r, currentDelayMs - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Honour an Asana Retry-After header by growing the adaptive delay so
 * the next request waits at least that long. Called after a 429.
 *
 * Asana may return the value as seconds (integer) or HTTP-date. We parse
 * both forms; malformed values fall back to doubling the current delay
 * (capped at 30s) so we always back off on 429.
 */
function honourRetryAfter(headers: Headers): void {
  const raw = headers.get('retry-after');
  let waitMs = currentDelayMs * 2;
  if (raw) {
    const asSeconds = Number.parseFloat(raw);
    if (Number.isFinite(asSeconds) && asSeconds > 0) {
      waitMs = Math.ceil(asSeconds * 1000);
    } else {
      const asDateMs = Date.parse(raw);
      if (Number.isFinite(asDateMs)) {
        waitMs = Math.max(0, asDateMs - Date.now());
      }
    }
  }
  // Cap at 30s so a misbehaving proxy can't freeze us indefinitely.
  currentDelayMs = Math.min(30_000, Math.max(currentDelayMs, waitMs));
}

/** Decay the adaptive delay toward the default on successful responses. */
function decayRateLimit(): void {
  if (currentDelayMs > RATE_LIMIT_DELAY_DEFAULT) {
    // Exponential decay: halve the excess each successful call.
    const excess = currentDelayMs - RATE_LIMIT_DELAY_DEFAULT;
    currentDelayMs = RATE_LIMIT_DELAY_DEFAULT + Math.floor(excess / 2);
    if (currentDelayMs < RATE_LIMIT_DELAY_DEFAULT + 10) {
      currentDelayMs = RATE_LIMIT_DELAY_DEFAULT;
    }
  }
}

async function asanaRequest<T>(
  path: string,
  opts: RequestInit = {}
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const cfg = getConfig();
  if (!cfg.token && !cfg.proxyUrl) {
    return { ok: false, error: 'Asana not configured — set Proxy URL or Asana token in Settings' };
  }

  await rateLimitedWait();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };

  let url: string;
  if (cfg.proxyUrl) {
    url = `${cfg.proxyUrl}/asana${path}`;
  } else {
    url = `https://app.asana.com/api/1.0${path}`;
    if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      ...opts,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // 429 rate limit: respect Retry-After and grow the adaptive delay
      // so the next call waits long enough. The caller's retry loop
      // (asanaRequestWithRetry) will then wait out the new delay.
      if (res.status === 429) {
        honourRetryAfter(res.headers);
      }
      const body = await res.text();
      return { ok: false, error: `Asana API ${res.status}: ${body}` };
    }

    // Success: decay the adaptive delay back toward the default so we
    // don't punish future calls for a transient 429.
    decayRateLimit();

    const json = await res.json();
    return { ok: true, data: json.data as T };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, error: `Asana request failed: ${(err as Error).message}` };
  }
}

export async function asanaRequestWithRetry<T>(
  path: string,
  opts: RequestInit = {}
): Promise<{ ok: boolean; data?: T; error?: string }> {
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await asanaRequest<T>(path, opts);
    if (result.ok) return result;
    lastError = result.error;

    // Don't retry config errors (token missing, proxy misconfigured)
    if (result.error?.includes('not configured')) return result;

    // Retry transient failures with exponential backoff
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
  // Preserve the ACTUAL last error (status code, body, network message)
  // so callers can distinguish 401/403/429/500/timeout. The old behavior
  // of collapsing everything to "failed after max retries" made it
  // impossible to triage production failures — you couldn't tell a
  // stale token from a rate limit from an outage.
  return {
    ok: false,
    error: `Asana request failed after ${MAX_RETRIES + 1} attempts: ${lastError ?? 'unknown error'}`,
  };
}

export async function createAsanaTask(
  payload: AsanaTaskPayload
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  const result = await asanaRequestWithRetry<AsanaTaskResponse>('/tasks', {
    method: 'POST',
    body: JSON.stringify({ data: payload }),
  });

  if (result.ok && result.data) {
    return { ok: true, gid: result.data.gid };
  }
  return { ok: false, error: result.error };
}

export async function updateAsanaTask(
  taskGid: string,
  updates: Partial<Pick<AsanaTaskPayload, 'name' | 'notes'> & { completed: boolean }>
): Promise<{ ok: boolean; error?: string }> {
  const result = await asanaRequestWithRetry<AsanaTaskResponse>(`/tasks/${taskGid}`, {
    method: 'PUT',
    body: JSON.stringify({ data: updates }),
  });
  return { ok: result.ok, error: result.error };
}

export async function listProjectTasks(
  projectId: string,
  optFields = 'name,gid,completed,due_on,notes'
): Promise<{ ok: boolean; tasks?: AsanaTaskResponse[]; error?: string }> {
  const result = await asanaRequestWithRetry<AsanaTaskResponse[]>(
    `/projects/${projectId}/tasks?opt_fields=${optFields}&limit=100`
  );
  if (result.ok) {
    return { ok: true, tasks: result.data ?? [] };
  }
  return { ok: false, error: result.error };
}

// ─── Attachments ────────────────────────────────────────────────────────────

export interface AsanaAttachmentResponse {
  gid: string;
  name: string;
  download_url?: string;
  permanent_url?: string;
}

/**
 * Upload a file as an attachment on an Asana task.
 *
 * Asana's /tasks/{gid}/attachments endpoint expects multipart/form-data
 * with a `file` field. This helper builds the FormData payload and
 * POSTs it through the same rate-limited transport as the rest of the
 * client. Works on both Node (native FormData + Blob) and the browser.
 *
 * Used by the scheduled-screening runner to attach
 * complianceReportBuilder artefacts (HTML + JSON + Markdown) to the
 * daily heartbeat and per-subject alert tasks so every task carries
 * its own audit-grade evidence bundle.
 *
 * Regulatory basis: FDL No.10/2025 Art.24 (10-year record retention);
 * MoE Circular 08/AML/2021 (goAML evidence chain); LBMA RGG v9
 * (annual audit pack attachments).
 */
export async function uploadAsanaAttachment(
  taskGid: string,
  fileName: string,
  contentType: string,
  content: string | Uint8Array
): Promise<{ ok: boolean; attachment?: AsanaAttachmentResponse; error?: string }> {
  const cfg = getConfig();
  if (!cfg.token && !cfg.proxyUrl) {
    return {
      ok: false,
      error: 'Asana not configured — set Proxy URL or Asana token in Settings',
    };
  }

  // Use the global FormData / Blob — available in Node 20+ and the browser.
  // We intentionally avoid `Buffer` so this module stays browser-safe.
  const body = new FormData();
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: contentType })
      : new Blob([content.buffer as ArrayBuffer], { type: contentType });
  body.append('file', blob, fileName);

  await rateLimitedWait();

  const headers: Record<string, string> = {};
  let url: string;
  if (cfg.proxyUrl) {
    url = `${cfg.proxyUrl}/asana/tasks/${encodeURIComponent(taskGid)}/attachments`;
  } else {
    url = `https://app.asana.com/api/1.0/tasks/${encodeURIComponent(taskGid)}/attachments`;
    if (cfg.token) headers['Authorization'] = `Bearer ${cfg.token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    // NOTE: do NOT set Content-Type manually — fetch fills in the
    // correct `multipart/form-data; boundary=...` when body is FormData.
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status === 429) honourRetryAfter(res.headers);
      const text = await res.text();
      return {
        ok: false,
        error: `Asana attachment upload ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    decayRateLimit();

    const json = (await res.json()) as { data?: AsanaAttachmentResponse };
    return { ok: true, attachment: json.data };
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      error: `Asana attachment upload failed: ${(err as Error).message}`,
    };
  }
}

// ─── User Directory ─────────────────────────────────────────────────────────

export interface AsanaUser {
  gid: string;
  name: string;
  email?: string;
}

/**
 * List all users in a workspace via GET /workspaces/{gid}/users.
 *
 * Used by the scheduled monitoring function to resolve the default
 * assignee (e.g. "Luisa Fernanda") into an Asana user GID so alert
 * tasks can be auto-assigned. Requires the token to have at least
 * read access to the workspace.
 */
export async function listWorkspaceUsers(
  workspaceGid: string
): Promise<{ ok: boolean; users?: AsanaUser[]; error?: string }> {
  if (!workspaceGid) {
    return { ok: false, error: 'listWorkspaceUsers: workspaceGid is required' };
  }
  const result = await asanaRequestWithRetry<AsanaUser[]>(
    `/workspaces/${encodeURIComponent(workspaceGid)}/users?opt_fields=gid,name,email`
  );
  if (result.ok) {
    return { ok: true, users: result.data ?? [] };
  }
  return { ok: false, error: result.error };
}

/**
 * Resolve an Asana user by display name (case-insensitive substring match).
 *
 * Returns the FIRST match. If multiple users in the workspace have names
 * containing the needle, the resolver returns the first one and logs a
 * warning in the result's `error` field (on success) — this is intentional
 * so the caller can still dispatch the task but decide whether to escalate
 * the ambiguity.
 *
 * Example: resolveAsanaUserByName('1213645083721316', 'Luisa Fernanda')
 *   → finds the user whose displayName is "Luisa Fernanda Ramirez"
 *   → returns { ok: true, user: { gid: '...', name: '...', email: '...' } }
 *
 * If zero users match, returns { ok: false, error: '...' } — the caller
 * should create the task anyway (unassigned) and log the failure so an
 * operator can manually fix the config.
 */
export async function resolveAsanaUserByName(
  workspaceGid: string,
  name: string
): Promise<{ ok: boolean; user?: AsanaUser; warning?: string; error?: string }> {
  if (!name || name.trim().length === 0) {
    return { ok: false, error: 'resolveAsanaUserByName: name is required' };
  }
  const listResult = await listWorkspaceUsers(workspaceGid);
  if (!listResult.ok) return { ok: false, error: listResult.error };

  const users = listResult.users ?? [];
  const needle = name.toLowerCase().trim();
  const matches = users.filter((u) => u.name.toLowerCase().includes(needle));

  if (matches.length === 0) {
    return {
      ok: false,
      error: `No Asana user found matching "${name}" in workspace ${workspaceGid}`,
    };
  }

  if (matches.length > 1) {
    return {
      ok: true,
      user: matches[0],
      warning: `${matches.length} users matched "${name}"; returning first (${matches[0].name}). Consider using a more specific name.`,
    };
  }

  return { ok: true, user: matches[0] };
}
