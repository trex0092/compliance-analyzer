/**
 * Per-tenant token-bucket rate limit — Phase 19 W-A (pure compute).
 *
 * The existing asanaClient.ts has a 250 ms adaptive delay but no
 * per-tenant budget. A single tenant firing a high-volume event
 * window can exhaust the workspace-level rate budget and 429 every
 * other tenant's dispatch until the window resets. This module
 * adds a token-bucket keyed on tenantId so one tenant's burst
 * cannot starve another's.
 *
 * Design:
 *   - Token bucket per tenantId. State is caller-supplied as a
 *     Map so the same bucket can be reused across calls and across
 *     modules without module-level mutable singletons (easier to
 *     test and easier to plug into a future Netlify Blobs backing
 *     store if cross-instance sharing is needed).
 *   - Refill rate and burst size are per-tenant constants, with a
 *     fallback to DEFAULT_RATE and DEFAULT_BURST. Overridable per
 *     tenant via a tenantOverrides map so premium or batch-heavy
 *     tenants can be loosened without source changes.
 *   - Pure compute: the caller passes `now` (ms since epoch). The
 *     bucket state is mutated in place on success and left alone
 *     on rejection so a rejected call can be retried without
 *     forfeiting the capacity.
 *   - Result includes retry-after (ms) on rejection so the caller
 *     can schedule a retry at exactly the right moment.
 *
 * Defaults: 60 tokens per 60 s refill, burst 10. Chosen to match
 * the Phase 19 spec (#182). Override via ASANA_TENANT_RATE and
 * ASANA_TENANT_BURST env vars in the wiring PR.
 *
 * Regulatory anchor:
 *   FDL No. 10 of 2025 Art.20 — MLRO visibility of compliance
 *     controls must not be starved by another tenant's activity.
 *   Cabinet Resolution 134/2025 Art.19 — internal review requires
 *     monitorable controls; rate-limit events are logged so the
 *     MLRO can see when a tenant is throttled.
 */

export interface TenantBucketState {
  /** Remaining tokens. Fractional — refilled at a continuous rate. */
  tokens: number;
  /** Last time tokens were refilled (ms since epoch). */
  lastRefillAt: number;
}

export interface RateLimitConfig {
  /** Tokens refilled per second. Default: 1 (= 60/min). */
  refillPerSecond: number;
  /** Max tokens the bucket can hold (burst). Default: 10. */
  burst: number;
}

export interface RateLimitOptions {
  /** Per-tenant overrides. Missing tenants use DEFAULT_CONFIG. */
  tenantOverrides?: Readonly<Record<string, RateLimitConfig>>;
  /** Fallback config for tenants not in tenantOverrides. */
  defaultConfig?: RateLimitConfig;
}

export interface RateLimitAllow {
  ok: true;
  tenantId: string;
  /** Tokens remaining after this call. */
  tokensRemaining: number;
}

export interface RateLimitReject {
  ok: false;
  tenantId: string;
  /** Milliseconds until the bucket has enough tokens for a single call. */
  retryAfterMs: number;
  /** Tokens the caller would have needed (always 1 today). */
  neededTokens: number;
  /** Tokens in the bucket at the moment of rejection. */
  tokensAvailable: number;
}

export type RateLimitResult = RateLimitAllow | RateLimitReject;

export const DEFAULT_CONFIG: RateLimitConfig = Object.freeze({
  refillPerSecond: 1,
  burst: 10,
});

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

function configFor(tenantId: string, options: RateLimitOptions | undefined): RateLimitConfig {
  const overrides = options?.tenantOverrides;
  if (overrides && overrides[tenantId]) return overrides[tenantId];
  return options?.defaultConfig ?? DEFAULT_CONFIG;
}

function refill(bucket: TenantBucketState, config: RateLimitConfig, now: number): void {
  if (now <= bucket.lastRefillAt) return;
  const elapsedSeconds = (now - bucket.lastRefillAt) / 1000;
  const refillAmount = elapsedSeconds * config.refillPerSecond;
  bucket.tokens = Math.min(config.burst, bucket.tokens + refillAmount);
  bucket.lastRefillAt = now;
}

/**
 * Try to consume one token from the tenant's bucket at time `now`.
 * Mutates the bucket state on success; leaves it unchanged on
 * rejection (the caller's retry path is not punished).
 */
export function tryAcquire(
  tenantId: string,
  bucketState: Map<string, TenantBucketState>,
  now: number,
  options?: RateLimitOptions
): RateLimitResult {
  const config = configFor(tenantId, options);

  let bucket = bucketState.get(tenantId);
  if (!bucket) {
    // New tenant — start with a full burst so first-hit dispatches
    // are immediate. Matches Netlify rate-limit middleware behaviour.
    bucket = { tokens: config.burst, lastRefillAt: now };
    bucketState.set(tenantId, bucket);
  }

  refill(bucket, config, now);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, tenantId, tokensRemaining: bucket.tokens };
  }

  // Not enough tokens. Compute ms until bucket reaches 1 token.
  const deficit = 1 - bucket.tokens;
  const msToOneToken = Math.ceil((deficit / config.refillPerSecond) * 1000);

  return {
    ok: false,
    tenantId,
    retryAfterMs: msToOneToken,
    neededTokens: 1,
    tokensAvailable: bucket.tokens,
  };
}

/**
 * Inspect a tenant's bucket without consuming a token. Useful for
 * telemetry and for the MLRO dashboard's "who is throttled" view.
 */
export function peekBucket(
  tenantId: string,
  bucketState: Map<string, TenantBucketState>,
  now: number,
  options?: RateLimitOptions
): { tenantId: string; tokens: number; burst: number } {
  const config = configFor(tenantId, options);
  const bucket = bucketState.get(tenantId);
  if (!bucket) {
    return { tenantId, tokens: config.burst, burst: config.burst };
  }
  // Non-mutating view: compute the current tokens as of `now`
  // without writing back.
  const elapsedSeconds = Math.max(0, (now - bucket.lastRefillAt) / 1000);
  const refillAmount = elapsedSeconds * config.refillPerSecond;
  const tokens = Math.min(config.burst, bucket.tokens + refillAmount);
  return { tenantId, tokens, burst: config.burst };
}

/**
 * Reset the bucket for a tenant — exported for tests and for the
 * /regulator-portal force-reset endpoint (break-glass, audited).
 */
export function resetBucket(tenantId: string, bucketState: Map<string, TenantBucketState>): void {
  bucketState.delete(tenantId);
}
