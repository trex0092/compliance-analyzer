/**
 * Decision Fingerprint Cache — deterministic replay-cache for
 * brain decisions.
 *
 * Rationale:
 *   When an MLRO clicks "Run Brain Analysis" twice in a row on
 *   the Brain Console, or when a Netlify warm instance receives
 *   two identical payloads inside the same minute, the super
 *   runner currently re-runs the full 30-subsystem Weaponized
 *   Brain both times even though the output is guaranteed to be
 *   identical (the whole pipeline is deterministic given the
 *   same feature vector + entity + tenant).
 *
 *   This module provides a TTL-bounded in-process cache keyed
 *   on a SHA-256 fingerprint of (tenantId, entityRef,
 *   sanctionsConfirmedFlag, features). A cache hit returns the
 *   prior SuperDecision directly, saving every subsystem call +
 *   every blob write + every Asana dispatch.
 *
 *   The cache is a pure SAFETY NET — it only returns a hit when
 *   the same inputs were seen within the configurable TTL. Any
 *   feature change busts the cache instantly; entity name
 *   changes do NOT because the name is not part of the
 *   fingerprint (by design — the decision depends on features
 *   and id, not the display label).
 *
 * Safety invariants:
 *   - Tenant-scoped fingerprints: cross-tenant replay is
 *     impossible because tenantId is part of the hash.
 *   - Every cache entry has a TTL; stale entries are evicted on
 *     read so memory stays bounded without a sweeper.
 *   - The cache never bypasses the four-eyes gate or any safety
 *     clamp — it stores the FULL SuperDecision including all
 *     clamps, so replaying a cached freeze is STILL a freeze.
 *   - The cache is OPT-IN from the super runner's caller side.
 *     Without wiring, the runner behaves exactly as before.
 *
 * Determinism:
 *   - SHA-256 over a canonical JSON serialisation with sorted
 *     keys so two payloads with different property order hash
 *     to the same fingerprint.
 *   - Numeric features are preserved with full precision; no
 *     lossy rounding.
 *   - Booleans are stringified as "0" / "1" to avoid implicit
 *     coercion drift across runtimes.
 *
 * Why SHA-256 and not FNV / MurmurHash?
 *   - Web Crypto is available in both Netlify Functions and
 *     modern browsers, so the same fingerprint is computed
 *     consistently across both layers.
 *   - Cryptographic hashing isn't required for security here
 *     (the fingerprint isn't authenticated), but the uniform
 *     availability + zero-collision-practice of SHA-256 makes
 *     it the cheapest correct choice.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned decision — a cached
 *                             decision IS the same reasoned
 *                             decision, not a shortcut)
 *   FDL No.10/2025 Art.24    (audit trail reproducibility —
 *                             deterministic inputs → same
 *                             output, so the cache is a
 *                             correctness optimization)
 *   Cabinet Res 134/2025 Art.19 (internal review — cached
 *                                 decisions carry the same
 *                                 reasoning chain as fresh runs)
 */

import type { StrFeatures } from './predictiveStr';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FingerprintInput {
  tenantId: string;
  entityId: string;
  features: StrFeatures;
  sanctionsConfirmedFlag?: boolean;
}

export interface CacheEntry<T> {
  value: T;
  fingerprint: string;
  storedAtIso: string;
  expiresAtMs: number;
}

