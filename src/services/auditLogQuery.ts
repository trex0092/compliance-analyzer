/**
 * Audit Log Query — read-only filter + sort + paginate over audit
 * records.
 *
 * Why this exists:
 *   The tool writes audit records to many blob prefixes:
 *     audit:skill:*
 *     audit:four-eyes:*
 *     audit:skill-denial:*
 *     demo:audit
 *     tierC:clamp-suggestion:*  (indirectly)
 *     asana:idem:*              (indirectly)
 *
 *   At inspection time regulators ask "show me every action by user
 *   X in the last quarter, export as CSV". Without a query layer the
 *   operator has to write one-off scripts every time.
 *
 *   This module is the pure query engine. It takes a flat array of
 *   AuditRecord objects + a filter spec + a sort spec and returns a
 *   paginated result. No I/O — the endpoint / UI layer loads the
 *   records from the blob stores and feeds them in.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.24    (10-year retention + query)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   Cabinet Res 71/2024       (inspection readiness)
 *   FATF Rec 11              (record keeping + retrieval)
 *   NIST AI RMF 1.0 MANAGE-2 (audit trail retrievability)
 *   EU GDPR Art.15           (subject access request — audit scoped)
 *   EU GDPR Art.30           (records of processing activities)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditRecord {
  /** Stable record id. */
  id: string;
  /** ISO 8601 timestamp of the action. */
  tsIso: string;
  /** Tenant scope. */
  tenantId: string;
  /** Operator / user who caused the event (opaque gid). */
  userId: string;
  /** Event key — `domain.verb` convention (e.g. skill.executed). */
  event: string;
  /** Plain-English detail field. */
  detail: string;
  /** Optional structured metadata. */
  meta?: Record<string, unknown>;
  /** Regulatory anchor list. */
  regulatory?: readonly string[];
}

export interface AuditLogFilter {
  /** Limit to records for this tenant. */
  tenantId?: string;
  /** Limit to records created by this user. */
  userId?: string;
  /** Free-text event key match (startsWith). */
  eventPrefix?: string;
  /** Inclusive lower bound on tsIso. */
  startIso?: string;
  /** Exclusive upper bound on tsIso. */
  endIso?: string;
  /** Case-insensitive substring match on detail. */
  detailContains?: string;
  /** Optional metadata key/value exact-match filter. */
  metaEquals?: Readonly<Record<string, string | number | boolean>>;
}

export interface AuditLogPage {
  schemaVersion: 1;
  totalMatched: number;
  pageSize: number;
  pageIndex: number;
  pageCount: number;
  records: readonly AuditRecord[];
  /** Plain-English summary. */
  summary: string;
  regulatory: readonly string[];
}

export interface AuditLogSort {
  field: 'tsIso' | 'userId' | 'event' | 'tenantId';
  direction: 'asc' | 'desc';
}

export interface QueryOptions {
  sort?: AuditLogSort;
  pageSize?: number;
  pageIndex?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesFilter(r: AuditRecord, f: AuditLogFilter): boolean {
  if (f.tenantId && r.tenantId !== f.tenantId) return false;
  if (f.userId && r.userId !== f.userId) return false;
  if (f.eventPrefix && !r.event.startsWith(f.eventPrefix)) return false;
  if (f.startIso && r.tsIso < f.startIso) return false;
  if (f.endIso && r.tsIso >= f.endIso) return false;
  if (f.detailContains) {
    const needle = f.detailContains.toLowerCase();
    if (!r.detail.toLowerCase().includes(needle)) return false;
  }
  if (f.metaEquals) {
    if (!r.meta) return false;
    for (const [k, v] of Object.entries(f.metaEquals)) {
      if (r.meta[k] !== v) return false;
    }
  }
  return true;
}

function compare(a: unknown, b: unknown): number {
  const as = String(a ?? '');
  const bs = String(b ?? '');
  if (as < bs) return -1;
  if (as > bs) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Public API — pure query
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export function queryAuditLog(
  records: readonly AuditRecord[],
  filter: AuditLogFilter,
  opts: QueryOptions = {}
): AuditLogPage {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
  const pageIndex = Math.max(0, opts.pageIndex ?? 0);
  const sortField = opts.sort?.field ?? 'tsIso';
  const sortDir = opts.sort?.direction ?? 'desc';

  // Filter
  const matched: AuditRecord[] = [];
  for (const r of records) if (matchesFilter(r, filter)) matched.push(r);

  // Sort
  matched.sort((a, b) => {
    const cmp = compare(
      (a as unknown as Record<string, unknown>)[sortField],
      (b as unknown as Record<string, unknown>)[sortField]
    );
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Paginate
  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const start = pageIndex * pageSize;
  const pageRecords = matched.slice(start, start + pageSize);

  return {
    schemaVersion: 1,
    totalMatched: matched.length,
    pageSize,
    pageIndex,
    pageCount,
    records: pageRecords,
    summary:
      matched.length === 0
        ? 'No audit records matched the filter.'
        : `Matched ${matched.length} audit record(s). Showing page ${pageIndex + 1}/${pageCount} (${pageRecords.length} rows).`,
    regulatory: [
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'Cabinet Res 71/2024',
      'FATF Rec 11',
      'NIST AI RMF 1.0 MANAGE-2',
      'EU GDPR Art.15',
      'EU GDPR Art.30',
    ],
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Serialise audit records to RFC-4180 CSV with the canonical column
 * order. Pure — no I/O.
 */
export function auditLogToCsv(records: readonly AuditRecord[]): string {
  const header = ['id', 'tsIso', 'tenantId', 'userId', 'event', 'detail', 'regulatory'];
  const rows = records.map((r) => [
    r.id,
    r.tsIso,
    r.tenantId,
    r.userId,
    r.event,
    r.detail,
    (r.regulatory ?? []).join('; '),
  ]);
  const escape = (cell: string): string => {
    if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
      return '"' + cell.replace(/"/g, '""') + '"';
    }
    return cell;
  };
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

// Exports for tests.
export const __test__ = { matchesFilter, compare, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
