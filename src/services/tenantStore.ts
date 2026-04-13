/**
 * Tenant-scoped blob storage helper.
 *
 * Every blob key used by the compliance platform should flow through
 * this module so cross-tenant IDOR is impossible by construction.
 * The helper enforces:
 *
 *   - Tenant id is validated against a strict regex (`[a-zA-Z0-9_-]{1,64}`).
 *   - Every key is prefixed with `tenant/<id>/`.
 *   - Listing operations only return keys under the caller's prefix.
 *   - The tenant id CANNOT be derived from the request — callers must
 *     supply it from a verified source (session token, JWT claim).
 *
 * This module is intentionally a *helper*, not a replacement for
 * `@netlify/blobs`. It wraps the minimal surface (get / set / list /
 * delete) that the rest of the functions need.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (each DPMS is a separate accountable entity)
 *   Cabinet Res 134/2025 Art.5 (tenant-specific risk appetite)
 *   ISO/IEC 27001 A.8.10 (data separation)
 */

import { getStore } from '@netlify/blobs';

const TENANT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export class TenantIdError extends Error {
  constructor(value: string) {
    super(`Invalid tenant id: "${value}". Allowed: [a-zA-Z0-9_-]{1,64}`);
    this.name = 'TenantIdError';
  }
}

/**
 * Validate a tenant id string. Throws on malformed input; returns the
 * input unchanged so callers can use it in a `const id = validateTenantId(...)`.
 */
export function validateTenantId(tenantId: string): string {
  if (typeof tenantId !== 'string' || !TENANT_ID_PATTERN.test(tenantId)) {
    throw new TenantIdError(String(tenantId));
  }
  return tenantId;
}

/**
 * Compose a full blob key from a tenant id and a relative key. The
 * relative key is also validated — no slashes at the start, no
 * path-traversal segments.
 */
export function tenantKey(tenantId: string, relativeKey: string): string {
  validateTenantId(tenantId);
  if (typeof relativeKey !== 'string' || relativeKey.length === 0) {
    throw new Error('relativeKey is required');
  }
  if (relativeKey.startsWith('/') || relativeKey.includes('..')) {
    throw new Error(`Illegal relative key: "${relativeKey}"`);
  }
  return `tenant/${tenantId}/${relativeKey}`;
}

interface TenantStoreOptions {
  tenantId: string;
  storeName: string;
}

/**
 * Scoped wrapper. Every read / write is automatically prefixed and
 * every list is filtered to the caller's namespace.
 */
export class TenantStore {
  private readonly tenantId: string;
  private readonly storeName: string;
  // Lazily grab the underlying store so unit tests can mock it.
  private store: ReturnType<typeof getStore> | null = null;

  constructor(options: TenantStoreOptions) {
    this.tenantId = validateTenantId(options.tenantId);
    this.storeName = options.storeName;
  }

  private raw(): ReturnType<typeof getStore> {
    if (!this.store) this.store = getStore(this.storeName);
    return this.store;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const fullKey = tenantKey(this.tenantId, key);
    const result = await this.raw().get(fullKey, { type: 'json' });
    return (result ?? null) as T | null;
  }

  async setJSON(key: string, value: unknown): Promise<void> {
    const fullKey = tenantKey(this.tenantId, key);
    await this.raw().setJSON(fullKey, value);
  }

  async delete(key: string): Promise<void> {
    const fullKey = tenantKey(this.tenantId, key);
    await this.raw().delete(fullKey);
  }

  /**
   * List keys under the caller's namespace. Accepts a relative prefix
   * that is composed under the tenant root. Results are returned with
   * the `tenant/<id>/` prefix stripped so callers don't need to know
   * the physical layout.
   */
  async list(relativePrefix: string = ''): Promise<string[]> {
    const fullPrefix = tenantKey(this.tenantId, relativePrefix || '.');
    // We used '.' as a sentinel to force validation of a non-empty
    // relative key — strip it before composing the blob prefix.
    const prefix = relativePrefix === '' ? `tenant/${this.tenantId}/` : fullPrefix;
    const listing = await this.raw().list({ prefix });
    const blobs = listing.blobs || [];
    return blobs.map((b) => b.key.slice(`tenant/${this.tenantId}/`.length));
  }
}

/**
 * Convenience factory — same shape as `getStore` but returns a
 * TenantStore wrapper.
 */
export function getTenantStore(tenantId: string, storeName: string): TenantStore {
  return new TenantStore({ tenantId, storeName });
}
