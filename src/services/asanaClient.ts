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

function getConfig(): AsanaConfig {
  return {
    token:
      (typeof window !== 'undefined' &&
        ((window as Record<string, unknown>).ASANA_TOKEN as string)) ||
      undefined,
    proxyUrl:
      (typeof window !== 'undefined' &&
        ((window as Record<string, unknown>).PROXY_URL as string)) ||
      undefined,
    defaultProjectId:
      (typeof localStorage !== 'undefined' && localStorage.getItem('asanaProjectId')) ||
      '1213759768596515',
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
