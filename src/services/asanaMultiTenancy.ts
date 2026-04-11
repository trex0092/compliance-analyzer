/**
 * Asana Multi-Tenancy — Asana Phase 3 Cluster O.
 *
 * Three helpers for running the compliance-analyzer against multiple
 * Asana workspaces (one per customer or per subsidiary):
 *
 *   O1 tenantTokenRegistry    — per-tenant credentials keyed by tenantId
 *   O2 tenantIsolationGuard   — asserts a task belongs to the caller's tenant
 *   O3 tenantRateLimiter      — per-tenant adaptive rate limit buckets
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (isolation between customers)
 *   - FDL No.10/2025 Art.24 (tenant-scoped retention)
 *   - NIST AI RMF GV-1.6 (access control)
 *   - EU AI Act Art.15 (cybersecurity — prevent cross-tenant data leakage)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantCredentials {
  tenantId: string;
  asanaToken: string;
  asanaWorkspaceGid: string;
  allowedProjectGids: readonly string[];
}

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

// ---------------------------------------------------------------------------
// O1 — Token registry
// ---------------------------------------------------------------------------

export class TenantTokenRegistry {
  private readonly tenants = new Map<string, TenantCredentials>();

  register(creds: TenantCredentials): void {
    this.tenants.set(creds.tenantId, creds);
  }

  getCredentials(tenantId: string): TenantCredentials | undefined {
    return this.tenants.get(tenantId);
  }

  listTenants(): readonly string[] {
    return Array.from(this.tenants.keys());
  }

  has(tenantId: string): boolean {
    return this.tenants.has(tenantId);
  }
}

// ---------------------------------------------------------------------------
// O2 — Isolation guard
// ---------------------------------------------------------------------------

/**
 * Throws if the given task's project is not in the allowed set for
 * the claimed tenant. Use at every boundary where a tenant ID is
 * provided by an untrusted caller.
 */
export function assertTenantOwnsTask(
  registry: TenantTokenRegistry,
  tenantId: string,
  projectGid: string
): void {
  const creds = registry.getCredentials(tenantId);
  if (!creds) {
    throw new TenantIsolationError(`Unknown tenant: ${tenantId}`);
  }
  if (!creds.allowedProjectGids.includes(projectGid)) {
    throw new TenantIsolationError(
      `Tenant ${tenantId} is not authorised to access project ${projectGid}`
    );
  }
}

// ---------------------------------------------------------------------------
// O3 — Per-tenant rate limiter
// ---------------------------------------------------------------------------

export interface TenantRateState {
  lastRequestMs: number;
  currentDelayMs: number;
}

export class TenantRateLimiter {
  private readonly buckets = new Map<string, TenantRateState>();
  private readonly defaultDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(opts: { defaultDelayMs?: number; maxDelayMs?: number } = {}) {
    this.defaultDelayMs = opts.defaultDelayMs ?? 250;
    this.maxDelayMs = opts.maxDelayMs ?? 30_000;
  }

  /** Returns how long the caller should wait (ms) before issuing the next request. */
  waitMsFor(tenantId: string, now: number = Date.now()): number {
    const bucket = this.buckets.get(tenantId) ?? {
      lastRequestMs: 0,
      currentDelayMs: this.defaultDelayMs,
    };
    const elapsed = now - bucket.lastRequestMs;
    if (elapsed >= bucket.currentDelayMs) return 0;
    return bucket.currentDelayMs - elapsed;
  }

  /** Mark a successful request so future waits decay back toward default. */
  onSuccess(tenantId: string, now: number = Date.now()): void {
    const bucket = this.buckets.get(tenantId) ?? {
      lastRequestMs: 0,
      currentDelayMs: this.defaultDelayMs,
    };
    bucket.lastRequestMs = now;
    if (bucket.currentDelayMs > this.defaultDelayMs) {
      const excess = bucket.currentDelayMs - this.defaultDelayMs;
      bucket.currentDelayMs = this.defaultDelayMs + Math.floor(excess / 2);
      if (bucket.currentDelayMs < this.defaultDelayMs + 10) {
        bucket.currentDelayMs = this.defaultDelayMs;
      }
    }
    this.buckets.set(tenantId, bucket);
  }

  /** Mark a 429 response; grow the bucket to respect the server's Retry-After. */
  onRateLimit(tenantId: string, retryAfterMs: number, now: number = Date.now()): void {
    const bucket = this.buckets.get(tenantId) ?? {
      lastRequestMs: 0,
      currentDelayMs: this.defaultDelayMs,
    };
    bucket.lastRequestMs = now;
    bucket.currentDelayMs = Math.min(this.maxDelayMs, Math.max(bucket.currentDelayMs, retryAfterMs));
    this.buckets.set(tenantId, bucket);
  }

  state(tenantId: string): TenantRateState | undefined {
    return this.buckets.get(tenantId);
  }
}
