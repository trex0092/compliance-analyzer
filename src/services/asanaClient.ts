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
}

export interface AsanaTaskResponse {
  gid: string;
  name: string;
  completed: boolean;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000];
const RATE_LIMIT_DELAY = 250; // ms between requests to stay under 250 req/min

let lastRequestTime = 0;

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
  const browserProjectId =
    (typeof localStorage !== 'undefined' && localStorage.getItem('asanaProjectId')) || undefined;

  // Server-side (new — reads from Netlify env vars / Node env)
  const serverToken =
    typeof process !== 'undefined' && process.env?.ASANA_TOKEN
      ? process.env.ASANA_TOKEN
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
  if (elapsed < RATE_LIMIT_DELAY) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY - elapsed));
  }
  lastRequestTime = Date.now();
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
      const body = await res.text();
      return { ok: false, error: `Asana API ${res.status}: ${body}` };
    }

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
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await asanaRequest<T>(path, opts);
    if (result.ok) return result;

    // Don't retry config errors
    if (result.error?.includes('not configured')) return result;

    // Retry transient failures with exponential backoff
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
  return { ok: false, error: 'Asana request failed after max retries' };
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
