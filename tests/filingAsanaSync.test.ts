/**
 * Tests for filingAsanaSync.ts — the STR/SAR/CTR/CNMR/DPMSR/EOCN
 * task-mirror builder. Tests focus on the pure-function payload builder
 * (__test__) to avoid hitting the real Asana API.
 */
import { describe, it, expect } from 'vitest';
import { __test__ } from '@/services/filingAsanaSync';
import type { FilingRecord } from '@/services/filingAsanaSync';

const { buildFilingTaskPayload, filingDueDays, filingCitation } = __test__;

function baseFiling(overrides: Partial<FilingRecord> = {}): FilingRecord {
  return {
    filingId: 'F-001',
    filingType: 'STR',
    entityId: 'E1',
    entityName: 'Target Corp',
    status: 'drafted',
    draftedAt: '2026-04-01T08:00:00Z',
    regulatoryDeadline: '2026-04-15',
    daysRemaining: 7,
    narrative: 'Customer exhibited structuring pattern over 30 days.',
    draftedBy: 'analyst@compliance',
    ...overrides,
  };
}

describe('filingDueDays', () => {
  it('STR and SAR use 10bd', () => {
    expect(filingDueDays('STR')).toBe(10);
    expect(filingDueDays('SAR')).toBe(10);
  });
  it('CTR and DPMSR use 15bd', () => {
    expect(filingDueDays('CTR')).toBe(15);
    expect(filingDueDays('DPMSR')).toBe(15);
  });
  it('CNMR uses 5bd', () => {
    expect(filingDueDays('CNMR')).toBe(5);
  });
  it('EOCN uses 1bd (24h freeze)', () => {
    expect(filingDueDays('EOCN')).toBe(1);
  });
});

describe('filingCitation', () => {
  it('STR cites FDL Art.26-27', () => {
    expect(filingCitation('STR')).toContain('FDL No.10/2025 Art.26-27');
  });
  it('CNMR cites Cabinet Res 74/2020', () => {
    expect(filingCitation('CNMR')).toContain('Cabinet Res 74/2020');
  });
  it('EOCN cites 24 hour freeze', () => {
    expect(filingCitation('EOCN')).toContain('24 hour');
  });
});

describe('buildFilingTaskPayload', () => {
  it('task name contains status tag, type, and entity', () => {
    const payload = buildFilingTaskPayload(baseFiling(), 'proj-1');
    expect(payload.name).toContain('[DRAFT]');
    expect(payload.name).toContain('[STR]');
    expect(payload.name).toContain('Target Corp');
  });

  it('submitted status uses SUBMITTED tag', () => {
    const payload = buildFilingTaskPayload(baseFiling({ status: 'submitted' }), 'proj-1');
    expect(payload.name).toContain('[SUBMITTED]');
  });

  it('overdue days remaining show OVERDUE in name', () => {
    const payload = buildFilingTaskPayload(baseFiling({ daysRemaining: 0 }), 'proj-1');
    expect(payload.name).toContain('[OVERDUE]');
  });

  it('goAML XML is embedded in a fenced xml block', () => {
    const xml = '<?xml version="1.0"?><report><type>STR</type></report>';
    const payload = buildFilingTaskPayload(baseFiling({ goamlXml: xml }), 'proj-1');
    expect(payload.notes).toContain('## goAML XML');
    expect(payload.notes).toContain('```xml');
    expect(payload.notes).toContain(xml);
  });

  it('submission receipt is embedded when present', () => {
    const payload = buildFilingTaskPayload(
      baseFiling({ submissionReceipt: 'FIU-REF-12345' }),
      'proj-1'
    );
    expect(payload.notes).toContain('## Submission receipt');
    expect(payload.notes).toContain('FIU-REF-12345');
  });

  it('notes always include tipping-off warning', () => {
    const payload = buildFilingTaskPayload(baseFiling(), 'proj-1');
    expect(payload.notes).toContain('FDL No.10/2025 Art.29');
    expect(payload.notes).toContain('no tipping-off');
  });

  it('due_on is the regulatory deadline', () => {
    const payload = buildFilingTaskPayload(baseFiling(), 'proj-1');
    expect(payload.due_on).toBe('2026-04-15');
  });

  it('project id is propagated to projects array', () => {
    const payload = buildFilingTaskPayload(baseFiling(), 'custom-project');
    expect(payload.projects).toEqual(['custom-project']);
  });

  it('low daysRemaining produces a critical task for the SLA field when env configured', () => {
    process.env.ASANA_CF_RISK_LEVEL_GID = 'field-risk';
    process.env.ASANA_CF_RISK_LEVEL_CRITICAL = 'opt-critical';
    const payload = buildFilingTaskPayload(baseFiling({ daysRemaining: 1 }), 'proj-1');
    expect(payload.custom_fields?.['field-risk']).toBe('opt-critical');
    delete process.env.ASANA_CF_RISK_LEVEL_GID;
    delete process.env.ASANA_CF_RISK_LEVEL_CRITICAL;
  });
});
