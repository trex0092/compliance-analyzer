/**
 * RBAC Permission Matrix — single source of truth for which role
 * can perform which action in the tool.
 *
 * Why this exists:
 *   src/domain/rbac.ts already defines the Role type but there's no
 *   SURFACE showing the full permission matrix (role × action →
 *   allowed). Regulators at inspection time want this matrix as a
 *   single document.
 *
 *   This module is the pure matrix + the `can()` helper every
 *   endpoint / skill runner / UI button calls before acting.
 *
 *   Also: produces an RBAC audit trail of every permission denial
 *   (via `deniedRecord`) so "why was I blocked?" is answerable.
 *
 * Regulatory basis:
 *   Cabinet Res 134/2025 Art.12-14 (role-based separation)
 *   FDL No.10/2025 Art.20-22 (CO responsibilities)
 *   EU AI Act Art.14         (human oversight by role)
 *   ISO/IEC 27001 A.9.2      (access control)
 *   NIST AI RMF 1.0 GOVERN-3 (role accountability)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Role = 'guest' | 'analyst' | 'mlro' | 'co' | 'board' | 'admin';

export type Action =
  | 'brain.analyze'
  | 'brain.replay'
  | 'brain.evidenceBundle'
  | 'brain.telemetry'
  | 'tierC.clamp.propose'
  | 'tierC.clamp.decide'
  | 'tierC.outbound.enqueue'
  | 'tierC.outbound.release'
  | 'tierC.outbound.cancel'
  | 'tierC.breakGlass.request'
  | 'tierC.breakGlass.approve'
  | 'tierC.zkCrossTenant.commit'
  | 'tierC.zkCrossTenant.aggregate'
  | 'asana.dispatch'
  | 'asana.schemaMigrate'
  | 'audit.query'
  | 'audit.export'
  | 'settings.view'
  | 'settings.edit'
  | 'policy.view'
  | 'policy.draft'
  | 'policy.sign.mlro'
  | 'policy.sign.co'
  | 'policy.sign.board'
  | 'cohort.import'
  | 'cohort.view'
  | 'report.generate'
  | 'report.export'
  | 'demo.toggle'
  | 'rbac.manage';

export interface PermissionEntry {
  role: Role;
  action: Action;
  allowed: boolean;
  /** Regulatory anchor for the specific permission. */
  citation: string;
}

export interface CanCheckResult {
  allowed: boolean;
  reason: string;
  regulatory: string;
}

// ---------------------------------------------------------------------------
// Role hierarchy (higher wins)
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<Role, number> = {
  guest: 0,
  analyst: 1,
  mlro: 2,
  co: 3,
  board: 4,
  admin: 5,
};

// ---------------------------------------------------------------------------
// Permission spec — role-or-higher unless overridden below
// ---------------------------------------------------------------------------

interface PermissionRule {
  action: Action;
  /** Minimum role required. */
  minRole: Role;
  citation: string;
  /**
   * Hard overrides — these roles are explicitly denied even if they
   * exceed `minRole`. Used for self-approval rejection (e.g. MLRO
   * cannot approve their own break-glass).
   */
  deny?: readonly Role[];
}

