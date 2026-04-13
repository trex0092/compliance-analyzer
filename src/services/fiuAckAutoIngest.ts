/**
 * FIU Acknowledgement Auto-Ingest — Tier D3.
 *
 * Polls the goAML portal for acknowledgement updates and
 * auto-completes the STR lifecycle's `monitor-ack` subtask
 * when an ack lands. The real portal API requires a paid
 * credential (GOAML_PORTAL_API_KEY) — this module is a
 * stub that returns a deterministic "unconfigured" status
 * when the key isn't set, consistent with the Reuters
 * Refinitiv adapter pattern.
 *
 * When the key arrives, the fetcher function swaps for a
 * real HTTPS call without changing the ingestor contract.
 *
 * Pure fetcher + applier. The applier takes an AckEvent[]
 * and returns a list of subtask GIDs to mark complete;
 * the caller runs the real Asana updates.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.26-27 (STR monitoring requirement)
 *   - FDL No.10/2025 Art.24 (retention of acknowledgements)
 *   - MoE Circular 08/AML/2021 (goAML portal)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FiuAckEvent {
  strRef: string;
  caseId: string;
  ackReference: string;
  acknowledgedAtIso: string;
  status: 'received' | 'under_review' | 'accepted' | 'rejected';
  rejectReason?: string;
}

export type FiuAckStatus = 'unconfigured' | 'stub' | 'ok' | 'auth_failed' | 'network_error';

export interface FiuAckPollResult {
  status: FiuAckStatus;
  events: FiuAckEvent[];
  error?: string;
  fetchedAtIso: string;
}

export interface FiuAckConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Env + config
// ---------------------------------------------------------------------------

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[key]) return process.env[key];
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    const val = g[key];
    if (typeof val === 'string') return val;
  }
  return undefined;
}

export function resolveFiuAckConfig(overrides: FiuAckConfig = {}): FiuAckConfig {
  return {
    apiKey: overrides.apiKey ?? readEnv('GOAML_PORTAL_API_KEY'),
    baseUrl:
      overrides.baseUrl ?? readEnv('GOAML_PORTAL_BASE_URL') ?? 'https://goaml.uaefiu.gov.ae/api',
    timeoutMs: overrides.timeoutMs ?? 15_000,
  };
}

export function isFiuAckConfigured(overrides: FiuAckConfig = {}): boolean {
  const cfg = resolveFiuAckConfig(overrides);
  return !!cfg.apiKey;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

export async function pollFiuAcks(
  strRefs: readonly string[],
  overrides: FiuAckConfig = {}
): Promise<FiuAckPollResult> {
  const fetchedAtIso = new Date().toISOString();
  const cfg = resolveFiuAckConfig(overrides);

  if (!cfg.apiKey) {
    return {
      status: 'unconfigured',
      events: [],
      error:
        'GOAML_PORTAL_API_KEY not set. Ingestor will not poll the real portal until configured.',
      fetchedAtIso,
    };
  }

  if (cfg.apiKey === 'STUB' || cfg.apiKey.startsWith('stub:')) {
    return {
      status: 'stub',
      events: [],
      error: 'GOAML_PORTAL_API_KEY is a STUB placeholder. Waiting for real credential.',
      fetchedAtIso,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const res = await fetch(`${cfg.baseUrl}/acks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ strRefs }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      return { status: 'auth_failed', events: [], error: `HTTP ${res.status}`, fetchedAtIso };
    }
    if (!res.ok) {
      return { status: 'network_error', events: [], error: `HTTP ${res.status}`, fetchedAtIso };
    }
    const json = (await res.json()) as { events?: FiuAckEvent[] };
    return {
      status: 'ok',
      events: Array.isArray(json.events) ? json.events : [],
      fetchedAtIso,
    };
  } catch (err) {
    return {
      status: 'network_error',
      events: [],
      error: (err as Error).message,
      fetchedAtIso,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure applier — which subtasks to complete
// ---------------------------------------------------------------------------

export interface AckApplicationPlan {
  /** Subtask GIDs to mark complete. */
  completeSubtaskGids: string[];
  /** Parent GIDs to escalate (rejected acks). */
  escalateParentGids: string[];
  /** Events that couldn't be resolved to a local STR. */
  unresolvedCount: number;
}

export function planAckApplication(
  events: readonly FiuAckEvent[],
  resolveSubtask: (
    strRef: string
  ) => { monitorAckSubtaskGid?: string; parentGid?: string } | undefined
): AckApplicationPlan {
  const completeSubtaskGids: string[] = [];
  const escalateParentGids: string[] = [];
  let unresolvedCount = 0;

  for (const event of events) {
    const resolved = resolveSubtask(event.strRef);
    if (!resolved) {
      unresolvedCount++;
      continue;
    }
    if (event.status === 'accepted' || event.status === 'received') {
      if (resolved.monitorAckSubtaskGid) {
        completeSubtaskGids.push(resolved.monitorAckSubtaskGid);
      }
    }
    if (event.status === 'rejected' && resolved.parentGid) {
      escalateParentGids.push(resolved.parentGid);
    }
  }

  return { completeSubtaskGids, escalateParentGids, unresolvedCount };
}
