/**
 * CSV Cohort Importer tests.
 */
import { describe, it, expect } from 'vitest';

import {
  importCohortCsv,
  MAX_COHORT_SIZE,
  __test__,
} from '../src/services/csvCohortImporter';

const { parseCsvRow, splitCsvRows } = __test__;

describe('parseCsvRow', () => {
  it('simple split', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('quoted field with embedded comma', () => {
    expect(parseCsvRow('"hello, world","b"')).toEqual(['hello, world', 'b']);
  });

  it('escaped double quote inside quoted field', () => {
    expect(parseCsvRow('"hello ""quoted"" world"')).toEqual(['hello "quoted" world']);
  });

  it('trims whitespace', () => {
    expect(parseCsvRow('  a , b  , c')).toEqual(['a', 'b', 'c']);
  });
});

describe('splitCsvRows', () => {
  it('handles LF', () => {
    expect(splitCsvRows('a,b\nc,d').length).toBe(2);
  });
  it('handles CRLF', () => {
    expect(splitCsvRows('a,b\r\nc,d').length).toBe(2);
  });
  it('does not split on newlines inside quoted fields', () => {
    const raw = '"multi\nline",b\nc,d';
    const rows = splitCsvRows(raw);
    expect(rows.length).toBe(2);
    expect(rows[0]!).toContain('multi\nline');
  });
});

describe('importCohortCsv', () => {
  const target = 'tenant-a';

  it('empty CSV returns empty result', () => {
    const r = importCohortCsv('', { targetTenantId: target });
    expect(r.customers).toEqual([]);
    expect(r.summary).toMatch(/Empty/);
  });

  it('rejects when a required column is missing', () => {
    const csv = 'id,name\nx,Alice';
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.customers).toEqual([]);
    expect(r.summary).toMatch(/tenantId/);
  });

  it('imports a minimal valid row', () => {
    const csv = 'id,name,tenantId\nu-1,Alice,tenant-a';
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.customers.length).toBe(1);
    expect(r.customers[0]!.id).toBe('u-1');
    expect(r.customers[0]!.name).toBe('Alice');
    expect(r.customers[0]!.tenantId).toBe('tenant-a');
    expect(r.errors).toEqual([]);
  });

  it('parses aliases as semicolon-separated', () => {
    const csv = 'id,name,tenantId,aliases\nu-1,Alice,tenant-a,Alicia;Ally';
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.customers[0]!.aliases).toEqual(['Alicia', 'Ally']);
  });

  it('parses DOB + nationality + last-screened', () => {
    const csv = [
      'id,name,tenantId,dateOfBirth,nationality,lastScreenedAtIso',
      'u-1,Alice,tenant-a,1990-04-15,ae,2026-04-10T00:00:00Z',
    ].join('\n');
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.customers[0]!.dateOfBirth).toBe('1990-04-15');
    expect(r.customers[0]!.nationality).toBe('AE'); // normalised to uppercase
    expect(r.customers[0]!.lastScreenedAtIso).toBe('2026-04-10T00:00:00Z');
  });

  it('rejects cross-tenant rows', () => {
    const csv = 'id,name,tenantId\nu-1,Alice,tenant-OTHER';
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.customers).toEqual([]);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.reason).toMatch(/tenantId mismatch/);
  });

  it('rejects invalid DOB format', () => {
    const csv = 'id,name,tenantId,dateOfBirth\nu-1,Alice,tenant-a,15-04-1990';
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.reason).toMatch(/YYYY-MM-DD/);
  });

  it('rejects invalid nationality', () => {
    const csv = 'id,name,tenantId,nationality\nu-1,Alice,tenant-a,USA';
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.reason).toMatch(/ISO 3166/);
  });

  it('warns on unknown columns', () => {
    const csv = 'id,name,tenantId,secret_field\nu-1,Alice,tenant-a,xxx';
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.warnings.some((w) => w.includes('secret_field'))).toBe(true);
    expect(r.customers.length).toBe(1); // still imports the good fields
  });

  it('reports per-row errors without failing the whole import', () => {
    const csv = [
      'id,name,tenantId',
      'u-1,Alice,tenant-a', // ok
      ',Bob,tenant-a', // missing id
      'u-3,Charlie,tenant-a', // ok
    ].join('\n');
    const r = importCohortCsv(csv, { targetTenantId: target });
    expect(r.customers.length).toBe(2);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]!.rowNumber).toBe(3); // 1-indexed with header
  });

  it('honours maxRows and warns on truncation', () => {
    const rows = ['id,name,tenantId'];
    for (let i = 0; i < 5; i++) rows.push(`u-${i},Customer${i},tenant-a`);
    const r = importCohortCsv(rows.join('\n'), { targetTenantId: target, maxRows: 3 });
    expect(r.customers.length).toBe(3);
    expect(r.warnings.some((w) => w.includes('Truncated'))).toBe(true);
  });

  it('MAX_COHORT_SIZE is a reasonable default', () => {
    expect(MAX_COHORT_SIZE).toBeGreaterThanOrEqual(10_000);
  });

  it('carries the regulatory anchors', () => {
    const r = importCohortCsv('id,name,tenantId\nu,A,tenant-a', { targetTenantId: target });
    expect(r.regulatory).toContain('FDL No.10/2025 Art.12-14');
    expect(r.regulatory).toContain('FATF Rec 10');
    expect(r.regulatory).toContain('EU GDPR Art.25');
  });
});
