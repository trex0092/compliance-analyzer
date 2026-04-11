/**
 * Tests for complianceReportBuilder — MoE/FIU/EOCN screening report
 * generator that produces HTML + JSON + Markdown artefacts for Asana
 * attachment upload.
 */
import { describe, it, expect } from 'vitest';
import {
  buildScreeningReport,
  type ScreeningReportInput,
} from '@/services/complianceReportBuilder';

function baseInput(overrides: Partial<ScreeningReportInput> = {}): ScreeningReportInput {
  return {
    runAtIso: '2026-04-11T09:00:00Z',
    reportingEntity: 'Acme Gold Trading LLC',
    licenceNumber: 'CN-1234567',
    complianceOfficer: 'Luisa Fernanda',
    listsScreened: ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN'],
    totalChecked: 12,
    totalNewHits: 0,
    subjectsWithAlerts: [],
    subjectsWithErrors: [],
    subjectsClean: [
      { subjectId: 'S1', subjectName: 'Clean Customer 1' },
      { subjectId: 'S2', subjectName: 'Clean Customer 2' },
    ],
    ...overrides,
  };
}

describe('complianceReportBuilder — basic shape', () => {
  it('produces html + json + markdown + integrity hash', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.html.length).toBeGreaterThan(0);
    expect(report.json.length).toBeGreaterThan(0);
    expect(report.markdown.length).toBeGreaterThan(0);
    expect(report.integrityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('filenames use the run date + time slug', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.filenames.html).toMatch(/screening-report-20260411-0900\.html/);
    expect(report.filenames.json).toMatch(/screening-report-20260411-0900\.json/);
    expect(report.filenames.markdown).toMatch(/screening-report-20260411-0900\.md/);
  });

  it('deterministic integrity hash for same input', async () => {
    const a = await buildScreeningReport(baseInput());
    const b = await buildScreeningReport(baseInput());
    expect(a.integrityHash).toBe(b.integrityHash);
  });

  it('different inputs produce different integrity hashes', async () => {
    const a = await buildScreeningReport(baseInput({ totalChecked: 12 }));
    const b = await buildScreeningReport(baseInput({ totalChecked: 13 }));
    expect(a.integrityHash).not.toBe(b.integrityHash);
  });
});

describe('complianceReportBuilder — HTML compliance content', () => {
  it('HTML contains reporting entity, CO, licence, and dd/mm/yyyy date', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.html).toContain('Acme Gold Trading LLC');
    expect(report.html).toContain('Luisa Fernanda');
    expect(report.html).toContain('CN-1234567');
    expect(report.html).toContain('11/04/2026');
  });

  it('HTML contains the confidentiality + tipping-off notice', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.html).toContain('CONFIDENTIAL');
    expect(report.html).toContain('FDL No.10/2025 Art.29');
  });

  it('HTML includes the regulatory framework section', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.html).toContain('Regulatory framework');
    expect(report.html).toContain('FATF Rec 10');
    expect(report.html).toContain('Cabinet Res 74/2020');
    expect(report.html).toContain('MoE Circular 08/AML/2021');
  });

  it('HTML shows all six sanctions lists', async () => {
    const report = await buildScreeningReport(baseInput());
    for (const list of ['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN']) {
      expect(report.html).toContain(list);
    }
  });

  it('HTML renders integrity hash in chain-of-custody section', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.html).toContain('SHA-256 integrity hash');
    expect(report.html).toContain(report.integrityHash);
  });

  it('HTML renders alerts table when hits are present', async () => {
    const report = await buildScreeningReport(
      baseInput({
        totalNewHits: 2,
        subjectsWithAlerts: [
          { subjectId: 'S9', subjectName: 'Suspicious Actor', newHitCount: 2, asanaGid: '12345' },
        ],
      })
    );
    expect(report.html).toContain('Suspicious Actor');
    expect(report.html).toContain('12345');
  });

  it('HTML escapes subject names to prevent XSS', async () => {
    const report = await buildScreeningReport(
      baseInput({
        subjectsClean: [{ subjectId: 'X', subjectName: '<script>alert(1)</script>' }],
      })
    );
    expect(report.html).not.toContain('<script>alert(1)</script>');
    expect(report.html).toContain('&lt;script&gt;');
  });

  it('HTML omits clean list when > 50 subjects', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      subjectId: `C${i}`,
      subjectName: `Customer ${i}`,
    }));
    const report = await buildScreeningReport(baseInput({ subjectsClean: many }));
    expect(report.html).toContain('60 subjects returned clean');
    expect(report.html).not.toContain('Customer 5 (C5)');
  });

  it('HTML includes weaponized brain verdict when provided', async () => {
    const report = await buildScreeningReport(
      baseInput({ brainVerdict: 'escalate', brainConfidence: 0.72 })
    );
    expect(report.html).toContain('escalate');
    expect(report.html).toContain('72.0%');
  });
});

describe('complianceReportBuilder — JSON canonical record', () => {
  it('JSON is valid and parses', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(() => JSON.parse(report.json)).not.toThrow();
  });

  it('JSON includes chainOfCustody with integrity hash', async () => {
    const report = await buildScreeningReport(baseInput());
    const parsed = JSON.parse(report.json);
    expect(parsed.chainOfCustody.integrityHash).toBe(report.integrityHash);
    expect(parsed.chainOfCustody.hashAlgorithm).toBe('SHA-256');
  });

  it('JSON includes regulatory basis and confidentiality notice', async () => {
    const report = await buildScreeningReport(baseInput());
    const parsed = JSON.parse(report.json);
    expect(Array.isArray(parsed.regulatoryBasis)).toBe(true);
    expect(parsed.regulatoryBasis.length).toBeGreaterThan(5);
    expect(parsed.confidentialityNotice).toContain('FDL No.10/2025 Art.29');
  });

  it('JSON totals match input', async () => {
    const report = await buildScreeningReport(
      baseInput({
        totalChecked: 25,
        totalNewHits: 3,
        subjectsWithAlerts: [
          { subjectId: 'A', subjectName: 'A', newHitCount: 2 },
          { subjectId: 'B', subjectName: 'B', newHitCount: 1 },
        ],
      })
    );
    const parsed = JSON.parse(report.json);
    expect(parsed.totals.checked).toBe(25);
    expect(parsed.totals.newHits).toBe(3);
    expect(parsed.totals.alerts).toBe(2);
  });
});

describe('complianceReportBuilder — Markdown summary', () => {
  it('Markdown contains headings and regulatory citations', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.markdown).toContain('# Sanctions & Adverse Media Screening');
    expect(report.markdown).toContain('## Regulatory framework');
    expect(report.markdown).toContain('FDL No.10/2025');
  });

  it('Markdown shows dd/mm/yyyy date', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.markdown).toContain('11/04/2026');
  });

  it('Markdown includes CONFIDENTIAL callout', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.markdown).toContain('CONFIDENTIAL');
    expect(report.markdown).toContain('FDL No.10/2025 Art.29');
  });

  it('Markdown contains the integrity hash in the chain-of-custody block', async () => {
    const report = await buildScreeningReport(baseInput());
    expect(report.markdown).toContain(report.integrityHash);
  });
});
