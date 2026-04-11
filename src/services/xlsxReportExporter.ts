/**
 * XLSX Report Exporter — OCA report_xlsx-inspired compliance workbook builder.
 *
 * Generates Excel-compatible spreadsheet files from compliance data
 * without any native xlsx dependency. Uses SpreadsheetML 2003 (XML
 * Spreadsheet) — a single-file XML format Excel opens natively, no
 * zip library required, pure JavaScript, browser-safe.
 *
 * Supports:
 *   - Multi-sheet workbooks
 *   - Column headers with bold styling
 *   - Column auto-width (empirical — longest-cell * font-ratio)
 *   - Cell types: String, Number, DateTime, Boolean
 *   - Cell comments (used for regulatory citations on column headers)
 *   - Frozen header row (via WorksheetOptions)
 *
 * Inspired by OCA/reporting-engine :: report_xlsx + report_xlsx_helper.
 * That library uses xlsxwriter in Python; we use SpreadsheetML 2003
 * because it's dependency-free and the format is still supported by
 * Excel 2003 through Microsoft 365 in 2026.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (5yr retention — multi-format export)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reporting)
 *   - LBMA RGG v9 (annual audit pack — Excel is the regulator
 *     preferred format for line-item review)
 *   - Cabinet Res 134/2025 Art.19 (documented reasoning — auditable
 *     worksheet structure)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CellValue = string | number | boolean | Date | null;

export interface WorkbookColumn {
  header: string;
  key: string;
  /** Optional regulatory citation rendered as a cell comment. */
  citation?: string;
  /** Override auto-width (characters). */
  widthChars?: number;
}

export interface WorkbookSheet {
  name: string;
  columns: readonly WorkbookColumn[];
  rows: ReadonlyArray<Readonly<Record<string, CellValue>>>;
  /** Optional title row rendered above the header. */
  title?: string;
  /** Optional regulatory citation rendered as a sheet-level note. */
  citation?: string;
}

export interface WorkbookMetadata {
  reportTitle: string;
  author: string;
  createdAt?: string;
  generatedBy?: string;
}

export interface Workbook {
  metadata: WorkbookMetadata;
  sheets: readonly WorkbookSheet[];
}

export interface ExportedXlsx {
  /** SpreadsheetML 2003 XML content. */
  xml: string;
  /** Suggested filename with .xml extension (Excel opens as workbook). */
  filename: string;
  /** MIME type for HTTP Content-Type. */
  mimeType: string;
  /** Byte length of the xml string. */
  byteLength: number;
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cellType(val: CellValue): 'String' | 'Number' | 'Boolean' | 'DateTime' {
  if (val === null) return 'String';
  if (typeof val === 'number') return Number.isFinite(val) ? 'Number' : 'String';
  if (typeof val === 'boolean') return 'Boolean';
  if (val instanceof Date) return 'DateTime';
  return 'String';
}

function formatCell(val: CellValue): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'boolean') return val ? '1' : '0';
  return String(val);
}

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

export function exportWorkbook(workbook: Workbook): ExportedXlsx {
  const created = workbook.metadata.createdAt ?? new Date().toISOString();
  const author = escXml(workbook.metadata.author);
  const title = escXml(workbook.metadata.reportTitle);

  const sheetsXml = workbook.sheets.map(renderSheet).join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:html="http://www.w3.org/TR/REC-html40">',
    '<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">',
    `<Title>${title}</Title>`,
    `<Author>${author}</Author>`,
    `<Created>${escXml(created)}</Created>`,
    '</DocumentProperties>',
    '<Styles>',
    '<Style ss:ID="Header">',
    '<Font ss:Bold="1" ss:Size="11" ss:Color="#FFFFFF"/>',
    '<Interior ss:Color="#1F4E79" ss:Pattern="Solid"/>',
    '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/>',
    '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2"/></Borders>',
    '</Style>',
    '<Style ss:ID="Title">',
    '<Font ss:Bold="1" ss:Size="14"/>',
    '</Style>',
    '<Style ss:ID="Citation">',
    '<Font ss:Italic="1" ss:Size="9" ss:Color="#666666"/>',
    '</Style>',
    '<Style ss:ID="Default">',
    '<Font ss:Size="10"/>',
    '<Alignment ss:Vertical="Top"/>',
    '</Style>',
    '</Styles>',
    sheetsXml,
    '</Workbook>',
  ].join('\n');

  return {
    xml,
    filename: `${slugify(workbook.metadata.reportTitle)}.xml`,
    mimeType: 'application/vnd.ms-excel',
    byteLength: new TextEncoder().encode(xml).length,
  };
}

