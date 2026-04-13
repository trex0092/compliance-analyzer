import { describe, expect, it } from 'vitest';
import { validateTenantId, tenantKey, TenantIdError } from '@/services/tenantStore';

describe('validateTenantId', () => {
  it('accepts alphanumeric + dash + underscore ids', () => {
    expect(validateTenantId('acme')).toBe('acme');
    expect(validateTenantId('acme_uae_2026')).toBe('acme_uae_2026');
    expect(validateTenantId('hawkeye-01')).toBe('hawkeye-01');
    expect(validateTenantId('A1')).toBe('A1');
  });

  it('rejects empty ids', () => {
    expect(() => validateTenantId('')).toThrow(TenantIdError);
  });

  it('rejects ids with path separators', () => {
    expect(() => validateTenantId('acme/subdir')).toThrow(TenantIdError);
    expect(() => validateTenantId('acme\\win')).toThrow(TenantIdError);
  });

  it('rejects ids containing "."', () => {
    expect(() => validateTenantId('..')).toThrow(TenantIdError);
    expect(() => validateTenantId('acme.prod')).toThrow(TenantIdError);
  });

  it('rejects ids > 64 chars', () => {
    expect(() => validateTenantId('a'.repeat(65))).toThrow(TenantIdError);
  });

  it('rejects ids with whitespace, quotes, control chars', () => {
    expect(() => validateTenantId('acme uae')).toThrow(TenantIdError);
    expect(() => validateTenantId('acme"uae')).toThrow(TenantIdError);
    expect(() => validateTenantId('acme\nuae')).toThrow(TenantIdError);
  });
});

describe('tenantKey', () => {
  it('prefixes with tenant/{id}/', () => {
    expect(tenantKey('acme', 'brain-events/2026-04-13.json')).toBe(
      'tenant/acme/brain-events/2026-04-13.json'
    );
  });

  it('rejects path traversal in relative keys', () => {
    expect(() => tenantKey('acme', '../other-tenant/leak.json')).toThrow();
    expect(() => tenantKey('acme', '/absolute/path')).toThrow();
  });

  it('rejects empty relative keys', () => {
    expect(() => tenantKey('acme', '')).toThrow();
  });

  it('validates the tenant id itself', () => {
    expect(() => tenantKey('bad..tenant', 'key')).toThrow(TenantIdError);
  });

  it('two different tenants produce non-overlapping keys', () => {
    const a = tenantKey('tenant_a', 'brain/x.json');
    const b = tenantKey('tenant_b', 'brain/x.json');
    expect(a).not.toBe(b);
    expect(a.startsWith('tenant/tenant_a/')).toBe(true);
    expect(b.startsWith('tenant/tenant_b/')).toBe(true);
  });
});