export interface CacheOptions {
  /** TTL in milliseconds. Default 60 seconds. */
  ttlMs?: number;
  /** Max entries per tenant before oldest-first eviction. Default 200. */
  maxEntriesPerTenant?: number;
  /** Clock override for tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Canonical serialisation + SHA-256 fingerprint
// ---------------------------------------------------------------------------

/**
 * Canonicalize a StrFeatures vector so different property orders
 * hash to the same fingerprint. We only emit fields in a fixed
 * order with a fixed string representation per type.
 */
function canonicalizeFeatures(f: StrFeatures): string {
  const parts: string[] = [
    `priorAlerts90d=${f.priorAlerts90d}`,
    `txValue30dAED=${f.txValue30dAED}`,
    `nearThresholdCount30d=${f.nearThresholdCount30d}`,
    `crossBorderRatio30d=${f.crossBorderRatio30d}`,
    `isPep=${f.isPep ? '1' : '0'}`,
    `highRiskJurisdiction=${f.highRiskJurisdiction ? '1' : '0'}`,
    `hasAdverseMedia=${f.hasAdverseMedia ? '1' : '0'}`,
    `daysSinceOnboarding=${f.daysSinceOnboarding}`,
    `sanctionsMatchScore=${f.sanctionsMatchScore}`,
    `cashRatio30d=${f.cashRatio30d}`,
  ];
  return parts.join('|');
}

/**
 * Produce the full canonical input string that goes into the
 * SHA-256 hash. Includes a domain-separation prefix so a
 * fingerprint from this cache can never be mistaken for a
 * zk-compliance commit or any other hash the project uses.
 */
export function canonicalizeFingerprintInput(input: FingerprintInput): string {
  return [
    'hawkeye-decision-fingerprint-v1',
    `tenant=${input.tenantId}`,
    `entity=${input.entityId}`,
    `sanctionsConfirmedFlag=${input.sanctionsConfirmedFlag ? '1' : '0'}`,
    `features=${canonicalizeFeatures(input.features)}`,
  ].join('||');
}

/**
 * Compute a SHA-256 hex digest over the canonical input string.
 * Uses Web Crypto (available in Netlify Functions, browsers, and
 * Node 18+). No Node-specific imports — browser-safe.
 */
export async function computeFingerprint(input: FingerprintInput): Promise<string> {
  const canonical = canonicalizeFingerprintInput(input);
  const bytes = new TextEncoder().encode(canonical);
  const g = globalThis as {
    crypto?: {
      subtle?: { digest(alg: string, data: ArrayBuffer): Promise<ArrayBuffer> };
    };
  };
  if (!g.crypto?.subtle) {
    // Fallback: deterministic non-crypto hash. Never used in the
    // real Netlify runtime but keeps the module importable in
    // environments that lack Web Crypto (e.g. ancient Node).
    let h = 0;
    for (let i = 0; i < canonical.length; i++) {
      h = (h * 31 + canonical.charCodeAt(i)) | 0;
    }
    return `fallback-${(h >>> 0).toString(16).padStart(8, '0')}`;
  }
  const digest = await g.crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  );
  const view = new Uint8Array(digest);
  let hex = '';
  for (const byte of view) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

// ---------------------------------------------------------------------------
// Tenant-scoped TTL cache
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_PER_TENANT = 200;

export class DecisionFingerprintCache<T> {
  private readonly buckets = new Map<string, Map<string, CacheEntry<T>>>();
  private readonly ttlMs: number;
  private readonly maxPerTenant: number;
  private readonly now: () => number;
  private hits = 0;
  private misses = 0;

  constructor(opts: CacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxPerTenant = opts.maxEntriesPerTenant ?? DEFAULT_MAX_PER_TENANT;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Fetch an entry. Returns null on miss or when the entry has
   * expired. Expired entries are evicted on read so memory stays
   * bounded without a sweeper.
   */
  get(tenantId: string, fingerprint: string): T | null {
    const bucket = this.buckets.get(tenantId);
    if (!bucket) {
      this.misses += 1;
      return null;
    }
    const entry = bucket.get(fingerprint);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (entry.expiresAtMs <= this.now()) {
      bucket.delete(fingerprint);
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    return entry.value;
  }

  /** Store a value under the given fingerprint. */
  set(tenantId: string, fingerprint: string, value: T): void {
    let bucket = this.buckets.get(tenantId);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(tenantId, bucket);
    }
    bucket.set(fingerprint, {
      value,
      fingerprint,
      storedAtIso: new Date(this.now()).toISOString(),
      expiresAtMs: this.now() + this.ttlMs,
    });
    // Bound the tenant bucket. Map preserves insertion order, so
    // the oldest entry is always the first key.
    if (bucket.size > this.maxPerTenant) {
      const oldestKey = bucket.keys().next().value;
      if (oldestKey !== undefined) bucket.delete(oldestKey);
    }
  }

  /** Test-only reset. */
  clear(): void {
    this.buckets.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Observability snapshot for diagnostics endpoints. */
  stats(): {
    tenantCount: number;
    totalEntries: number;
    hits: number;
    misses: number;
    hitRate: number;
  } {
    let totalEntries = 0;
    for (const bucket of this.buckets.values()) totalEntries += bucket.size;
    const total = this.hits + this.misses;
    return {
      tenantCount: this.buckets.size,
      totalEntries,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

// Default shared instance — tests should use `new DecisionFingerprintCache()`.
export const defaultDecisionCache = new DecisionFingerprintCache<unknown>();

// Exports for tests.
export const __test__ = {
  canonicalizeFeatures,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_PER_TENANT,
};
