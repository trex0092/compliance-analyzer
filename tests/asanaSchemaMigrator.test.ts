import { describe, expect, it } from 'vitest';
import {
  EXPECTED_FIELDS,
  planSchemaMigration,
  type ExistingField,
} from '@/services/asanaSchemaMigrator';

function fieldsAsExisting(): ExistingField[] {
  return EXPECTED_FIELDS.map((f) => ({
    name: f.name,
    type: f.type,
    enumOptions: f.enumOptions ? [...f.enumOptions] : undefined,
  }));
}

describe('planSchemaMigration', () => {
  it('returns all-ok when every expected field already exists', () => {
    const plan = planSchemaMigration('ws-1', fieldsAsExisting());
    expect(plan.toCreate).toBe(0);
    expect(plan.toUpdate).toBe(0);
    expect(plan.alreadyOk).toBe(EXPECTED_FIELDS.length);
  });

  it('flags missing fields as create actions', () => {
    const plan = planSchemaMigration('ws-1', []);
    expect(plan.toCreate).toBe(EXPECTED_FIELDS.length);
    for (const d of plan.deltas) expect(d.action).toBe('create');
  });

  it('flags an enum field with missing options as add-options', () => {
    const fields = fieldsAsExisting();
    const verdictField = fields.find((f) => f.name === 'verdict')!;
    verdictField.enumOptions = ['pass'];
    const plan = planSchemaMigration('ws-1', fields);
    const verdictDelta = plan.deltas.find((d) => d.name === 'verdict')!;
    expect(verdictDelta.action).toBe('add-options');
    expect(verdictDelta.missingOptions).toContain('freeze');
  });

  it('flags a type mismatch as create (manual recreate)', () => {
    const fields = fieldsAsExisting();
    const verdictField = fields.find((f) => f.name === 'verdict')!;
    verdictField.type = 'text';
    const plan = planSchemaMigration('ws-1', fields);
    const verdictDelta = plan.deltas.find((d) => d.name === 'verdict')!;
    expect(verdictDelta.action).toBe('create');
    expect(verdictDelta.description).toMatch(/Recreate manually/);
  });

  it('is idempotent — running on the result produces no further changes', () => {
    const plan = planSchemaMigration('ws-1', fieldsAsExisting());
    const replan = planSchemaMigration('ws-1', fieldsAsExisting());
    expect(replan.toCreate).toBe(plan.toCreate);
    expect(replan.toUpdate).toBe(plan.toUpdate);
  });
});
