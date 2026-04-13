/**
 * Tenant Rate Budget — Tier C3.
 *
 * Per-tenant token-bucket rate budgeter. The existing
 * TenantRateLimiter in asanaMultiTenancy.ts is a per-request
 * delay calculator; this module adds a budget view so ops
 * dashboards can show how much budget each tenant has burned
 * vs. remaining, and so the batch dispatcher can choose to
 * throttle a tenant before its share exhausts the workspace-
 * wide 250 req/min limit.
 *
 * Pure token-bucket implementation. Callers:
 *   - consume(tenantId, n) — subtracts n tokens, returns true
 *     when allowed, false when the tenant is over budget
 *   - snapshot() — returns a per-tenant budget snapshot for
 *     the Asana health tile
 *   - refill() — called on a timer by the caller to top up
 *     tokens (not auto — callers control their own clock)
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (multi-tenant isolation)
 *   - No regulatory imperative for rate budgeting per se;
 *     this is a resilience control
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantBudgetConfig {
  /** Tokens per minute the tenant is allowed. */
  tokensPerMinute: number;
  /** Burst capacity (max tokens the bucket can hold). */
  burstCapacity: number;
}

export interface TenantBudgetSnapshot {
  tenantId: string;
  tokensRemaining: number;
  tokensPerMinute: number;
  burstCapacity: number;
  utilizationPct: number;
  exhausted: boolean;
}

// ---------------------------------------------------------------------------
// Token-bucket state
// ---------------------------------------------------------------------------

interface BucketState {
  tokens: number;
  lastRefillMs: number;
  config: TenantBudgetConfig;
}

const DEFAULT_CONFIG: TenantBudgetConfig = {
  tokensPerMinute: 100,
  burstCapacity: 150,
};

const buckets = new Map<string, BucketState>();

function getBucket(tenantId: string, config?: TenantBudgetConfig): BucketState {
  const existing = buckets.get(tenantId);
  if (existing) return existing;
  const fresh: BucketState = {
    tokens: (config ?? DEFAULT_CONFIG).burstCapacity,
    lastRefillMs: Date.now(),
    config: config ?? DEFAULT_CONFIG,
  };
  buckets.set(tenantId, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export function configureTenantBudget(tenantId: string, config: TenantBudgetConfig): void {
  const bucket = getBucket(tenantId, config);
  bucket.config = config;
  if (bucket.tokens > config.burstCapacity) {
    bucket.tokens = config.burstCapacity;
  }
}

/**
 * Try to consume `n` tokens. Returns true when allowed, false
 * when the tenant would exceed its budget. Auto-refills the
 * bucket based on wall-clock elapsed time.
 */
export function consumeTenantTokens(
  tenantId: string,
  n: number,
  nowMs: number = Date.now()
): boolean {
  const bucket = getBucket(tenantId);
  // Auto-refill.
  const elapsedMinutes = (nowMs - bucket.lastRefillMs) / 60_000;
  if (elapsedMinutes > 0) {
    const newTokens = bucket.tokens + bucket.config.tokensPerMinute * elapsedMinutes;
    bucket.tokens = Math.min(bucket.config.burstCapacity, newTokens);
    bucket.lastRefillMs = nowMs;
  }

  if (bucket.tokens < n) return false;
  bucket.tokens -= n;
  return true;
}

export function snapshotTenantBudgets(nowMs: number = Date.now()): TenantBudgetSnapshot[] {
  const result: TenantBudgetSnapshot[] = [];
  for (const [tenantId, bucket] of buckets) {
    // Refresh refill math without consuming.
    const elapsedMinutes = (nowMs - bucket.lastRefillMs) / 60_000;
    const effectiveTokens =
      elapsedMinutes > 0
        ? Math.min(
            bucket.config.burstCapacity,
            bucket.tokens + bucket.config.tokensPerMinute * elapsedMinutes
          )
        : bucket.tokens;
    result.push({
      tenantId,
      tokensRemaining: Math.round(effectiveTokens),
      tokensPerMinute: bucket.config.tokensPerMinute,
      burstCapacity: bucket.config.burstCapacity,
      utilizationPct:
        bucket.config.burstCapacity > 0
          ? ((bucket.config.burstCapacity - effectiveTokens) / bucket.config.burstCapacity) * 100
          : 0,
      exhausted: effectiveTokens <= 0,
    });
  }
  return result;
}

export function __resetTenantBudgetsForTests(): void {
  buckets.clear();
}
