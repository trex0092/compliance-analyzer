/**
 * Tests for OCA-inspired reporting modules:
 *   - xlsxReportExporter    (report_xlsx analogue)
 *   - reportTemplateEngine  (base_comment_template / QWeb analogue)
 *   - scheduledComplianceReports (scheduled-actions analogue)
 */
import { describe, it, expect } from 'vitest';

import {
  exportWorkbook,
  buildScreeningWorkbook,
  type Workbook,
} from '@/services/xlsxReportExporter';
import { renderTemplate, TemplateError } from '@/services/reportTemplateEngine';
import {
  SCHEDULED_REPORTS,
  computeNextRun,
  buildRunPlan,
} from '@/services/scheduledComplianceReports';

// ---------------------------------------------------------------------------
// xlsxReportExporter
// ---------------------------------------------------------------------------

describe('xlsxReportExporter', () => {
  const wb: Workbook = {
    metadata: {
      reportTitle: 'Test Compliance Report',
      author: 'Test Runner',
      createdAt: '2026-04-11T09:00:00Z',
    },
    sheets: [
      {
        name: 'Test Sheet',
        columns: [
          { header: 'ID', key: 'id', citation: 'FATF Rec 10' },
          { header: 'Name', key: 'name' },
          { header: 'Amount AED', key: 'amount' },
        ],
        rows: [
          { id: 'C1', name: 'Clean Co', amount: 50_000 },
          { id: 'C2', name: 'Dirty Co', amount: 100_000 },
        ],
      },
    ],
  };

  it('exports SpreadsheetML 2003 XML', () => {
    const exported = exportWorkbook(wb);
    expect(exported.xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(exported.xml).toContain('urn:schemas-microsoft-com:office:spreadsheet');
    expect(exported.mimeType).toBe('application/vnd.ms-excel');
    expect(exported.filename).toMatch(/\.xml$/);
  });

  it('escapes XML special characters in cell values', () => {
    const exported = exportWorkbook({
      ...wb,
      sheets: [
        {
          name: 'Escape',
          columns: [{ header: 'name', key: 'name' }],
          rows: [{ name: '<script>alert(1)</script>' }],
        },
      ],
    });
    expect(exported.xml).not.toContain('<script>');
    expect(exported.xml).toContain('&lt;script&gt;');
  });

  it('renders header style + regulatory citation as comment', () => {
    const exported = exportWorkbook(wb);
    expect(exported.xml).toContain('ss:StyleID="Header"');
    expect(exported.xml).toContain('FATF Rec 10');
  });

  it('builds a screening workbook from run data', () => {
    const built = buildScreeningWorkbook({
      reportingEntity: 'Acme Gold LLC',
      complianceOfficer: 'Luisa',
      runAtIso: '2026-04-11T09:00:00Z',
      totalChecked: 10,
      totalNewHits: 2,
      subjectsWithAlerts: [
        { subjectId: 'S1', subjectName: 'Dirty Actor', newHitCount: 2 },
      ],
      subjectsWithErrors: [],
      subjectsClean: [{ subjectId: 'S2', subjectName: 'Clean' }],
    });
    expect(built.sheets.length).toBe(4);
    expect(built.sheets.some((s) => s.name === 'Summary')).toBe(true);
    expect(built.sheets.some((s) => s.name === 'Alerts')).toBe(true);
  });

  it('cell types are auto-detected', () => {
    const exported = exportWorkbook(wb);
    expect(exported.xml).toContain('ss:Type="Number"');
    expect(exported.xml).toContain('ss:Type="String"');
  });
});

// ---------------------------------------------------------------------------
// reportTemplateEngine
// ---------------------------------------------------------------------------

describe('reportTemplateEngine', () => {
  it('interpolates a simple variable', () => {
    const out = renderTemplate('Hello {{ name }}', { name: 'World' });
    expect(out).toBe('Hello World');
  });

  it('HTML-escapes interpolated values', () => {
    const out = renderTemplate('<p>{{ name }}</p>', { name: '<script>' });
    expect(out).toContain('&lt;script&gt;');
  });

  it('supports dot-access through objects', () => {
    const out = renderTemplate('{{ customer.name }} ({{ customer.risk.level }})', {
      customer: { name: 'Acme', risk: { level: 'high' } },
    });
    expect(out).toBe('Acme (high)');
  });

  it('supports {% if %} blocks', () => {
    const out = renderTemplate(
      '{% if escalated %}ESCALATED{% endif %}',
      { escalated: true }
    );
    expect(out).toBe('ESCALATED');
  });

  it('if block hides content when false', () => {
    const out = renderTemplate(
      'Status: {% if escalated %}ESCALATED{% endif %}',
      { escalated: false }
    );
    expect(out).toBe('Status: ');
  });

  it('supports {% for %} loops', () => {
    const out = renderTemplate(
      '{% for item in items %}[{{ item.name }}]{% endfor %}',
      { items: [{ name: 'A' }, { name: 'B' }] }
    );
    expect(out).toBe('[A][B]');
  });

  it('applies filters', () => {
    const out = renderTemplate('{{ name | upper }}', { name: 'acme' });
    expect(out).toBe('ACME');
  });

  it('chains filters', () => {
    const out = renderTemplate('{{ name | trim | upper }}', { name: '  acme  ' });
    expect(out).toBe('ACME');
  });

  it('date filter formats dd/mm/yyyy', () => {
    const out = renderTemplate('{{ d | date }}', { d: '2026-04-11T00:00:00Z' });
    expect(out).toBe('11/04/2026');
  });

  it('currency filter formats AED', () => {
    const out = renderTemplate('{{ amt | currency }}', { amt: 55000 });
    expect(out).toContain('AED');
    expect(out).toContain('55,000');
  });

  it('default filter substitutes fallback', () => {
    const out = renderTemplate('{{ missing | default N/A }}', { missing: null });
    expect(out).toBe('N/A');
  });

  it('length filter counts items', () => {
    const out = renderTemplate('{{ items | length }}', { items: [1, 2, 3] });
    expect(out).toBe('3');
  });

  it('strict mode throws on unknown variable', () => {
    expect(() => renderTemplate('{{ missing }}', {}, { strict: true })).toThrow(TemplateError);
  });

  it('non-strict mode emits empty string for unknown variable', () => {
    const out = renderTemplate('{{ missing }}', {});
    expect(out).toBe('');
  });

  it('rejects arbitrary expressions like function calls', () => {
    expect(() => renderTemplate('{{ alert(1) }}', {})).toThrow(TemplateError);
  });

  it('renders STR narrative template realistically', () => {
    const template = `
On {{ date | date }}, customer {{ customer.name }} executed
{{ count }} cash deposits of {{ amount | currency }} each.
{% if structured %}Pattern matches typology T3 structuring.{% endif %}
Filed under {{ citation }}.
`.trim();
    const out = renderTemplate(template, {
      date: '2026-03-15',
      customer: { name: 'Acme Gold LLC' },
      count: 8,
      amount: 52500,
      structured: true,
      citation: 'FDL No.10/2025 Art.26-27',
    });
    expect(out).toContain('15/03/2026');
    expect(out).toContain('Acme Gold LLC');
    expect(out).toContain('AED');
    expect(out).toContain('structuring');
    expect(out).toContain('Art.26-27');
  });
});

// ---------------------------------------------------------------------------
// scheduledComplianceReports
// ---------------------------------------------------------------------------

describe('scheduledComplianceReports', () => {
  it('ships at least 7 canonical reports', () => {
    expect(SCHEDULED_REPORTS.length).toBeGreaterThanOrEqual(7);
  });

  it('every report has a regulatory citation', () => {
    for (const r of SCHEDULED_REPORTS) {
      expect(r.citation.length).toBeGreaterThan(0);
    }
  });

  it('computeNextRun daily adds one day', () => {
    const next = computeNextRun('daily', new Date('2026-04-11T00:00:00Z'));
    expect(next.slice(0, 10)).toBe('2026-04-12');
  });

  it('computeNextRun weekly finds next Monday', () => {
    // 2026-04-11 is a Saturday → next Monday is 2026-04-13
    const next = computeNextRun('weekly', new Date('2026-04-11T00:00:00Z'));
    expect(next.slice(0, 10)).toBe('2026-04-13');
  });

  it('computeNextRun monthly rolls to first of next month', () => {
    const next = computeNextRun('monthly', new Date('2026-04-11T00:00:00Z'));
    expect(next.slice(0, 10)).toBe('2026-05-01');
  });

  it('computeNextRun quarterly rolls to next quarter start', () => {
    const next = computeNextRun('quarterly', new Date('2026-04-11T00:00:00Z'));
    expect(next.slice(0, 10)).toBe('2026-07-01');
  });

  it('computeNextRun annual rolls to Jan 1 next year', () => {
    const next = computeNextRun('annual', new Date('2026-04-11T00:00:00Z'));
    expect(next.slice(0, 10)).toBe('2027-01-01');
  });

  it('buildRunPlan flags never-run reports as overdue', () => {
    const plans = buildRunPlan({ lastRunAt: {}, now: new Date('2026-04-11T00:00:00Z') });
    expect(plans.length).toBe(SCHEDULED_REPORTS.length);
    for (const p of plans) {
      expect(p.overdueBy).toBe(Infinity);
    }
  });

  it('buildRunPlan reports no overdue when just ran', () => {
    const lastRunAt: Record<string, string> = {};
    for (const r of SCHEDULED_REPORTS) {
      lastRunAt[r.id] = '2026-04-10T00:00:00Z';
    }
    const plans = buildRunPlan({
      lastRunAt,
      now: new Date('2026-04-10T12:00:00Z'),
    });
    for (const p of plans) {
      expect(p.overdueBy).toBeUndefined();
    }
  });
});
