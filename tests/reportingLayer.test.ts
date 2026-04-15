/**
 * Reporting layer tests — audit log query + PDF audit report builder +
 * XLSX quarterly exporter.
 */
import { describe, it, expect } from 'vitest';

import {
  queryAuditLog,
  auditLogToCsv,
  __test__ as auditInternals,
  type AuditRecord,
} from '../src/services/auditLogQuery';

import {
  buildAuditReport,
  verifyAuditReportIntegrity,
  renderPdfDocumentAsText,
} from '../src/services/pdfAuditReportBuilder';

import {
  exportEvidenceBundle,
  type EvidenceBundleLoaders,
  type EvidenceBundle,
} from '../src/services/evidenceBundleExporter';

import {
  buildQuarterlyWorkbook,
  workbookToString,
  __test__ as xlsxInternals,
  type QuarterlyReportInput,
} from '../src/services/xlsxQuarterlyExporter';

// ===========================================================================
// auditLogQuery
// ===========================================================================

const sampleAuditLog: AuditRecord[] = [
  {
    id: 'a1',
    tsIso: '2026-04-10T10:00:00Z',
    tenantId: 'tenant-a',
    userId: 'mlro-1',
    event: 'skill.screen',
    detail: 'Screened customer ACME',
  },
  {
    id: 'a2',
    tsIso: '2026-04-11T10:00:00Z',
    tenantId: 'tenant-a',
    userId: 'mlro-2',
    event: 'skill.goaml',
    detail: 'Filed STR draft',
  },
  {
    id: 'a3',
    tsIso: '2026-04-12T10:00:00Z',
    tenantId: 'tenant-b',
    userId: 'mlro-1',
    event: 'skill.screen',
    detail: 'Screened customer BETA',
  },
  {
    id: 'a4',
    tsIso: '2026-04-13T10:00:00Z',
    tenantId: 'tenant-a',
    userId: 'mlro-1',
    event: 'four-eyes.approved',
    detail: 'Break-glass approved',
    meta: { caseId: 'case-1' },
  },
];

describe('queryAuditLog', () => {
  it('empty filter returns every record', () => {
    const r = queryAuditLog(sampleAuditLog, {});
    expect(r.totalMatched).toBe(4);
  });

  it('tenantId filter', () => {
    const r = queryAuditLog(sampleAuditLog, { tenantId: 'tenant-a' });
    expect(r.totalMatched).toBe(3);
  });

  it('userId filter', () => {
    const r = queryAuditLog(sampleAuditLog, { userId: 'mlro-1' });
    expect(r.totalMatched).toBe(3);
  });

  it('event prefix filter', () => {
    const r = queryAuditLog(sampleAuditLog, { eventPrefix: 'skill.' });
    expect(r.totalMatched).toBe(3);
  });

  it('detail substring filter (case-insensitive)', () => {
    const r = queryAuditLog(sampleAuditLog, { detailContains: 'acme' });
    expect(r.totalMatched).toBe(1);
  });

  it('startIso / endIso date window (inclusive start, exclusive end)', () => {
    const r = queryAuditLog(sampleAuditLog, {
      startIso: '2026-04-11T00:00:00Z',
      endIso: '2026-04-13T00:00:00Z',
    });
    expect(r.totalMatched).toBe(2);
  });

  it('metaEquals filter', () => {
    const r = queryAuditLog(sampleAuditLog, { metaEquals: { caseId: 'case-1' } });
    expect(r.totalMatched).toBe(1);
  });

  it('sort desc by tsIso (default)', () => {
    const r = queryAuditLog(sampleAuditLog, {});
    expect(r.records[0]!.id).toBe('a4');
  });

  it('sort asc by event', () => {
    const r = queryAuditLog(sampleAuditLog, {}, {
      sort: { field: 'event', direction: 'asc' },
    });
    expect(r.records[0]!.event).toBe('four-eyes.approved');
  });

  it('pagination: pageSize 2 / pageIndex 1', () => {
    const r = queryAuditLog(sampleAuditLog, {}, { pageSize: 2, pageIndex: 1 });
    expect(r.records.length).toBe(2);
    expect(r.pageCount).toBe(2);
  });

  it('pageSize capped at MAX_PAGE_SIZE', () => {
    const r = queryAuditLog(sampleAuditLog, {}, { pageSize: 10_000 });
    expect(r.pageSize).toBeLessThanOrEqual(auditInternals.MAX_PAGE_SIZE);
  });

  it('carries regulatory anchors', () => {
    const r = queryAuditLog([], {});
    expect(r.regulatory).toContain('FDL No.10/2025 Art.24');
    expect(r.regulatory).toContain('EU GDPR Art.30');
  });
});

describe('auditLogToCsv', () => {
  it('produces an RFC-4180 compliant CSV', () => {
    const csv = auditLogToCsv(sampleAuditLog);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('id,tsIso,tenantId,userId,event,detail,regulatory');
    expect(lines.length).toBe(5);
  });

  it('escapes cells with commas and quotes', () => {
    const record: AuditRecord = {
      id: 'x',
      tsIso: '2026-04-15T00:00:00Z',
      tenantId: 't',
      userId: 'u',
      event: 'e',
      detail: 'Hello, "world"',
    };
    const csv = auditLogToCsv([record]);
    expect(csv).toContain('"Hello, ""world"""');
  });
});

// ===========================================================================
// pdfAuditReportBuilder
// ===========================================================================

async function makeBundle(): Promise<EvidenceBundle> {
  const loaders: EvidenceBundleLoaders = {
    async loadReplayCase() {
      return null;
    },
    async loadTelemetryForDay() {
      return [];
    },
  };
  return exportEvidenceBundle(
    'tenant-a',
    'case-1',
    loaders,
    () => new Date('2026-04-15T04:30:00Z')
  );
}

