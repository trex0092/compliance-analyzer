/**
 * Setup-wizard endpoint tests — browser-only setup flow.
 *
 * Covers input validation + the pure helpers in:
 *   netlify/functions/setup-cohort-upload.mts
 *   netlify/functions/setup-asana-bootstrap.mts
 */
import { describe, it, expect } from 'vitest';

import { __test__ as cohortInternals } from '../netlify/functions/setup-cohort-upload.mts';
import { __test__ as bootstrapInternals } from '../netlify/functions/setup-asana-bootstrap.mts';

// ===========================================================================
// setup-cohort-upload validator
// ===========================================================================

describe('setup-cohort-upload validator', () => {
  const { validate, MAX_CSV_BYTES } = cohortInternals;

  it('accepts a valid request', () => {
    const r = validate({ tenantId: 'tenant-a', csv: 'id,name,tenantId\nu-1,Alice,tenant-a' });
    expect(r.ok).toBe(true);
  });

  it('rejects missing body', () => {
    expect(validate(null).ok).toBe(false);
    expect(validate(undefined).ok).toBe(false);
    expect(validate('string').ok).toBe(false);
  });

  it('rejects empty tenantId', () => {
    const r = validate({ tenantId: '', csv: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejects tenantId with illegal characters', () => {
    const r = validate({ tenantId: 'tenant A!', csv: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejects tenantId > 64 chars', () => {
    const r = validate({ tenantId: 'a'.repeat(65), csv: 'x' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty csv', () => {
    const r = validate({ tenantId: 'tenant-a', csv: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects csv over size cap', () => {
    const big = 'a'.repeat(MAX_CSV_BYTES + 1);
    const r = validate({ tenantId: 'tenant-a', csv: big });
    expect(r.ok).toBe(false);
  });

  it('MAX_CSV_BYTES is 10 MB', () => {
    expect(MAX_CSV_BYTES).toBe(10 * 1024 * 1024);
  });
});

// ===========================================================================
// setup-asana-bootstrap validator + helpers
// ===========================================================================

describe('setup-asana-bootstrap validator', () => {
  const { validate } = bootstrapInternals;

  it('accepts a valid tenantId', () => {
    const r = validate({ tenantId: 'tenant-a' });
    expect(r.ok).toBe(true);
  });

  it('rejects missing body', () => {
    expect(validate(null).ok).toBe(false);
    expect(validate(42).ok).toBe(false);
  });

  it('rejects empty tenantId', () => {
    expect(validate({ tenantId: '' }).ok).toBe(false);
  });

  it('rejects uppercase / space', () => {
    expect(validate({ tenantId: 'Tenant A' }).ok).toBe(false);
    expect(validate({ tenantId: 'tenant_a' }).ok).toBe(false);
  });

  it('rejects tenantId > 64 chars', () => {
    expect(validate({ tenantId: 'a'.repeat(65) }).ok).toBe(false);
  });
});

describe('setup-asana-bootstrap mapColor', () => {
  const { mapColor } = bootstrapInternals;

  it('maps known palette hex to Asana colour', () => {
    expect(mapColor('#1F77B4')).toBe('dark-blue');
    expect(mapColor('#D62728')).toBe('dark-red');
    expect(mapColor('#2CA02C')).toBe('dark-green');
  });

  it('falls back to dark-blue on unknown hex', () => {
    expect(mapColor('#123456')).toBe('dark-blue');
  });
});

describe('setup-asana-bootstrap mapFieldType', () => {
  const { mapFieldType } = bootstrapInternals;

  it('maps enum to enum', () => {
    expect(mapFieldType({ name: 'x', type: 'enum', source: 'brain' })).toBe('enum');
  });

  it('maps number to number', () => {
    expect(mapFieldType({ name: 'x', type: 'number', source: 'brain' })).toBe('number');
  });

  it('maps date to date', () => {
    expect(mapFieldType({ name: 'x', type: 'date', source: 'sla-enforcer' })).toBe('date');
  });

  it('maps task_reference to text (Asana limitation)', () => {
    expect(
      mapFieldType({ name: 'x', type: 'task_reference', source: 'four-eyes' })
    ).toBe('text');
  });

  it('maps text to text', () => {
    expect(mapFieldType({ name: 'x', type: 'text', source: 'brain' })).toBe('text');
  });
});
