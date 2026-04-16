/**
 * Tests for asanaTenantProjectResolver.ts — pure compute, so every
 * test passes sources inline and checks the typed return shape.
 */
import { describe, it, expect } from 'vitest';
import {
  LEGACY_TENANT_PROJECTS,
  resolveTenantProject,
  type ResolveOptions,
  type TenantProjectEntry,
} from '@/services/asanaTenantProjectResolver';

const REGISTRY_ENTRY: TenantProjectEntry = {
  tenantId: 'madison-llc',
  name: 'Madison LLC',
  compliance: 'REG_COMP_GID',
  workflow: 'REG_WORK_GID',
};

describe('resolveTenantProject — tier 1 (registry)', () => {
  it('returns registry compliance GID when registry hit and kind=compliance', () => {
    const out = resolveTenantProject('madison-llc', 'compliance', {
      registryEntry: REGISTRY_ENTRY,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.projectGid).toBe('REG_COMP_GID');
      expect(out.source).toBe('registry');
      expect(out.name).toBe('Madison LLC');
    }
  });

  it('returns registry workflow GID when kind=workflow', () => {
    const out = resolveTenantProject('madison-llc', 'workflow', {
      registryEntry: REGISTRY_ENTRY,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.projectGid).toBe('REG_WORK_GID');
      expect(out.source).toBe('registry');
    }
  });

  it('registry wins over legacy map', () => {
    // company-1 is in LEGACY_TENANT_PROJECTS.
    const out = resolveTenantProject('company-1', 'workflow', {
      registryEntry: {
        ...REGISTRY_ENTRY,
        tenantId: 'company-1',
        compliance: 'FRESH_COMP',
        workflow: 'FRESH_WORK',
      },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.projectGid).toBe('FRESH_WORK');
      expect(out.source).toBe('registry');
    }
  });

  it('fails when registry entry is missing the requested kind', () => {
    // A registry row with blank workflow should fail, not silently
    // fall through to legacy.
    const out = resolveTenantProject('madison-llc', 'workflow', {
      registryEntry: { ...REGISTRY_ENTRY, workflow: '' },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('registry_entry_missing_kind');
    }
  });
});

describe('resolveTenantProject — tier 2 (legacy)', () => {
  it('resolves all six legacy tenants for compliance', () => {
    const ids = Object.keys(LEGACY_TENANT_PROJECTS);
    expect(ids.length).toBe(6);
    for (const id of ids) {
      const out = resolveTenantProject(id, 'compliance');
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.source).toBe('legacy');
        expect(out.projectGid.length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves FG LLC legacy workflow GID', () => {
    const out = resolveTenantProject('company-5', 'workflow');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.projectGid).toBe('1213759768596515');
      expect(out.name).toBe('FINE GOLD LLC');
    }
  });

  it('caller can override the legacy map for tests', () => {
    const overrides: ResolveOptions = {
      legacyMap: {
        'test-tenant': {
          tenantId: 'test-tenant',
          name: 'Test',
          compliance: 'TEST_COMP',
          workflow: 'TEST_WORK',
        },
      },
    };
    const out = resolveTenantProject('test-tenant', 'workflow', overrides);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.projectGid).toBe('TEST_WORK');
      expect(out.source).toBe('legacy');
    }
  });
});

describe('resolveTenantProject — tier 3 (default fallback)', () => {
  it('returns default ONLY when allowDefaultFallback=true', () => {
    const out = resolveTenantProject('unknown-tenant', 'workflow', {
      defaultProjectGid: 'DEFAULT_GID',
      allowDefaultFallback: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.projectGid).toBe('DEFAULT_GID');
      expect(out.source).toBe('default');
    }
  });

  it('does NOT fall back to default by default (no silent masking)', () => {
    const out = resolveTenantProject('unknown-tenant', 'workflow', {
      defaultProjectGid: 'DEFAULT_GID',
      // allowDefaultFallback omitted — defaults to false.
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('tenant_not_in_registry_and_no_legacy_entry');
    }
  });

  it('does not fall back to default for a known legacy tenant even if allowed', () => {
    // Explicit: the default is only used for EXPLICIT unknown-tenant
    // requests. A known tenant must always route to its own project.
    const out = resolveTenantProject('company-5', 'workflow', {
      defaultProjectGid: 'DEFAULT_GID',
      allowDefaultFallback: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.source).toBe('legacy');
      expect(out.projectGid).not.toBe('DEFAULT_GID');
    }
  });

  it('returns failure when unknown tenant and default not configured', () => {
    const out = resolveTenantProject('unknown-tenant', 'workflow', {
      allowDefaultFallback: true,
      // defaultProjectGid not provided.
    });
    expect(out.ok).toBe(false);
  });
});

describe('resolveTenantProject — validation', () => {
  it('rejects empty tenantId', () => {
    const out = resolveTenantProject('', 'workflow');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_tenant_id');
  });

  it('rejects tenantId with uppercase letters', () => {
    const out = resolveTenantProject('Madison-LLC', 'workflow');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_tenant_id');
  });

  it('rejects tenantId starting with a hyphen', () => {
    const out = resolveTenantProject('-madison', 'workflow');
    expect(out.ok).toBe(false);
  });

  it('rejects tenantId longer than 64 chars', () => {
    const out = resolveTenantProject('a'.repeat(65), 'workflow');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_tenant_id');
  });

  it('rejects invalid project kind', () => {
    // @ts-expect-error — exercise the runtime guard.
    const out = resolveTenantProject('company-5', 'reporting');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid_project_kind');
  });
});

describe('LEGACY_TENANT_PROJECTS — shape', () => {
  it('contains the six shipping tenants', () => {
    expect(Object.keys(LEGACY_TENANT_PROJECTS).sort()).toEqual([
      'company-1',
      'company-2',
      'company-3',
      'company-4',
      'company-5',
      'company-6',
    ]);
  });

  it('every entry has non-empty compliance and workflow GIDs', () => {
    for (const entry of Object.values(LEGACY_TENANT_PROJECTS)) {
      expect(entry.compliance.length).toBeGreaterThan(0);
      expect(entry.workflow.length).toBeGreaterThan(0);
    }
  });

  it('is frozen so it cannot be mutated at runtime', () => {
    expect(Object.isFrozen(LEGACY_TENANT_PROJECTS)).toBe(true);
  });
});