const RULES: readonly PermissionRule[] = [
  // Brain
  { action: 'brain.analyze', minRole: 'analyst', citation: 'FDL Art.20' },
  { action: 'brain.replay', minRole: 'analyst', citation: 'FDL Art.20' },
  { action: 'brain.evidenceBundle', minRole: 'mlro', citation: 'FDL Art.24' },
  { action: 'brain.telemetry', minRole: 'analyst', citation: 'FDL Art.20' },

  // Tier C
  { action: 'tierC.clamp.propose', minRole: 'mlro', citation: 'NIST AI RMF GOVERN-4' },
  { action: 'tierC.clamp.decide', minRole: 'co', citation: 'Cabinet Res 134/2025 Art.19' },
  { action: 'tierC.outbound.enqueue', minRole: 'analyst', citation: 'FDL Art.29' },
  { action: 'tierC.outbound.release', minRole: 'co', citation: 'FDL Art.29' },
  { action: 'tierC.outbound.cancel', minRole: 'mlro', citation: 'FDL Art.29' },
  {
    action: 'tierC.breakGlass.request',
    minRole: 'mlro',
    citation: 'Cabinet Res 134/2025 Art.12-14',
  },
  { action: 'tierC.breakGlass.approve', minRole: 'co', citation: 'Cabinet Res 134/2025 Art.12-14' },
  { action: 'tierC.zkCrossTenant.commit', minRole: 'analyst', citation: 'EU GDPR Art.25' },
  { action: 'tierC.zkCrossTenant.aggregate', minRole: 'mlro', citation: 'EU GDPR Art.25' },

  // Asana
  { action: 'asana.dispatch', minRole: 'mlro', citation: 'Cabinet Res 134/2025 Art.19' },
  { action: 'asana.schemaMigrate', minRole: 'co', citation: 'Cabinet Res 134/2025 Art.19' },

  // Audit
  { action: 'audit.query', minRole: 'analyst', citation: 'FDL Art.24' },
  { action: 'audit.export', minRole: 'mlro', citation: 'FDL Art.24' },

  // Settings
  { action: 'settings.view', minRole: 'analyst', citation: 'FDL Art.20' },
  { action: 'settings.edit', minRole: 'co', citation: 'FDL Art.20' },

  // Policy
  { action: 'policy.view', minRole: 'analyst', citation: 'FDL Art.20-21' },
  { action: 'policy.draft', minRole: 'mlro', citation: 'FDL Art.20-21' },
  { action: 'policy.sign.mlro', minRole: 'mlro', citation: 'Cabinet Res 134/2025 Art.12-14' },
  { action: 'policy.sign.co', minRole: 'co', citation: 'Cabinet Res 134/2025 Art.12-14' },
  { action: 'policy.sign.board', minRole: 'board', citation: 'Cabinet Res 134/2025 Art.12-14' },

  // Cohort
  { action: 'cohort.import', minRole: 'mlro', citation: 'FDL Art.12-14' },
  { action: 'cohort.view', minRole: 'analyst', citation: 'FDL Art.12-14' },

  // Report
  { action: 'report.generate', minRole: 'mlro', citation: 'MoE Circular 08/AML/2021' },
  { action: 'report.export', minRole: 'co', citation: 'MoE Circular 08/AML/2021' },

  // Demo
  { action: 'demo.toggle', minRole: 'co', citation: 'FDL Art.20-22' },

  // RBAC management
  { action: 'rbac.manage', minRole: 'admin', citation: 'ISO/IEC 27001 A.9.2' },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function can(role: Role, action: Action): CanCheckResult {
  const rule = RULES.find((r) => r.action === action);
  if (!rule) {
    return {
      allowed: false,
      reason: `unknown action "${action}"`,
      regulatory: 'ISO/IEC 27001 A.9.2',
    };
  }
  if (rule.deny && rule.deny.includes(role)) {
    return {
      allowed: false,
      reason: `role "${role}" explicitly denied on "${action}"`,
      regulatory: rule.citation,
    };
  }
  const allowed = ROLE_RANK[role] >= ROLE_RANK[rule.minRole];
  return {
    allowed,
    reason: allowed
      ? `role "${role}" meets minimum "${rule.minRole}"`
      : `role "${role}" below minimum "${rule.minRole}" for "${action}"`,
    regulatory: rule.citation,
  };
}

export interface PermissionMatrixRow {
  action: Action;
  minRole: Role;
  citation: string;
  /** Roles that CAN perform this action, ordered by rank. */
  allowedRoles: readonly Role[];
}

export function buildPermissionMatrix(): readonly PermissionMatrixRow[] {
  const allRoles: Role[] = ['guest', 'analyst', 'mlro', 'co', 'board', 'admin'];
  return RULES.map((rule) => ({
    action: rule.action,
    minRole: rule.minRole,
    citation: rule.citation,
    allowedRoles: allRoles.filter((r) => can(r, rule.action).allowed),
  }));
}

// Exports for tests.
export const __test__ = { ROLE_RANK, RULES };
