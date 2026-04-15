/**
 * CSV Cohort Importer — pure CSV parser + row validator + transformer
 * that turns an operator-supplied customer CSV into the
 * `CohortCustomer[]` shape the sanctions delta cohort screener
 * consumes.
 *
 * Why this exists:
 *   The sanctions-delta-screen-cron already loads a cohort from
 *   `sanctions-cohort/<tenantId>/cohort.json`. But that JSON has to
 *   come from somewhere — today an operator would hand-write it.
 *   Customer cohorts are 1k-50k rows — hand-writing JSON is not
 *   realistic.
 *
 *   This module is the first-party importer. It accepts raw CSV
 *   text, parses it with a deliberately minimal but RFC-4180-aware
 *   parser (quoted fields, embedded commas, doubled quotes inside
 *   quoted fields, CRLF / LF line endings), validates every row,
 *   emits per-row errors without failing the whole import.
 *
 *   Pure function. No I/O. No Netlify Blob calls. The cron / UI layer
 *   takes the result and writes it to the blob store.
 *
 *   Strict column schema:
 *     id,name,tenantId,aliases,dateOfBirth,nationality,lastScreenedAtIso
 *
 *   Required: id, name, tenantId. Everything else optional.
 *   Aliases is a semicolon-separated list within the field.
 *
 * Safety invariants:
 *   1. Rows with invalid id / name / tenantId are REJECTED per-row
 *      but do not fail the whole import (report the errors, keep
 *      the good rows).
 *   2. Rows with an invalid tenantId (wrong tenant) are REJECTED —
 *      we never silently import cross-tenant data.
 *   3. Header detection is case-insensitive but value processing is
 *      case-preserving.
 *   4. Cohort size is bounded at MAX_COHORT_SIZE (default 100k).
 *      Beyond this the importer truncates with a warning — MLROs
 *      need to know they're operating on a partial import.
 *   5. Every row carries a `rowNumber` (1-indexed, header is row 1)
 *      so operators can fix errors in the source CSV directly.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD data — imported cleanly)
 *   FDL No.10/2025 Art.20-22 (CO visibility of every cohort change)
 *   FDL No.10/2025 Art.24    (audit trail of every import)
 *   Cabinet Res 134/2025 Art.7-10 (CDD tier data)
 *   Cabinet Res 134/2025 Art.19 (internal review of imports)
 *   FATF Rec 10              (CDD)
 *   FATF Rec 22              (DPMS CDD)
 *   EU GDPR Art.25           (data minimisation — only importable
 *                              fields are those the brain uses)
 */

import type { CohortCustomer } from './sanctionsDeltaCohortScreener';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportRowError {
  rowNumber: number;
  reason: string;
  rawValues: Readonly<Record<string, string>>;
}

export interface CsvImportReport {
  schemaVersion: 1;
  /** Target tenant id — rows with any other tenantId are rejected. */
  targetTenantId: string;
  /** Successfully validated + transformed rows. */
  customers: readonly CohortCustomer[];
  /** Per-row rejection log. */
  errors: readonly ImportRowError[];
  /** Warnings (e.g. truncation, missing optional columns). */
  warnings: readonly string[];
  /** Rows observed (excluding header). */
  totalRowsObserved: number;
  /** Rows accepted. */
  totalRowsAccepted: number;
  /** Rows rejected. */
  totalRowsRejected: number;
  /** Plain-English summary. */
  summary: string;
  /** Regulatory anchors. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_COHORT_SIZE = 100_000;
const REQUIRED_COLUMNS = ['id', 'name', 'tenantId'] as const;
const SUPPORTED_COLUMNS = [
  'id',
  'name',
  'tenantId',
  'aliases',
  'dateOfBirth',
  'nationality',
  'lastScreenedAtIso',
] as const;

// ---------------------------------------------------------------------------
// Minimal RFC-4180 parser
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV row. Handles quoted fields, embedded commas,
 * doubled quotes inside quoted fields. Returns fields in order.
 */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        // Escaped double quote inside quoted field.
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

/**
 * Split a CSV string into non-empty rows. Handles CRLF and LF.
 * Does NOT split on newlines inside quoted fields — state-machine
 * aware.
 */
function splitCsvRows(raw: string): string[] {
  const rows: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') {
      if (inQuotes && raw[i + 1] === '"') {
        cur += '""';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && raw[i + 1] === '\n') i += 1; // CRLF
      if (cur.length > 0) rows.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) rows.push(cur);
  return rows;
}

// ---------------------------------------------------------------------------
// Row validators
// ---------------------------------------------------------------------------

const ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_COUNTRY_RE = /^[A-Z]{2}$/;

