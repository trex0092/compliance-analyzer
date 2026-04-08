import { hasPermission, getPermissions, canApprove } from '@/utils/rbacGuard';

describe('hasPermission', () => {
  it('undefined role returns false for any action', () => {
    expect(hasPermission(undefined, 'view-cases')).toBe(false);
    expect(hasPermission(undefined, 'approve-str')).toBe(false);
    expect(hasPermission(undefined, 'edit-cases')).toBe(false);
  });

  it('admin has * -> returns true for every action', () => {
    expect(hasPermission('admin', 'view-cases')).toBe(true);
    expect(hasPermission('admin', 'edit-cases')).toBe(true);
    expect(hasPermission('admin', 'create-cases')).toBe(true);
    expect(hasPermission('admin', 'approve-str')).toBe(true);
    expect(hasPermission('admin', 'approve-freeze')).toBe(true);
    expect(hasPermission('admin', 'manage-audit-checklist')).toBe(true);
    expect(hasPermission('admin', 'export-data')).toBe(true);
  });

  it('viewer can only view-cases and view-kpi-dashboard', () => {
    expect(hasPermission('viewer', 'view-cases')).toBe(true);
    expect(hasPermission('viewer', 'view-kpi-dashboard')).toBe(true);
  });

  it('viewer cannot edit-cases, create-cases, approve-str', () => {
    expect(hasPermission('viewer', 'edit-cases')).toBe(false);
    expect(hasPermission('viewer', 'create-cases')).toBe(false);
    expect(hasPermission('viewer', 'approve-str')).toBe(false);
  });

  it('analyst can view-cases and edit-cases but NOT create-cases or approve-str', () => {
    expect(hasPermission('analyst', 'view-cases')).toBe(true);
    expect(hasPermission('analyst', 'edit-cases')).toBe(true);
    expect(hasPermission('analyst', 'create-cases')).toBe(false);
    expect(hasPermission('analyst', 'approve-str')).toBe(false);
  });

  it('compliance-officer can approve-str but NOT approve-sar or approve-freeze', () => {
    expect(hasPermission('compliance-officer', 'approve-str')).toBe(true);
    expect(hasPermission('compliance-officer', 'approve-sar')).toBe(false);
    expect(hasPermission('compliance-officer', 'approve-freeze')).toBe(false);
  });

  it('mlro can approve-str, approve-sar, approve-freeze but NOT approve-high-risk or approve-pep', () => {
    expect(hasPermission('mlro', 'approve-str')).toBe(true);
    expect(hasPermission('mlro', 'approve-sar')).toBe(true);
    expect(hasPermission('mlro', 'approve-freeze')).toBe(true);
    expect(hasPermission('mlro', 'approve-high-risk')).toBe(false);
    expect(hasPermission('mlro', 'approve-pep')).toBe(false);
  });

  it('senior-management can approve-high-risk and approve-pep', () => {
    expect(hasPermission('senior-management', 'approve-high-risk')).toBe(true);
    expect(hasPermission('senior-management', 'approve-pep')).toBe(true);
  });

  it('external-auditor can view-cases and export-data but NOT edit-cases or create-cases', () => {
    expect(hasPermission('external-auditor', 'view-cases')).toBe(true);
    expect(hasPermission('external-auditor', 'export-data')).toBe(true);
    expect(hasPermission('external-auditor', 'edit-cases')).toBe(false);
    expect(hasPermission('external-auditor', 'create-cases')).toBe(false);
  });

  it('unknown role returns false', () => {
    expect(hasPermission('nonexistent-role' as any, 'view-cases')).toBe(false);
  });
});

describe('getPermissions', () => {
  it('admin gets all 22 permissions (the full non-* action list)', () => {
    const perms = getPermissions('admin');
    expect(perms).toHaveLength(22);
  });

  it('viewer gets exactly 2 permissions', () => {
    const perms = getPermissions('viewer');
    expect(perms).toHaveLength(2);
  });

  it('analyst permissions include view-cases and do not include create-cases', () => {
    const perms = getPermissions('analyst');
    expect(perms).toContain('view-cases');
    expect(perms).not.toContain('create-cases');
  });
});

describe('canApprove', () => {
  it('four-eyes principle: same requestor and approver -> denied with four-eyes reason', () => {
    const result = canApprove('mlro', 'str-approval', 'john', 'john');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Four-eyes');
  });

  it('mlro can approve str-approval', () => {
    const result = canApprove('mlro', 'str-approval');
    expect(result.allowed).toBe(true);
  });

  it('analyst cannot approve str-approval -> denied', () => {
    const result = canApprove('analyst' as any, 'str-approval');
    expect(result.allowed).toBe(false);
  });

  it('senior-management can approve pep-onboarding', () => {
    const result = canApprove('senior-management', 'pep-onboarding');
    expect(result.allowed).toBe(true);
  });

  it('compliance-officer cannot approve pep-onboarding', () => {
    const result = canApprove('compliance-officer', 'pep-onboarding');
    expect(result.allowed).toBe(false);
  });

  it('unknown gate returns denied with "Unknown approval gate" reason', () => {
    const result = canApprove('admin', 'nonexistent-gate');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unknown approval gate');
  });

  it('different requestor and approver with valid role -> allowed', () => {
    const result = canApprove('mlro', 'str-approval', 'alice', 'bob');
    expect(result.allowed).toBe(true);
  });
});