describe('buildAuditReport', () => {
  it('produces a full document with sections', async () => {
    const bundle = await makeBundle();
    const doc = buildAuditReport(bundle, {
      recipient: 'MoE Inspector',
      operator: 'mlro-1',
      now: () => new Date('2026-04-15T05:00:00Z'),
    });
    expect(doc.sections.length).toBeGreaterThanOrEqual(4);
    expect(doc.cover['Tenant']).toBe('tenant-a');
    expect(doc.footer.integrityHashHex.length).toBe(128); // sha3-512 hex
  });

  it('integrity hash verifies on a clean document', async () => {
    const bundle = await makeBundle();
    const doc = buildAuditReport(bundle, {
      recipient: 'MoE Inspector',
      operator: 'mlro-1',
    });
    expect(verifyAuditReportIntegrity(doc)).toBe(true);
  });

  it('integrity hash fails when a field is tampered', async () => {
    const bundle = await makeBundle();
    const doc = buildAuditReport(bundle, {
      recipient: 'MoE Inspector',
      operator: 'mlro-1',
    });
    const tampered = { ...doc, title: 'TAMPERED' };
    expect(verifyAuditReportIntegrity(tampered)).toBe(false);
  });

  it('renderPdfDocumentAsText includes every cover field', async () => {
    const bundle = await makeBundle();
    const doc = buildAuditReport(bundle, { recipient: 'X', operator: 'Y' });
    const text = renderPdfDocumentAsText(doc);
    expect(text).toContain('HAWKEYE STERLING');
    expect(text).toContain('Tenant');
    expect(text).toContain('Integrity');
  });

  it('supports extraSections', async () => {
    const bundle = await makeBundle();
    const doc = buildAuditReport(bundle, {
      recipient: 'X',
      operator: 'Y',
      extraSections: [
        {
          id: 'custom',
          title: 'Custom section',
          blocks: [{ kind: 'paragraph', text: 'Custom content' }],
        },
      ],
    });
    expect(doc.sections.some((s) => s.id === 'custom')).toBe(true);
  });
});

// ===========================================================================
// xlsxQuarterlyExporter
// ===========================================================================

const sampleReport: QuarterlyReportInput = {
  tenantId: 'tenant-a',
  quarterLabel: '2026Q1',
  reportingInstitution: 'Acme Trading LLC',
  mlroName: 'Alice',
  kpis: [
    { id: 'K01', label: 'Total Decisions', value: 1240, unit: 'count', band: 'green' },
    { id: 'K02', label: 'Freeze Rate', value: 0.8, unit: 'pct', band: 'amber', note: 'Up from 0.5%' },
    { id: 'K03', label: 'Total AED Screened', value: 4_500_000, unit: 'aed', band: 'green' },
  ],
  transactions: [
    {
      txId: 'T1',
      date: '15/04/2026',
      entityRef: 'ent-1',
      amountAED: 65_000,
      verdict: 'flag',
      reportFiled: 'STR',
    },
  ],
  entities: [
    {
      entityRef: 'ent-1',
      legalName: 'Customer Inc',
      riskTier: 'CDD',
      cddReviewDueIso: '2026-07-01',
    },
  ],
};

describe('buildQuarterlyWorkbook', () => {
  it('produces 4 sheets (cover, kpi, transactions, entities)', () => {
    const wb = buildQuarterlyWorkbook(sampleReport);
    expect(wb.sheets.map((s) => s.name)).toEqual(['cover', 'kpi', 'transactions', 'entities']);
  });

  it('kpi sheet respects the KPI unit formatter', () => {
    const wb = buildQuarterlyWorkbook(sampleReport);
    const kpi = wb.sheets.find((s) => s.name === 'kpi')!;
    expect(kpi.csv).toContain('1,240');
    expect(kpi.csv).toContain('0.80%');
    expect(kpi.csv).toContain('AED');
  });

  it('cover sheet carries institution + MLRO + framework anchor', () => {
    const wb = buildQuarterlyWorkbook(sampleReport);
    const cover = wb.sheets.find((s) => s.name === 'cover')!;
    expect(cover.csv).toContain('Acme Trading LLC');
    expect(cover.csv).toContain('Alice');
    expect(cover.csv).toContain('08/AML/2021');
  });

  it('rejects invalid quarter label', () => {
    expect(() =>
      buildQuarterlyWorkbook({ ...sampleReport, quarterLabel: '2026-Q1' })
    ).toThrow();
  });

  it('rejects missing required field', () => {
    expect(() =>
      buildQuarterlyWorkbook({ ...sampleReport, mlroName: '' })
    ).toThrow();
  });

  it('workbookToString returns a single-document form', () => {
    const wb = buildQuarterlyWorkbook(sampleReport);
    const text = workbookToString(wb);
    expect(text).toContain('cover');
    expect(text).toContain('kpi');
    expect(text).toContain('transactions');
    expect(text).toContain('entities');
  });

  it('carries regulatory anchors', () => {
    const wb = buildQuarterlyWorkbook(sampleReport);
    expect(wb.regulatory).toContain('MoE Circular 08/AML/2021');
    expect(wb.regulatory).toContain('FATF Rec 22');
    expect(wb.regulatory).toContain('FATF Rec 23');
  });

  it('CSV helpers escape cells correctly', () => {
    expect(xlsxInternals.escapeCsvCell('hello, world')).toBe('"hello, world"');
    expect(xlsxInternals.escapeCsvCell('with "quotes"')).toBe('"with ""quotes"""');
  });
});