function validateRow(
  rowNumber: number,
  values: Readonly<Record<string, string>>,
  targetTenantId: string
): { ok: true; customer: CohortCustomer } | { ok: false; reason: string } {
  const id = values.id ?? '';
  const name = values.name ?? '';
  const tenantId = values.tenantId ?? '';

  if (!id || !ID_RE.test(id)) {
    return { ok: false, reason: `id missing or invalid shape (got "${id}")` };
  }
  if (!name || name.length > 256) {
    return { ok: false, reason: `name missing or too long (${name.length})` };
  }
  if (!tenantId || tenantId.length > 64) {
    return { ok: false, reason: `tenantId missing or too long` };
  }
  if (tenantId !== targetTenantId) {
    return {
      ok: false,
      reason: `tenantId mismatch — row has "${tenantId}" but import target is "${targetTenantId}"`,
    };
  }

  const aliases = values.aliases
    ? values.aliases
        .split(';')
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a.length <= 256)
    : undefined;
  if (aliases && aliases.length > 20) {
    return { ok: false, reason: `too many aliases (${aliases.length} > 20)` };
  }

  const dateOfBirth = values.dateOfBirth?.trim();
  if (dateOfBirth && !DATE_RE.test(dateOfBirth)) {
    return {
      ok: false,
      reason: `dateOfBirth must be YYYY-MM-DD (got "${dateOfBirth}")`,
    };
  }

  const nationality = values.nationality?.trim();
  if (nationality && !ISO_COUNTRY_RE.test(nationality.toUpperCase())) {
    return {
      ok: false,
      reason: `nationality must be ISO 3166-1 alpha-2 (got "${nationality}")`,
    };
  }

  const lastScreenedAtIso = values.lastScreenedAtIso?.trim();
  if (lastScreenedAtIso && isNaN(Date.parse(lastScreenedAtIso))) {
    return {
      ok: false,
      reason: `lastScreenedAtIso must be a valid ISO date`,
    };
  }

  // row {rowNumber} is valid — ignore the param at runtime but keep
  // the signature for future audit extensions.
  void rowNumber;
  return {
    ok: true,
    customer: {
      id,
      name,
      tenantId,
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
      ...(dateOfBirth ? { dateOfBirth } : {}),
      ...(nationality ? { nationality: nationality.toUpperCase() } : {}),
      ...(lastScreenedAtIso ? { lastScreenedAtIso } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ImportOptions {
  /** Tenant id the import is scoped to — rejects cross-tenant rows. */
  targetTenantId: string;
  /** Override MAX_COHORT_SIZE. */
  maxRows?: number;
}

export function importCohortCsv(rawCsv: string, opts: ImportOptions): CsvImportReport {
  const maxRows = opts.maxRows ?? MAX_COHORT_SIZE;
  const warnings: string[] = [];

  if (typeof rawCsv !== 'string' || rawCsv.length === 0) {
    return {
      schemaVersion: 1,
      targetTenantId: opts.targetTenantId,
      customers: [],
      errors: [],
      warnings: ['Empty CSV payload'],
      totalRowsObserved: 0,
      totalRowsAccepted: 0,
      totalRowsRejected: 0,
      summary: 'Empty CSV payload — nothing to import.',
      regulatory: ['FDL No.10/2025 Art.12-14'],
    };
  }

  const rows = splitCsvRows(rawCsv);
  if (rows.length === 0) {
    return {
      schemaVersion: 1,
      targetTenantId: opts.targetTenantId,
      customers: [],
      errors: [],
      warnings: ['CSV contained no rows after stripping blank lines'],
      totalRowsObserved: 0,
      totalRowsAccepted: 0,
      totalRowsRejected: 0,
      summary: 'CSV contained no rows.',
      regulatory: ['FDL No.10/2025 Art.12-14'],
    };
  }

  // Parse header.
  const headerFields = parseCsvRow(rows[0]!).map((h) => h.trim());
  const headerLower = headerFields.map((h) => h.toLowerCase());
  const headerSet = new Set(headerLower);

  // Required column presence.
  for (const col of REQUIRED_COLUMNS) {
    if (!headerSet.has(col.toLowerCase())) {
      return {
        schemaVersion: 1,
        targetTenantId: opts.targetTenantId,
        customers: [],
        errors: [],
        warnings: [],
        totalRowsObserved: 0,
        totalRowsAccepted: 0,
        totalRowsRejected: 0,
        summary: `Required column "${col}" missing from header.`,
        regulatory: ['FDL No.10/2025 Art.12-14'],
      };
    }
  }

  // Warn on unknown columns.
  for (const col of headerLower) {
    if (!SUPPORTED_COLUMNS.map((c) => c.toLowerCase()).includes(col)) {
      warnings.push(`Unknown column "${col}" ignored.`);
    }
  }

  const customers: CohortCustomer[] = [];
  const errors: ImportRowError[] = [];
  let observed = 0;

  for (let i = 1; i < rows.length; i++) {
    if (customers.length >= maxRows) {
      warnings.push(
        `Truncated at ${maxRows} rows — remaining ${rows.length - 1 - i + 1} row(s) skipped.`
      );
      break;
    }
    const rowNumber = i + 1; // 1-indexed; header is row 1.
    observed += 1;
    const fields = parseCsvRow(rows[i]!);
    const values: Record<string, string> = {};
    for (let j = 0; j < headerLower.length; j++) {
      const key = headerLower[j]!;
      values[key] = fields[j] ?? '';
    }
    // Build a canonical-key record the validator can read.
    const canon: Record<string, string> = {};
    for (const col of SUPPORTED_COLUMNS) {
      const key = col.toLowerCase();
      if (key in values) canon[col] = values[key]!;
    }
    const result = validateRow(rowNumber, canon, opts.targetTenantId);
    if (result.ok) {
      customers.push(result.customer);
    } else {
      errors.push({ rowNumber, reason: result.reason, rawValues: canon });
    }
  }

  const summary =
    errors.length === 0
      ? `Imported ${customers.length} customer(s) for tenant "${opts.targetTenantId}". ${warnings.length} warning(s).`
      : `Imported ${customers.length} customer(s) for tenant "${opts.targetTenantId}". ${errors.length} row(s) rejected. ${warnings.length} warning(s). MLRO must review rejected rows before ignoring.`;

  return {
    schemaVersion: 1,
    targetTenantId: opts.targetTenantId,
    customers,
    errors,
    warnings,
    totalRowsObserved: observed,
    totalRowsAccepted: customers.length,
    totalRowsRejected: errors.length,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.12-14',
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.7-10',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 10',
      'FATF Rec 22',
      'EU GDPR Art.25',
    ],
  };
}

// Exports for tests.
export const __test__ = {
  parseCsvRow,
  splitCsvRows,
  validateRow,
  REQUIRED_COLUMNS,
  SUPPORTED_COLUMNS,
};