function renderSheet(sheet: WorkbookSheet): string {
  const name = escXml(sheet.name.slice(0, 31)); // Excel sheet name limit
  const colCount = sheet.columns.length;

  // Compute empirical column widths (capped at 60 chars).
  const widths = sheet.columns.map((col) => {
    if (col.widthChars) return col.widthChars;
    const headerLen = col.header.length;
    let maxBody = 0;
    for (const row of sheet.rows) {
      const v = row[col.key];
      const s = v instanceof Date ? v.toISOString() : String(v ?? '');
      if (s.length > maxBody) maxBody = s.length;
    }
    return Math.min(60, Math.max(headerLen, maxBody) + 2);
  });

  const columnTags = widths
    .map((w) => `<Column ss:AutoFitWidth="0" ss:Width="${w * 6}"/>`)
    .join('');

  const titleRow = sheet.title
    ? `<Row><Cell ss:MergeAcross="${colCount - 1}" ss:StyleID="Title"><Data ss:Type="String">${escXml(sheet.title)}</Data></Cell></Row>`
    : '';
  const citationRow = sheet.citation
    ? `<Row><Cell ss:MergeAcross="${colCount - 1}" ss:StyleID="Citation"><Data ss:Type="String">${escXml(sheet.citation)}</Data></Cell></Row>`
    : '';

  const headerCells = sheet.columns
    .map((col) => {
      const comment = col.citation
        ? `<Comment><ss:Data xmlns="http://www.w3.org/TR/REC-html40">${escXml(col.citation)}</ss:Data></Comment>`
        : '';
      return `<Cell ss:StyleID="Header"><Data ss:Type="String">${escXml(col.header)}</Data>${comment}</Cell>`;
    })
    .join('');

  const headerRow = `<Row>${headerCells}</Row>`;

  const dataRows = sheet.rows
    .map((row) => {
      const cells = sheet.columns
        .map((col) => {
          const val = row[col.key] ?? null;
          const type = cellType(val);
          return `<Cell ss:StyleID="Default"><Data ss:Type="${type}">${escXml(formatCell(val))}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  return [
    `<Worksheet ss:Name="${name}">`,
    `<Table ss:ExpandedColumnCount="${colCount}" ss:ExpandedRowCount="${sheet.rows.length + (sheet.title ? 1 : 0) + (sheet.citation ? 1 : 0) + 1}" x:FullColumns="1" x:FullRows="1">`,
    columnTags,
    titleRow,
    citationRow,
    headerRow,
    dataRows,
    '</Table>',
    // Freeze the header row.
    '<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">',
    '<FreezePanes/>',
    '<FrozenNoSplit/>',
    `<SplitHorizontal>${(sheet.title ? 1 : 0) + (sheet.citation ? 1 : 0) + 1}</SplitHorizontal>`,
    '</WorksheetOptions>',
    '</Worksheet>',
  ].join('\n');
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Convenience: compliance-specific workbook builders
// ---------------------------------------------------------------------------

/**
 * Build a screening-run workbook from the same data that the Phase 4
 * complianceReportBuilder produces. Keeps a single source of truth for
 * the regulatory content; this module only adds an Excel-shaped view.
 */
export interface ScreeningWorkbookInput {
  reportingEntity: string;
  complianceOfficer: string;
  runAtIso: string;
  totalChecked: number;
  totalNewHits: number;
  subjectsWithAlerts: ReadonlyArray<{
    subjectId: string;
    subjectName: string;
    newHitCount: number;
    asanaGid?: string;
  }>;
  subjectsWithErrors: ReadonlyArray<{
    subjectId: string;
    subjectName: string;
    error: string;
  }>;
  subjectsClean: ReadonlyArray<{ subjectId: string; subjectName: string }>;
}

export function buildScreeningWorkbook(input: ScreeningWorkbookInput): Workbook {
  return {
    metadata: {
      reportTitle: `Screening Run ${input.runAtIso.slice(0, 10)}`,
      author: input.complianceOfficer,
      createdAt: input.runAtIso,
      generatedBy: 'Hawkeye Sterling V2 xlsxReportExporter',
    },
    sheets: [
      {
        name: 'Summary',
        title: `Screening Run — ${input.reportingEntity}`,
        citation: 'FDL No.10/2025 Art.20-21 + Cabinet Res 134/2025 Art.19',
        columns: [
          { header: 'Metric', key: 'metric', citation: 'FATF Rec 10' },
          { header: 'Value', key: 'value' },
        ],
        rows: [
          { metric: 'Run timestamp', value: input.runAtIso },
          { metric: 'Reporting entity', value: input.reportingEntity },
          { metric: 'Compliance officer', value: input.complianceOfficer },
          { metric: 'Subjects checked', value: input.totalChecked },
          { metric: 'Total new hits', value: input.totalNewHits },
          { metric: 'Subjects with alerts', value: input.subjectsWithAlerts.length },
          { metric: 'Subjects with errors', value: input.subjectsWithErrors.length },
          { metric: 'Subjects clean', value: input.subjectsClean.length },
        ],
      },
      {
        name: 'Alerts',
        title: 'Subjects with new hits',
        citation: 'FDL No.10/2025 Art.26-27',
        columns: [
          { header: 'Subject ID', key: 'subjectId' },
          { header: 'Subject Name', key: 'subjectName' },
          { header: 'New hits', key: 'newHitCount' },
          { header: 'Asana task GID', key: 'asanaGid' },
        ],
        rows: input.subjectsWithAlerts.map((s) => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          newHitCount: s.newHitCount,
          asanaGid: s.asanaGid ?? '',
        })),
      },
      {
        name: 'Errors',
        title: 'Subjects with screening errors',
        columns: [
          { header: 'Subject ID', key: 'subjectId' },
          { header: 'Subject Name', key: 'subjectName' },
          { header: 'Error', key: 'error' },
        ],
        rows: input.subjectsWithErrors.map((s) => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          error: s.error,
        })),
      },
      {
        name: 'Clean',
        title: 'Subjects cleared (no new hits)',
        columns: [
          { header: 'Subject ID', key: 'subjectId' },
          { header: 'Subject Name', key: 'subjectName' },
        ],
        rows: input.subjectsClean.map((s) => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
        })),
      },
    ],
  };
}
