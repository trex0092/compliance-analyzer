/**
 * Tests for asanaCustomFields.ts — the enum → Asana custom-field GID
 * mapping layer. These tests set env vars inline so they never touch
 * the real Asana API or a live workspace.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildComplianceCustomFields,
  deadlineTypeFromCaseType,
} from '@/services/asanaCustomFields';

const KEYS = [
  'ASANA_CF_RISK_LEVEL_GID',
  'ASANA_CF_RISK_LEVEL_CRITICAL',
  'ASANA_CF_RISK_LEVEL_HIGH',
  'ASANA_CF_RISK_LEVEL_MEDIUM',
  'ASANA_CF_RISK_LEVEL_LOW',
  'ASANA_CF_VERDICT_GID',
  'ASANA_CF_VERDICT_PASS',
  'ASANA_CF_VERDICT_FLAG',
  'ASANA_CF_VERDICT_ESCALATE',
  'ASANA_CF_VERDICT_FREEZE',
  'ASANA_CF_CASE_ID_GID',
  'ASANA_CF_DEADLINE_TYPE_GID',
  'ASANA_CF_DEADLINE_TYPE_STR',
  'ASANA_CF_DEADLINE_TYPE_CTR',
  'ASANA_CF_DEADLINE_TYPE_CNMR',
  'ASANA_CF_DEADLINE_TYPE_DPMSR',
  'ASANA_CF_DEADLINE_TYPE_EOCN',
  'ASANA_CF_DEADLINE_TYPE_SAR',
  'ASANA_CF_DAYS_REMAINING_GID',
  'ASANA_CF_CONFIDENCE_GID',
  'ASANA_CF_REGULATION_GID',
  'ASANA_CF_MANUAL_ACTION_GID',
  'ASANA_CF_MANUAL_ACTION_PENDING',
  'ASANA_CF_MANUAL_ACTION_DONE',
];

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe('buildComplianceCustomFields — no env configured', () => {
  it('returns empty object when no env vars are set', () => {
    const out = buildComplianceCustomFields({
      riskLevel: 'critical',
      verdict: 'freeze',
      caseId: 'C1',
    });
    expect(out).toEqual({});
  });
});

describe('buildComplianceCustomFields — env configured', () => {
  beforeEach(() => {
    process.env.ASANA_CF_RISK_LEVEL_GID = 'field-risk';
    process.env.ASANA_CF_RISK_LEVEL_CRITICAL = 'opt-critical';
    process.env.ASANA_CF_RISK_LEVEL_HIGH = 'opt-high';
    process.env.ASANA_CF_VERDICT_GID = 'field-verdict';
    process.env.ASANA_CF_VERDICT_FREEZE = 'opt-freeze';
    process.env.ASANA_CF_CASE_ID_GID = 'field-caseid';
    process.env.ASANA_CF_DEADLINE_TYPE_GID = 'field-deadline';
    process.env.ASANA_CF_DEADLINE_TYPE_STR = 'opt-str';
    process.env.ASANA_CF_DAYS_REMAINING_GID = 'field-days';
    process.env.ASANA_CF_CONFIDENCE_GID = 'field-conf';
    process.env.ASANA_CF_REGULATION_GID = 'field-reg';
  });

  it('maps risk level to option GID', () => {
    const out = buildComplianceCustomFields({ riskLevel: 'critical' });
    expect(out['field-risk']).toBe('opt-critical');
  });

  it('maps verdict to option GID', () => {
    const out = buildComplianceCustomFields({ verdict: 'freeze' });
    expect(out['field-verdict']).toBe('opt-freeze');
  });

  it('populates caseId as text', () => {
    const out = buildComplianceCustomFields({ caseId: 'CASE-001' });
    expect(out['field-caseid']).toBe('CASE-001');
  });

  it('maps deadline type STR', () => {
    const out = buildComplianceCustomFields({ deadlineType: 'STR' });
    expect(out['field-deadline']).toBe('opt-str');
  });

  it('populates numeric daysRemaining', () => {
    const out = buildComplianceCustomFields({ daysRemaining: 7 });
    expect(out['field-days']).toBe(7);
  });

  it('converts confidence to percentage integer', () => {
    const out = buildComplianceCustomFields({ confidence: 0.734 });
    expect(out['field-conf']).toBe(73);
  });

  it('populates regulation citation', () => {
    const out = buildComplianceCustomFields({
      regulationCitation: 'FDL Art.20',
    });
    expect(out['field-reg']).toBe('FDL Art.20');
  });

  it('maps manualActionRequired pending → red chip option (Tier-4 #13)', () => {
    process.env.ASANA_CF_MANUAL_ACTION_GID = 'field-manual';
    process.env.ASANA_CF_MANUAL_ACTION_PENDING = 'opt-manual-pending';
    const out = buildComplianceCustomFields({ manualActionRequired: 'pending' });
    expect(out['field-manual']).toBe('opt-manual-pending');
  });

  it('maps manualActionRequired done → green chip option', () => {
    process.env.ASANA_CF_MANUAL_ACTION_GID = 'field-manual';
    process.env.ASANA_CF_MANUAL_ACTION_DONE = 'opt-manual-done';
    const out = buildComplianceCustomFields({ manualActionRequired: 'done' });
    expect(out['field-manual']).toBe('opt-manual-done');
  });

  it('drops manualActionRequired silently when env GID is unset', () => {
    // No ASANA_CF_MANUAL_ACTION_GID — the field should be omitted
    // from the payload, not crash.
    const out = buildComplianceCustomFields({ manualActionRequired: 'pending' });
    expect(Object.keys(out)).not.toContain('field-manual');
  });

  it('populates all fields together', () => {
    process.env.ASANA_CF_MANUAL_ACTION_GID = 'field-manual';
    process.env.ASANA_CF_MANUAL_ACTION_PENDING = 'opt-manual-pending';
    const out = buildComplianceCustomFields({
      riskLevel: 'high',
      verdict: 'freeze',
      caseId: 'C1',
      deadlineType: 'STR',
      daysRemaining: 3,
      confidence: 0.92,
      regulationCitation: 'FDL Art.26',
      manualActionRequired: 'pending',
    });
    expect(Object.keys(out).length).toBe(8);
    expect(out['field-risk']).toBe('opt-high');
    expect(out['field-manual']).toBe('opt-manual-pending');
  });

  it('missing per-option env var leaves that field unset', () => {
    // ASANA_CF_RISK_LEVEL_LOW is not set — calling with riskLevel=low
    // should not crash and should return an empty object.
    const out = buildComplianceCustomFields({ riskLevel: 'low' });
    expect(out['field-risk']).toBeUndefined();
  });
});

describe('deadlineTypeFromCaseType', () => {
  it('detects STR', () => {
    expect(deadlineTypeFromCaseType('STR filing')).toBe('STR');
  });
  it('detects SAR', () => {
    expect(deadlineTypeFromCaseType('SAR review')).toBe('SAR');
  });
  it('detects CTR', () => {
    expect(deadlineTypeFromCaseType('Cash transaction report CTR')).toBe('CTR');
  });
  it('detects CNMR', () => {
    expect(deadlineTypeFromCaseType('CNMR filing')).toBe('CNMR');
  });
  it('detects EOCN via freeze', () => {
    expect(deadlineTypeFromCaseType('Asset freeze EOCN')).toBe('EOCN');
  });
  it('returns undefined for unknown types', () => {
    expect(deadlineTypeFromCaseType('unknown case')).toBeUndefined();
  });
});
