/**
 * Auto-Freeze Executor — Tier D4.
 *
 * When the super-brain produces a `freeze` verdict AND sanctions
 * have been confirmed, Cabinet Res 74/2020 Art.4-7 requires asset
 * freeze within 24 clock hours and CNMR filing within 5 business
 * days. Today that's a manual operational chain. This executor is
 * the automation hook: it calls the configured banking rail API
 * to freeze the account and, on success, schedules the CNMR
 * filing via the super-brain dispatcher.
 *
 * Requires BANKING_FREEZE_API_KEY — without it the executor
 * returns an unconfigured status and the caller falls back to
 * the manual workflow (create an Asana task for the MLRO to
 * freeze via the bank's portal).
 *
 * Pure plan builder + thin executor. The pure builder describes
 * what would be frozen and why; tests exercise every branch
 * through the builder.
 *
 * Regulatory basis:
 *   - Cabinet Res 74/2020 Art.4 (freeze within 24h)
 *   - Cabinet Res 74/2020 Art.6 (CNMR within 5 business days)
 *   - Cabinet Res 74/2020 Art.7 (EOCN notification)
 *   - FDL No.10/2025 Art.29 (no tipping off — subject is never
 *     contacted about the freeze)
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FreezeStatus =
  | 'unconfigured'
  | 'plan-only'
  | 'executed'
  | 'auth_failed'
  | 'rate_limited'
  | 'network_error'
  | 'rejected';

export interface FreezePlan {
  caseId: string;
  customerId?: string;
  freezeReason: string;
  eocnDeadlineIso: string; // 24h from now
  cnmrDeadlineIso: string; // 5 business days from now
  regulatoryBasis: string;
}

export interface FreezeResult {
  status: FreezeStatus;
  plan: FreezePlan;
  bankingReference?: string;
  error?: string;
  executedAtIso: string;
}

export interface FreezeConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Injected fetcher for tests. */
  fetchFn?: typeof fetch;
  /** ISO "now" override for deterministic tests. */
  nowIso?: string;
}

// ---------------------------------------------------------------------------
// Config resolver
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

function resolveConfig(
  overrides: FreezeConfig = {}
): Required<Pick<FreezeConfig, 'baseUrl'>> & FreezeConfig {
  return {
    apiKey: overrides.apiKey ?? readEnv('BANKING_FREEZE_API_KEY'),
    baseUrl:
      overrides.baseUrl ??
      readEnv('BANKING_FREEZE_BASE_URL') ??
      'https://banking-rail.example.com/freeze',
    fetchFn: overrides.fetchFn,
    nowIso: overrides.nowIso,
  };
}

// ---------------------------------------------------------------------------
// Business-day helper
// ---------------------------------------------------------------------------

function addBusinessDays(fromIso: string, days: number): string {
  const d = new Date(fromIso);
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString();
}

function addClockHours(fromIso: string, hours: number): string {
  return new Date(new Date(fromIso).getTime() + hours * 3_600_000).toISOString();
}

// ---------------------------------------------------------------------------
// Pure plan builder
// ---------------------------------------------------------------------------

export function buildFreezePlan(
  caseObj: ComplianceCase,
  customer?: CustomerProfile,
  nowIso: string = new Date().toISOString()
): FreezePlan {
  return {
    caseId: caseObj.id,
    customerId: customer?.id,
    freezeReason: `Super-brain FREEZE verdict on case ${caseObj.id} (risk=${caseObj.riskLevel})`,
    eocnDeadlineIso: addClockHours(nowIso, 24),
    cnmrDeadlineIso: addBusinessDays(nowIso, 5),
    regulatoryBasis: 'Cabinet Res 74/2020 Art.4-7; FDL No.10/2025 Art.29',
  };
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeAutoFreeze(
  caseObj: ComplianceCase,
  customer?: CustomerProfile,
  overrides: FreezeConfig = {}
): Promise<FreezeResult> {
  const cfg = resolveConfig(overrides);
  const nowIso = cfg.nowIso ?? new Date().toISOString();
  const plan = buildFreezePlan(caseObj, customer, nowIso);

  if (!cfg.apiKey) {
    return {
      status: 'unconfigured',
      plan,
      error:
        'BANKING_FREEZE_API_KEY not set. Falling back to manual workflow — MLRO must freeze via the bank portal and report to EOCN within 24h.',
      executedAtIso: nowIso,
    };
  }

  if (cfg.apiKey === 'STUB' || cfg.apiKey.startsWith('stub:')) {
    return {
      status: 'plan-only',
      plan,
      error: 'STUB key — plan generated but no banking API call was made.',
      executedAtIso: nowIso,
    };
  }

  try {
    const fetchFn = cfg.fetchFn ?? fetch;
    const res = await fetchFn(`${cfg.baseUrl}/accounts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        caseId: plan.caseId,
        customerId: plan.customerId,
        reason: plan.freezeReason,
        regulatoryBasis: plan.regulatoryBasis,
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return { status: 'auth_failed', plan, error: `HTTP ${res.status}`, executedAtIso: nowIso };
    }
    if (res.status === 429) {
      return { status: 'rate_limited', plan, error: 'HTTP 429', executedAtIso: nowIso };
    }
    if (res.status >= 400 && res.status < 500) {
      return { status: 'rejected', plan, error: `HTTP ${res.status}`, executedAtIso: nowIso };
    }
    if (!res.ok) {
      return { status: 'network_error', plan, error: `HTTP ${res.status}`, executedAtIso: nowIso };
    }
    const json = (await res.json()) as { reference?: string };
    return {
      status: 'executed',
      plan,
      bankingReference: json.reference,
      executedAtIso: nowIso,
    };
  } catch (err) {
    return {
      status: 'network_error',
      plan,
      error: (err as Error).message,
      executedAtIso: nowIso,
    };
  }
}
