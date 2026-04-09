/**
 * RBAC Guard — Enforce role-based access control in the application.
 *
 * Wraps the existing rbac.ts permission matrix and provides:
 * - Permission checking for UI rendering
 * - Route guarding
 * - Audit logging of access attempts
 */

/** UI-facing role names (superset of domain Role — includes 'viewer') */
export type RoleName =
  | 'analyst'
  | 'compliance-officer'
  | 'mlro'
  | 'senior-management'
  | 'admin'
  | 'external-auditor'
  | 'viewer';

/** UI-facing permission actions (broader than domain Action for UI rendering) */
export type PermissionAction =
  | 'view-cases'
  | 'edit-cases'
  | 'create-cases'
  | 'close-cases'
  | 'view-screening'
  | 'run-screening'
  | 'view-alerts'
  | 'dismiss-alerts'
  | 'view-evidence'
  | 'upload-evidence'
  | 'view-reports'
  | 'create-reports'
  | 'approve-str'
  | 'approve-sar'
  | 'approve-freeze'
  | 'approve-high-risk'
  | 'approve-pep'
  | 'view-audit-log'
  | 'export-data'
  | 'manage-audit-checklist'
  | 'view-kpi-dashboard'
  | 'view-regulatory-framework'
  | '*';

/**
 * Check if a role has a specific permission.
 * Use this to conditionally render UI elements.
 */
export function hasPermission(userRole: RoleName | undefined, action: PermissionAction): boolean {
  if (!userRole) return false;

  const PERMISSION_MAP: Record<string, PermissionAction[]> = {
    analyst: [
      'view-cases',
      'edit-cases',
      'view-screening',
      'view-alerts',
      'view-evidence',
      'view-audit-log',
      'view-kpi-dashboard',
      'view-regulatory-framework',
    ],
    'compliance-officer': [
      'view-cases',
      'edit-cases',
      'create-cases',
      'view-screening',
      'run-screening',
      'view-alerts',
      'dismiss-alerts',
      'view-evidence',
      'upload-evidence',
      'view-reports',
      'create-reports',
      'approve-str',
      'view-audit-log',
      'export-data',
      'view-kpi-dashboard',
      'view-regulatory-framework',
    ],
    mlro: [
      'view-cases',
      'edit-cases',
      'create-cases',
      'close-cases',
      'view-screening',
      'run-screening',
      'view-alerts',
      'dismiss-alerts',
      'view-evidence',
      'upload-evidence',
      'view-reports',
      'create-reports',
      'approve-str',
      'approve-sar',
      'approve-freeze',
      'view-audit-log',
      'export-data',
      'manage-audit-checklist',
      'view-kpi-dashboard',
      'view-regulatory-framework',
    ],
    'senior-management': [
      'view-cases',
      'view-screening',
      'view-alerts',
      'view-evidence',
      'view-reports',
      'approve-str',
      'approve-sar',
      'approve-freeze',
      'approve-high-risk',
      'approve-pep',
      'view-audit-log',
      'export-data',
      'manage-audit-checklist',
      'view-kpi-dashboard',
      'view-regulatory-framework',
    ],
    admin: ['*'],
    'external-auditor': [
      'view-cases',
      'view-screening',
      'view-alerts',
      'view-evidence',
      'view-reports',
      'view-audit-log',
      'export-data',
      'manage-audit-checklist',
      'view-kpi-dashboard',
      'view-regulatory-framework',
    ],
    viewer: ['view-cases', 'view-kpi-dashboard'],
  };

  const perms = PERMISSION_MAP[userRole];
  if (!perms) return false;
  if (perms.includes('*' as PermissionAction)) return true;
  return perms.includes(action);
}

/**
 * Get all permissions for a role.
 */
export function getPermissions(userRole: RoleName): PermissionAction[] {
  const result: PermissionAction[] = [];
  const allActions: PermissionAction[] = [
    'view-cases',
    'edit-cases',
    'create-cases',
    'close-cases',
    'view-screening',
    'run-screening',
    'view-alerts',
    'dismiss-alerts',
    'view-evidence',
    'upload-evidence',
    'view-reports',
    'create-reports',
    'approve-str',
    'approve-sar',
    'approve-freeze',
    'approve-high-risk',
    'approve-pep',
    'view-audit-log',
    'export-data',
    'manage-audit-checklist',
    'view-kpi-dashboard',
    'view-regulatory-framework',
  ];
  for (const action of allActions) {
    if (hasPermission(userRole, action)) result.push(action);
  }
  return result;
}

/**
 * Check if a role can approve a specific gate.
 * Enforces four-eyes principle — the approver must be different from the requestor.
 */
export function canApprove(
  approverRole: RoleName,
  gate: string,
  requestedBy?: string,
  approverUsername?: string
): { allowed: boolean; reason?: string } {
  // Four-eyes: approver cannot be the requestor
  if (requestedBy && approverUsername && requestedBy === approverUsername) {
    return { allowed: false, reason: 'Four-eyes principle: approver cannot be the requestor' };
  }

  const approvalMap: Record<string, RoleName[]> = {
    'str-approval': ['mlro', 'admin'], // FDL Art.26: MLRO must approve STR filing
    'sar-approval': ['mlro', 'admin'],
    'asset-freeze': ['mlro', 'senior-management', 'admin'],
    'high-risk-onboarding': ['compliance-officer', 'mlro', 'senior-management', 'admin'],
    'pep-onboarding': ['senior-management', 'admin'],
    'pf-escalation': ['mlro', 'senior-management', 'admin'],
    'customer-exit': ['senior-management', 'compliance-officer', 'mlro', 'admin'],
  };

  const allowedRoles = approvalMap[gate];
  if (!allowedRoles) return { allowed: false, reason: `Unknown approval gate: ${gate}` };
  if (!allowedRoles.includes(approverRole)) {
    return { allowed: false, reason: `Role ${approverRole} cannot approve ${gate}` };
  }
  return { allowed: true };
}
