/**
 * Content-Addressable Decision Cache.
 *
 * Every compliance decision takes a feature vector as input and
 * produces a verdict. If we compute the same decision twice within a
 * TTL window, we should return the cached answer — it is the SAME
 * answer by construction, and recomputing wastes MLRO time.
 *
 * Design:
 *   - Cache key = SHA-256 of the canonicalised feature vector + a
 *     "policy version" string. Changing the policy version invalidates
 *     the entire cache atomically.
 *   - Values are stored in memory with optional size + TTL eviction.
 *   - Thread-safe for JS's single-threaded model (no locks needed).
 *   - Pure-TS, no network, usable in both browser and Netlify.
 *
 * Used by: megaBrain (optional memoisation wrapper), autopilot
 * (for periodic re-assessment of stable customers).
 *
 * Regulatory basis:
 *   - FDL Art.19 (consistent application of the risk-based approach)
 *   - Cabinet Res 134/2025 Art.5 (same inputs → same outcome)
 */

// ---------------------------------------------------------------------------
// Canonicalisation + hashing
// ---------------------------------------------------------------------------

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function decisionKey(
  features: Record<string, unknown>,
  policyVersion: string
): Promise<string> {
  const payload = `${policyVersion}|${canonicalJson(features)}`;
  return sha256Hex(payload);
}

// ---------------------------------------------------------------------------
// Cache implementation
// ---------------------------------------------------------------------------

export interface CacheEntry<T> {
  key: string;
  value: T;
  storedAtMs: number;
  hits: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
  policyVersion: string;
}

export interface DecisionCacheConfig {
  policyVersion: string;
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

export class DecisionCache<T> {
  private entries = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private readonly config: Required<DecisionCacheConfig>;

  constructor(config: DecisionCacheConfig) {
    this.config = {
      policyVersion: config.policyVersion,
      maxEntries: config.maxEntries ?? 10_000,
      ttlMs: config.ttlMs ?? 24 * 60 * 60 * 1000, // 24h default
      now: config.now ?? (() => Date.now()),
    };
  }

  async get(features: Record<string, unknown>): Promise<T | undefined> {
    const key = await decisionKey(features, this.config.policyVersion);
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (this.config.now() - entry.storedAtMs > this.config.ttlMs) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    entry.hits++;
    this.hits++;
    return entry.value;
  }

  async set(features: Record<string, unknown>, value: T): Promise<string> {
    const key = await decisionKey(features, this.config.policyVersion);
    const entry: CacheEntry<T> = {
      key,
      value,
      storedAtMs: this.config.now(),
      hits: 0,
    };
    this.entries.set(key, entry);
    this.evictIfNeeded();
    return key;
  }

  /**
   * Memoised execution: look up (features), and if absent compute via
   * the supplied loader and cache the result.
   */
  async getOrCompute(features: Record<string, unknown>, compute: () => Promise<T> | T): Promise<T> {
    const cached = await this.get(features);
    if (cached !== undefined) return cached;
    const value = await compute();
    await this.set(features, value);
    return value;
  }

  invalidate(): void {
    this.entries.clear();
  }

  stats(): CacheStats {
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      policyVersion: this.config.policyVersion,
    };
  }

  private evictIfNeeded(): void {
    // Simple size cap + LRU-ish by insertion order (Map preserves order).
    while (this.entries.size > this.config.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
  }
}
