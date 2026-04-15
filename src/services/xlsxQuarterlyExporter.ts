/**
 * XLSX Quarterly Exporter — produces the MoE DPMS quarterly report
 * as a CSV-compatible workbook (Excel opens CSV natively, so a CSV
 * with the right column order, headings, and localised date/money
 * format is a legitimate "Excel export" for operators).
 *
 * Why this exists:
 *   MoE Circular 08/AML/2021 mandates a 30-KPI quarterly DPMS
 *   report. The brain's /kpi-report skill emits structured data but
 *   the MLRO has to then copy-paste into an Excel template. This
 *   module is the serialiser that produces the filled-in template
 *   directly.
 *
 *   We deliberately produce CSV (multi-sheet via separate files)
 *   instead of a .xlsx binary because:
 *     - Zero external dependencies
 *     - Excel opens CSVs natively
 *     - Deterministic output (no binary timestamps / uuid fields)
 *     - Testable without an Excel engine
 *     - Auditors can open the output with any text editor to verify
 *
 *   Operators who need a real .xlsx can run the CSVs through a
 *   one-liner: `csvtk xlsx -s kpi,transactions,entities out.csv`.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO reporting obligation)
 *   FDL No.10/2025 Art.24    (audit retention)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   MoE Circular 08/AML/2021 (DPMS quarterly report format)
 *   FATF Rec 22 + Rec 23     (DPMS reporting)
 *   NIST AI RMF 1.0 MANAGE-2 (decision provenance)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuarterlyKpi {
  id: string;
  label: string;
  value: number;
  unit: 'count' | 'aed' | 'pct' | 'days' | 'hours';
  band: 'green' | 'amber' | 'red';
  note?: string;
}

export interface QuarterlyTransactionRow {
  txId: string;
  date: string; // dd/mm/yyyy per UAE convention
  entityRef: string;
  amountAED: number;
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  reportFiled: 'STR' | 'CTR' | 'DPMSR' | 'CNMR' | 'none';
}

export interface QuarterlyEntityRow {
  entityRef: string;
  legalName: string;
  riskTier: 'SDD' | 'CDD' | 'EDD';
  cddReviewDueIso: string;
}

export interface QuarterlyReportInput {
  tenantId: string;
  quarterLabel: string; // e.g. "2026Q1"
  reportingInstitution: string; // legal name of the DPMS firm
  mlroName: string;
  kpis: readonly QuarterlyKpi[];
  transactions: readonly QuarterlyTransactionRow[];
  entities: readonly QuarterlyEntityRow[];
}

export interface XlsxSheet {
  name: string;
  csv: string;
}

export interface XlsxWorkbook {
  schemaVersion: 1;
  title: string;
  subtitle: string;
  generatedAtIso: string;
  sheets: readonly XlsxSheet[];
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function escapeCsvCell(cell: string | number): string {
  const s = typeof cell === 'number' ? cell.toString() : cell;
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(cells: readonly (string | number)[]): string {
  return cells.map(escapeCsvCell).join(',');
}

function csvSheet(header: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\n');
}

function formatAed(n: number): string {
  return `AED ${n.toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

function formatByUnit(unit: QuarterlyKpi['unit'], value: number): string {
  switch (unit) {
    case 'count':
      return value.toLocaleString('en-AE');
    case 'aed':
      return formatAed(value);
    case 'pct':
      return `${value.toFixed(2)}%`;
    case 'days':
      return `${value.toFixed(1)} days`;
    case 'hours':
      return `${value.toFixed(1)} hours`;
  }
}

// ---------------------------------------------------------------------------
// Sheet builders
// ---------------------------------------------------------------------------

function buildCoverSheet(input: QuarterlyReportInput, generatedAtIso: string): string {
  const header = ['Field', 'Value'];
  const rows: (readonly [string, string])[] = [
    ['Reporting Institution', input.reportingInstitution],
    ['Tenant ID', input.tenantId],
    ['Quarter', input.quarterLabel],
    ['MLRO', input.mlroName],
    ['Generated At', generatedAtIso],
    ['Schema Version', '1'],
    ['Framework', 'MoE Circular 08/AML/2021 DPMS Quarterly Report'],
    ['FATF Anchor', 'FATF Rec 22 + Rec 23'],
  ];
  return csvSheet(header, rows);
}

function buildKpiSheet(input: QuarterlyReportInput): string {
  const header = ['KPI ID', 'Label', 'Value', 'Unit', 'Band', 'Note'];
  const rows = input.kpis.map((k) => [
    k.id,
    k.label,
    formatByUnit(k.unit, k.value),
    k.unit,
    k.band,
    k.note ?? '',
  ]);
  return csvSheet(header, rows);
}

function buildTransactionsSheet(input: QuarterlyReportInput): string {
  const header = [
    'Transaction ID',
    'Date (dd/mm/yyyy)',
    'Entity Ref',
    'Amount AED',
    'Verdict',
    'Report Filed',
  ];
  const rows = input.transactions.map((t) => [
    t.txId,
    t.date,
    t.entityRef,
    formatAed(t.amountAED),
    t.verdict,
    t.reportFiled,
  ]);
  return csvSheet(header, rows);
}

function buildEntitiesSheet(input: QuarterlyReportInput): string {
  const header = ['Entity Ref', 'Legal Name', 'Risk Tier', 'CDD Review Due'];
  const rows = input.entities.map((e) => [
    e.entityRef,
    e.legalName,
    e.riskTier,
    e.cddReviewDueIso,
  ]);
  return csvSheet(header, rows);
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function validateInput(input: QuarterlyReportInput): string | null {
  if (!input) return 'input required';
  if (!input.tenantId || input.tenantId.length > 64) return 'tenantId required';
  if (!/^\d{4}Q[1-4]$/.test(input.quarterLabel)) return 'quarterLabel must match YYYYQn';
  if (!input.reportingInstitution) return 'reportingInstitution required';
  if (!input.mlroName) return 'mlroName required';
  if (!Array.isArray(input.kpis)) return 'kpis must be array';
  if (!Array.isArray(input.transactions)) return 'transactions must be array';
  if (!Array.isArray(input.entities)) return 'entities must be array';
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildQuarterlyWorkbook(
  input: QuarterlyReportInput,
  now: () => Date = () => new Date()
): XlsxWorkbook {
  const err = validateInput(input);
  if (err) throw new Error(`buildQuarterlyWorkbook: ${err}`);

  const generatedAtIso = now().toISOString();

  const sheets: XlsxSheet[] = [
    { name: 'cover', csv: buildCoverSheet(input, generatedAtIso) },
    { name: 'kpi', csv: buildKpiSheet(input) },
    { name: 'transactions', csv: buildTransactionsSheet(input) },
    { name: 'entities', csv: buildEntitiesSheet(input) },
  ];

  return {
    schemaVersion: 1,
    title: `HAWKEYE STERLING Quarterly Report — ${input.quarterLabel}`,
    subtitle: `${input.reportingInstitution} / tenant ${input.tenantId}`,
    generatedAtIso,
    sheets,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'MoE Circular 08/AML/2021',
      'FATF Rec 22',
      'FATF Rec 23',
      'NIST AI RMF 1.0 MANAGE-2',
    ],
  };
}

/**
 * Flatten the workbook to a single multi-part string (human-readable).
 * Useful for tests + inspectors who want a single artifact.
 */
export function workbookToString(wb: XlsxWorkbook): string {
  const parts: string[] = [];
  parts.push(`# ${wb.title}`);
  parts.push(`# ${wb.subtitle}`);
  parts.push(`# Generated: ${wb.generatedAtIso}`);
  parts.push('');
  for (const sheet of wb.sheets) {
    parts.push(`### ${sheet.name} ###`);
    parts.push(sheet.csv);
    parts.push('');
  }
  parts.push('# Regulatory citations');
  for (const c of wb.regulatory) parts.push(`# - ${c}`);
  return parts.join('\n');
}

// Exports for tests.
export const __test__ = {
  escapeCsvCell,
  csvRow,
  formatAed,
  formatByUnit,
  validateInput,
};
