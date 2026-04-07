export type Role =
  | 'analyst'
  | 'compliance-officer'
  | 'mlro'
  | 'senior-management'
  | 'admin'
  | 'fiu-liaison'
  | 'external-auditor';

export type Action =
  | 'view-case'
  | 'create-case'
  | 'update-case'
  | 'decide-case'
  | 'approve-str'
  | 'approve-sar'
  | 'approve-ctr'
  | 'file-report'
  | 'file-str'
  | 'file-sar'
  | 'file-ctr'
  | 'approve-onboarding'
  | 'approve-edd'
  | 'freeze-assets'
  | 'unfreeze-assets'
  | 'manage-users'
  | 'view-screening'
  | 'run-screening'
  | 'view-customer'
  | 'edit-customer'
  | 'view-evidence'
  | 'upload-evidence'
  | 'view-audit-log'
  | 'export-data'
  | 'delete-records'
  | 'approve-customer-exit'
  | 'escalate-to-fiu'
  | 'escalate-to-eocn'
  | 'view-regulatory-framework'
  | 'manage-audit-checklist'
  | 'view-kpi-dashboard'
  | 'pf-escalation';

const PERMISSION_MATRIX: Record<Role, Action[]> = {
  analyst: [
    'view-case',
    'create-case',
    'update-case',
    'view-screening',
    'run-screening',
    'view-customer',
    'view-evidence',
    'upload-evidence',
    'view-audit-log',
    'view-regulatory-framework',
    'view-kpi-dashboard',
  ],
  'compliance-officer': [
    'view-case',
    'create-case',
    'update-case',
    'decide-case',
    'view-screening',
    'run-screening',
    'view-customer',
    'edit-customer',
    'view-evidence',
    'upload-evidence',
    'view-audit-log',
    'export-data',
    'approve-edd',
    'approve-ctr',
    'file-ctr',
    'view-regulatory-framework',
    'view-kpi-dashboard',
  ],
  mlro: [
    'view-case',
    'create-case',
    'update-case',
    'decide-case',
    'approve-str',
    'approve-sar',
    'approve-ctr',
    'file-report',
    'file-str',
    'file-sar',
    'file-ctr',
    'view-screening',
    'run-screening',
    'view-customer',
    'edit-customer',
    'view-evidence',
    'upload-evidence',
    'view-audit-log',
    'export-data',
    'approve-edd',
    'freeze-assets',
    'escalate-to-fiu',
    'escalate-to-eocn',
    'pf-escalation',
    'view-regulatory-framework',
    'manage-audit-checklist',
    'view-kpi-dashboard',
  ],
  'senior-management': [
    'view-case',
    'decide-case',
    'approve-str',
    'approve-sar',
    'approve-onboarding',
    'approve-edd',
    'freeze-assets',
    'unfreeze-assets',
    'approve-customer-exit',
    'view-screening',
    'view-customer',
    'view-evidence',
    'upload-evidence',
    'view-audit-log',
    'export-data',
    'view-regulatory-framework',
    'manage-audit-checklist',
    'view-kpi-dashboard',
  ],
  admin: [
    'view-case',
    'create-case',
    'update-case',
    'decide-case',
    'approve-str',
    'approve-sar',
    'approve-ctr',
    'file-report',
    'file-str',
    'file-sar',
    'file-ctr',
    'approve-onboarding',
    'approve-edd',
    'freeze-assets',
    'unfreeze-assets',
    'approve-customer-exit',
    'manage-users',
    'view-screening',
    'run-screening',
    'view-customer',
    'edit-customer',
    'view-evidence',
    'upload-evidence',
    'view-audit-log',
    'export-data',
    'delete-records',
    'escalate-to-fiu',
    'escalate-to-eocn',
    'pf-escalation',
    'view-regulatory-framework',
    'manage-audit-checklist',
    'view-kpi-dashboard',
  ],
  'fiu-liaison': [
    'view-case',
    'file-report',
    'file-str',
    'file-sar',
    'file-ctr',
    'escalate-to-fiu',
    'escalate-to-eocn',
    'view-screening',
    'view-customer',
    'view-evidence',
    'view-audit-log',
    'export-data',
    'view-regulatory-framework',
    'view-kpi-dashboard',
  ],
  'external-auditor': [
    'view-case',
    'view-screening',
    'view-customer',
    'view-evidence',
    'view-audit-log',
    'export-data',
    'view-regulatory-framework',
    'manage-audit-checklist',
    'view-kpi-dashboard',
  ],
};

export function canPerform(role: Role, action: Action): boolean {
  return PERMISSION_MATRIX[role]?.includes(action) ?? false;
}

export function getPermissions(role: Role): Action[] {
  return PERMISSION_MATRIX[role] ?? [];
}

export function requiresApproval(action: Action): Role[] {
  switch (action) {
    case 'approve-str':
    case 'approve-sar':
      return ['mlro', 'senior-management'];
    case 'approve-ctr':
      return ['compliance-officer', 'mlro'];
    case 'freeze-assets':
      return ['mlro', 'senior-management'];
    case 'unfreeze-assets':
      return ['senior-management'];
    case 'approve-onboarding':
      return ['senior-management'];
    case 'approve-customer-exit':
      return ['senior-management'];
    case 'file-report':
    case 'file-str':
    case 'file-sar':
      return ['mlro'];
    case 'escalate-to-eocn':
      return ['mlro'];
    case 'pf-escalation':
      return ['mlro', 'senior-management'];
    case 'delete-records':
      return ['admin'];
    default:
      return [];
  }
}
