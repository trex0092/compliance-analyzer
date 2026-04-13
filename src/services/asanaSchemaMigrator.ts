/**
 * Asana Schema Migrator — F11.
 *
 * Inspect a tenant's Asana workspace and assert that every required
 * compliance custom field exists. If any are missing, produce the
 * create-custom-field payload set the orchestrator can POST to
 * Asana to bring the workspace into compliance with the schema
 * `asanaCustomFields.ts` expects.
 *
 * Pure compute — produces the migration plan. The orchestrator
 * executes it via asanaClient.
 *
 * Regulatory basis:
 *   FDL Art.24 (record retention with reportable structure)
 *   ISO/IEC 27001 A.8.10 (data structure control)
 */

export type RequiredFieldName =
  | 'risk_level'
  | 'verdict'
  | 'case_id'
  | 'deadline_type'
  | 'days_remaining'
  | 'confidence'
  | 'regulation'
  | 'four_eyes_status'
  | 'tenant_id';

export type FieldType = 'enum' | 'text' | 'number';

export interface ExpectedField {
  name: RequiredFieldName;
  type: FieldType;
  /** For enum fields, the canonical option list. */
  enumOptions?: readonly string[];
  /** Optional human-readable description. */
  description?: string;
}

export const EXPECTED_FIELDS: readonly ExpectedField[] = [
  {
    name: 'risk_level',
    type: 'enum',
    enumOptions: ['critical', 'high', 'medium', 'low'],
    description: 'Compliance risk level — feeds into MLRO dashboards.',
  },
  {
    name: 'verdict',
    type: 'enum',
    enumOptions: ['pass', 'flag', 'escalate', 'freeze'],
    description: 'Compliance brain final verdict.',
  },
  { name: 'case_id', type: 'text', description: 'Internal compliance case identifier.' },
  {
    name: 'deadline_type',
    type: 'enum',
    enumOptions: ['STR', 'CTR', 'CNMR', 'DPMSR', 'EOCN', 'SAR'],
    description: 'Type of regulatory deadline.',
  },
  { name: 'days_remaining', type: 'number', description: 'Days until the regulatory deadline.' },
  { name: 'confidence', type: 'number', description: 'Compliance brain confidence (0..1).' },
  { name: 'regulation', type: 'text', description: 'Regulatory basis citation.' },
  {
    name: 'four_eyes_status',
    type: 'enum',
    enumOptions: ['pending', 'approved', 'rejected', 'expired', 'conflict', 'role_mismatch'],
    description: 'Four-eyes review status.',
  },
  { name: 'tenant_id', type: 'text', description: 'Tenant scope identifier.' },
];

export interface ExistingField {
  name: string;
  type: FieldType;
  enumOptions?: readonly string[];
}

export interface FieldDelta {
  name: RequiredFieldName;
  action: 'create' | 'add-options' | 'ok';
  type: FieldType;
  /** Options to add when action === 'add-options'. */
  missingOptions?: readonly string[];
  description?: string;
}

export interface MigrationPlan {
  workspaceGid: string;
  totalExpected: number;
  alreadyOk: number;
  toCreate: number;
  toUpdate: number;
  deltas: readonly FieldDelta[];
}

/**
 * Compute the migration plan to bring an Asana workspace into
 * compliance with the expected custom-field schema. Idempotent —
 * running it twice on the same workspace produces an empty plan
 * after the first run completes.
 */
export function planSchemaMigration(
  workspaceGid: string,
  existingFields: readonly ExistingField[]
): MigrationPlan {
  const byName = new Map<string, ExistingField>();
  for (const f of existingFields) byName.set(f.name, f);

  const deltas: FieldDelta[] = [];
  for (const expected of EXPECTED_FIELDS) {
    const existing = byName.get(expected.name);
    if (!existing) {
      deltas.push({
        name: expected.name,
        action: 'create',
        type: expected.type,
        missingOptions: expected.enumOptions,
        description: expected.description,
      });
      continue;
    }
    if (existing.type !== expected.type) {
      // Type mismatch is not safely auto-migratable — surface as a
      // create action so the operator notices.
      deltas.push({
        name: expected.name,
        action: 'create',
        type: expected.type,
        missingOptions: expected.enumOptions,
        description:
          (expected.description ?? '') +
          ` (Existing field has type ${existing.type}, expected ${expected.type}. Recreate manually.)`,
      });
      continue;
    }
    if (expected.type === 'enum' && expected.enumOptions) {
      const existingOpts = new Set(existing.enumOptions ?? []);
      const missing = expected.enumOptions.filter((o) => !existingOpts.has(o));
      if (missing.length > 0) {
        deltas.push({
          name: expected.name,
          action: 'add-options',
          type: expected.type,
          missingOptions: missing,
          description: expected.description,
        });
        continue;
      }
    }
    deltas.push({
      name: expected.name,
      action: 'ok',
      type: expected.type,
      description: expected.description,
    });
  }

  const toCreate = deltas.filter((d) => d.action === 'create').length;
  const toUpdate = deltas.filter((d) => d.action === 'add-options').length;
  const alreadyOk = deltas.filter((d) => d.action === 'ok').length;

  return {
    workspaceGid,
    totalExpected: EXPECTED_FIELDS.length,
    alreadyOk,
    toCreate,
    toUpdate,
    deltas,
  };
}
