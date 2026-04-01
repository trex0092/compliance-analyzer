export type Role =
  | "analyst"
  | "compliance-officer"
  | "mlro"
  | "senior-management"
  | "admin";

export type Action =
  | "view-case"
  | "create-case"
  | "update-case"
  | "decide-case"
  | "approve-str"
  | "file-report"
  | "approve-onboarding"
  | "approve-edd"
  | "freeze-assets"
  | "manage-users"
  | "view-screening"
  | "run-screening"
  | "view-customer"
  | "edit-customer"
  | "view-evidence"
  | "upload-evidence"
  | "view-audit-log"
  | "export-data"
  | "delete-records";

const PERMISSION_MATRIX: Record<Role, Action[]> = {
  analyst: [
    "view-case", "create-case", "update-case",
    "view-screening", "run-screening",
    "view-customer",
    "view-evidence", "upload-evidence",
    "view-audit-log",
  ],
  "compliance-officer": [
    "view-case", "create-case", "update-case", "decide-case",
    "view-screening", "run-screening",
    "view-customer", "edit-customer",
    "view-evidence", "upload-evidence",
    "view-audit-log", "export-data",
    "approve-edd",
  ],
  mlro: [
    "view-case", "create-case", "update-case", "decide-case",
    "approve-str", "file-report",
    "view-screening", "run-screening",
    "view-customer", "edit-customer",
    "view-evidence", "upload-evidence",
    "view-audit-log", "export-data",
    "approve-edd", "freeze-assets",
  ],
  "senior-management": [
    "view-case", "decide-case",
    "approve-str", "approve-onboarding",
    "approve-edd", "freeze-assets",
    "view-screening",
    "view-customer",
    "view-evidence",
    "view-audit-log", "export-data",
  ],
  admin: [
    "view-case", "create-case", "update-case", "decide-case",
    "approve-str", "file-report",
    "approve-onboarding", "approve-edd", "freeze-assets",
    "manage-users",
    "view-screening", "run-screening",
    "view-customer", "edit-customer",
    "view-evidence", "upload-evidence",
    "view-audit-log", "export-data",
    "delete-records",
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
    case "approve-str":
      return ["mlro", "senior-management"];
    case "freeze-assets":
      return ["mlro", "senior-management"];
    case "approve-onboarding":
      return ["senior-management"];
    case "file-report":
      return ["mlro"];
    case "delete-records":
      return ["admin"];
    default:
      return [];
  }
}
