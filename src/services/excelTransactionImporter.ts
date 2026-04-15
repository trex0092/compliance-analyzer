/**
 * Excel Transaction Importer — accepts CSV / TSV / pipe-delimited
 * transaction sheets exported from Excel and normalises them into
 * `TransactionRow[]` the brain can consume (graph risk scorer, case
 * clusterer, velocity detector, synthetic batch brain runner).
 *
 * Why this exists:
 *   Operators already live in Excel. Excel exports transactions as
 *   CSV/TSV — real `.xlsx` binary is rarely used for data transfer.
 *   This module is the first-party importer for the transaction
 *   shape the brain expects.
 *
 *   Pure function. No I/O, no xlsx library dependency. Same input
 *   → same result.
 *
 *   Schema (required columns, case-insensitive):
 *     txId,date,fromEntityRef,toEntityRef,amountAED,currency,channel
 *
 *   Optional columns: countryFrom, countryTo, reference, notes.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.16       (transaction records)
 *   FDL No.10/2025 Art.20-22    (CO visibility)
 *   FDL No.10/2025 Art.24       (retention)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   MoE Circular 08/AML/2021    (DPMS transaction records)
 *   FATF Rec 11                 (record keeping + analysis)
 *   FATF Rec 20                 (suspicious transactions)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TransactionRow {
  txId: string;
  date: string; // ISO YYYY-MM-DD
  fromEntityRef: string;
  toEntityRef: string;
  amountAED: number;
  currency: string;
  channel: 'cash' | 'wire' | 'card' | 'crypto' | 'other';
  countryFrom?: string;
  countryTo?: string;
  reference?: string;
  notes?: string;
}

export interface TransactionImportError {
  rowNumber: number;
  reason: string;
  rawValues: Readonly<Record<string, string>>;
}

export interface TransactionImportReport {
  schemaVersion: 1;
  tenantId: string;
  delimiter: ',' | '\t' | '|';
  totalRowsObserved: number;
  totalAccepted: number;
  totalRejected: number;
  rows: readonly TransactionRow[];
  errors: readonly TransactionImportError[];
  warnings: readonly string[];
  summary: string;
  regulatory: readonly string[];
}

export const MAX_TX_ROWS = 250_000;
const REQUIRED = ['txid', 'date', 'fromentityref', 'toentityref', 'amountaed', 'currency', 'channel'];

// ---------------------------------------------------------------------------
// Delimiter detection + minimal parser
// ---------------------------------------------------------------------------

function detectDelimiter(line: string): ',' | '\t' | '|' {
  const tabs = (line.match(/\t/g) ?? []).length;
  const pipes = (line.match(/\|/g) ?? []).length;
  const commas = (line.match(/,/g) ?? []).length;
  if (tabs >= commas && tabs >= pipes) return '\t';
  if (pipes >= commas) return '|';
  return ',';
}

function parseDelimited(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delim) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;
const VALID_CHANNELS = new Set(['cash', 'wire', 'card', 'crypto', 'other']);

function parseAmount(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,_\s]/g, '');
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  return n;
}

function validateRow(
  rowNumber: number,
  values: Readonly<Record<string, string>>
): { ok: true; row: TransactionRow } | { ok: false; reason: string } {
  const txId = values.txid ?? '';
  if (!txId || !ID_RE.test(txId)) return { ok: false, reason: `txId missing or invalid (${txId})` };

  const date = (values.date ?? '').trim();
  if (!DATE_RE.test(date)) return { ok: false, reason: `date must be YYYY-MM-DD (${date})` };

  const fromEntityRef = values.fromentityref ?? '';
  const toEntityRef = values.toentityref ?? '';
  if (!ID_RE.test(fromEntityRef)) return { ok: false, reason: `fromEntityRef invalid` };
  if (!ID_RE.test(toEntityRef)) return { ok: false, reason: `toEntityRef invalid` };

  const amountAED = parseAmount(values.amountaed ?? '');
  if (amountAED === null || amountAED < 0) {
    return { ok: false, reason: `amountAED invalid` };
  }

  const currency = (values.currency ?? '').toUpperCase();
  if (!CURRENCY_RE.test(currency)) return { ok: false, reason: `currency must be ISO 4217 (${currency})` };

  const channelRaw = (values.channel ?? '').toLowerCase();
  if (!VALID_CHANNELS.has(channelRaw)) {
    return { ok: false, reason: `channel must be one of cash|wire|card|crypto|other` };
  }
  const channel = channelRaw as TransactionRow['channel'];

  // Optional fields.
  const countryFrom = (values.countryfrom ?? '').toUpperCase() || undefined;
  if (countryFrom && !COUNTRY_RE.test(countryFrom)) {
    return { ok: false, reason: `countryFrom must be ISO 3166-1 alpha-2` };
  }
  const countryTo = (values.countryto ?? '').toUpperCase() || undefined;
  if (countryTo && !COUNTRY_RE.test(countryTo)) {
    return { ok: false, reason: `countryTo must be ISO 3166-1 alpha-2` };
  }

  void rowNumber;
  return {
    ok: true,
    row: {
      txId,
      date,
      fromEntityRef,
      toEntityRef,
      amountAED,
      currency,
      channel,
      ...(countryFrom ? { countryFrom } : {}),
      ...(countryTo ? { countryTo } : {}),
      ...(values.reference ? { reference: values.reference } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ImportOptions {
  tenantId: string;
  maxRows?: number;
}

export function importTransactionSheet(
  raw: string,
  opts: ImportOptions
): TransactionImportReport {
  const warnings: string[] = [];
  if (!raw || raw.trim().length === 0) {
    return {
      schemaVersion: 1,
      tenantId: opts.tenantId,
      delimiter: ',',
      totalRowsObserved: 0,
      totalAccepted: 0,
      totalRejected: 0,
      rows: [],
      errors: [],
      warnings: ['Empty input'],
      summary: 'Empty input — nothing to import.',
      regulatory: ['FDL No.10/2025 Art.16'],
    };
  }

  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return {
      schemaVersion: 1,
      tenantId: opts.tenantId,
      delimiter: ',',
      totalRowsObserved: 0,
      totalAccepted: 0,
      totalRejected: 0,
      rows: [],
      errors: [],
      warnings: ['Only a header row present'],
      summary: 'No data rows.',
      regulatory: ['FDL No.10/2025 Art.16'],
    };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const header = parseDelimited(lines[0]!, delimiter).map((h) => h.toLowerCase());
  const missing = REQUIRED.filter((r) => !header.includes(r));
  if (missing.length > 0) {
    return {
      schemaVersion: 1,
      tenantId: opts.tenantId,
      delimiter,
      totalRowsObserved: 0,
      totalAccepted: 0,
      totalRejected: 0,
      rows: [],
      errors: [],
      warnings: [],
      summary: `Missing required columns: ${missing.join(', ')}`,
      regulatory: ['FDL No.10/2025 Art.16'],
    };
  }

  const rows: TransactionRow[] = [];
  const errors: TransactionImportError[] = [];
  const maxRows = opts.maxRows ?? MAX_TX_ROWS;
  let observed = 0;

  for (let i = 1; i < lines.length; i++) {
    if (rows.length >= maxRows) {
      warnings.push(`Truncated at ${maxRows} rows — ${lines.length - 1 - i + 1} more skipped`);
      break;
    }
    observed += 1;
    const fields = parseDelimited(lines[i]!, delimiter);
    const values: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      values[header[j]!] = fields[j] ?? '';
    }
    const result = validateRow(i + 1, values);
    if (result.ok) rows.push(result.row);
    else errors.push({ rowNumber: i + 1, reason: result.reason, rawValues: values });
  }

  return {
    schemaVersion: 1,
    tenantId: opts.tenantId,
    delimiter,
    totalRowsObserved: observed,
    totalAccepted: rows.length,
    totalRejected: errors.length,
    rows,
    errors,
    warnings,
    summary:
      errors.length === 0
        ? `Imported ${rows.length} transaction(s) for ${opts.tenantId}. ${warnings.length} warning(s).`
        : `Imported ${rows.length} transaction(s) for ${opts.tenantId}. ${errors.length} row(s) rejected.`,
    regulatory: [
      'FDL No.10/2025 Art.16',
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'MoE Circular 08/AML/2021',
      'FATF Rec 11',
      'FATF Rec 20',
    ],
  };
}

// Exports for tests.
export const __test__ = { detectDelimiter, parseDelimited, parseAmount, validateRow };
