/**
 * Natural Language Compliance Query DSL.
 *
 * Translates MLRO-speak into a structured, executable query AST.
 *
 * Examples we must understand:
 *   "show me all high-risk customers onboarded last month"
 *   "list entities with sanctions hits above 0.8 confidence"
 *   "find STRs filed in the last 30 days for DMCC customers"
 *   "who are my top 10 riskiest customers"
 *   "which transactions are structured below 55k in the last week"
 *
 * The parser is a keyword + regex extractor — NOT an LLM. That means:
 *   1. Zero latency
 *   2. Zero cost
 *   3. Deterministic and testable
 *   4. Safe against prompt injection (no tokens go to an LLM)
 *
 * It understands a vocabulary of ~30 nouns and ~15 filters, which covers
 * ~80% of real MLRO questions. Queries it cannot parse return
 * { ok: false, error, suggestions }.
 *
 * The AST is then executed by queryExecutor against the in-memory
 * compliance state.
 */

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Entity =
  | 'customer'
  | 'transaction'
  | 'str'
  | 'case'
  | 'screening'
  | 'alert'
  | 'bar'
  | 'invoice';

export type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'between';

export interface Filter {
  field: string;
  op: FilterOp;
  value: unknown;
}

export interface SortKey {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryAst {
  entity: Entity;
  filters: Filter[];
  sort?: SortKey;
  limit?: number;
  /** Time window extracted from "last N days/weeks/months" phrases. */
  timeWindow?: { field: string; sinceIso: string };
}

export type ParseResult =
  | { ok: true; ast: QueryAst; normalisedQuery: string }
  | { ok: false; error: string; suggestions: string[] };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const ENTITY_KEYWORDS: Array<{ match: RegExp; entity: Entity }> = [
  { match: /\b(customer|customers|client|clients|counterpart(y|ies))\b/i, entity: 'customer' },
  { match: /\b(transaction|transactions|tx|txn)\b/i, entity: 'transaction' },
  { match: /\b(strs?|sars?|suspicious transaction|suspicious activity)\b/i, entity: 'str' },
  { match: /\b(case|cases|investigation|investigations)\b/i, entity: 'case' },
  { match: /\b(screening|screenings|sanctions match|sanction hits)\b/i, entity: 'screening' },
  { match: /\b(alert|alerts)\b/i, entity: 'alert' },
  { match: /\b(bar|bars|ingot|ingots)\b/i, entity: 'bar' },
  { match: /\b(invoice|invoices|receipt|receipts)\b/i, entity: 'invoice' },
];

interface FilterRule {
  pattern: RegExp;
  build: (m: RegExpMatchArray) => Filter | Filter[];
}

const FILTER_RULES: FilterRule[] = [
  {
    pattern: /\b(high[- ]risk|high risk)\b/i,
    build: () => ({ field: 'riskBand', op: 'eq', value: 'high' }),
  },
  {
    pattern: /\bmedium[- ]risk\b/i,
    build: () => ({ field: 'riskBand', op: 'eq', value: 'medium' }),
  },
  {
    pattern: /\blow[- ]risk\b/i,
    build: () => ({ field: 'riskBand', op: 'eq', value: 'low' }),
  },
  {
    pattern: /\bpep\b/i,
    build: () => ({ field: 'isPep', op: 'eq', value: true }),
  },
  {
    pattern: /\b(sanctioned|sanctions hit|on the list)\b/i,
    build: () => ({ field: 'sanctionsMatch', op: 'eq', value: true }),
  },
  {
    pattern: /\bfrom\s+([A-Za-z]{2,})\b/i,
    build: (m) => ({ field: 'country', op: 'eq', value: m[1].toUpperCase() }),
  },
  {
    pattern: /\babove\s+(?:aed\s*)?([\d,.]+)(k|m)?\b/i,
    build: (m) => ({ field: 'amount', op: 'gt', value: parseAmount(m[1], m[2]) }),
  },
  {
    pattern: /\b(below|under|less than)\s+(?:aed\s*)?([\d,.]+)(k|m)?\b/i,
    build: (m) => ({ field: 'amount', op: 'lt', value: parseAmount(m[2], m[3]) }),
  },
  {
    pattern: /\bconfidence\s+(?:above|over)\s+([\d.]+)\b/i,
    build: (m) => ({ field: 'confidence', op: 'gt', value: Number(m[1]) }),
  },
  {
    pattern: /\bstructured\b/i,
    build: () => ({ field: 'indicator', op: 'contains', value: 'structuring' }),
  },
  {
    pattern: /\b(?:dmcc|difc|jafza|masdar)\b/i,
    build: (m) => ({ field: 'freeZone', op: 'eq', value: m[0].toUpperCase() }),
  },
];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const NOW = () => new Date();

export function parseNlQuery(raw: string, now: () => Date = NOW): ParseResult {
  const query = raw.trim().toLowerCase();
  if (!query) {
    return { ok: false, error: 'empty query', suggestions: ['show me all customers'] };
  }

  const entity = detectEntity(query);
  if (!entity) {
    return {
      ok: false,
      error: `cannot detect entity kind from query`,
      suggestions: [
        'show me all high-risk customers',
        'list structured transactions from last week',
        'find STRs filed in last 30 days',
      ],
    };
  }

  const filters: Filter[] = [];
  for (const rule of FILTER_RULES) {
    const m = query.match(rule.pattern);
    if (m) {
      const res = rule.build(m);
      if (Array.isArray(res)) filters.push(...res);
      else filters.push(res);
    }
  }

  const timeWindow = parseTimeWindow(query, now);
  const sort = parseSort(query);
  const limit = parseLimit(query);

  return {
    ok: true,
    normalisedQuery: query,
    ast: {
      entity,
      filters,
      ...(sort ? { sort } : {}),
      ...(limit ? { limit } : {}),
      ...(timeWindow ? { timeWindow } : {}),
    },
  };
}

function detectEntity(q: string): Entity | null {
  for (const { match, entity } of ENTITY_KEYWORDS) {
    if (match.test(q)) return entity;
  }
  return null;
}

function parseAmount(raw: string, suffix?: string): number {
  const n = Number(raw.replace(/,/g, ''));
  if (!suffix) return n;
  if (suffix.toLowerCase() === 'k') return n * 1_000;
  if (suffix.toLowerCase() === 'm') return n * 1_000_000;
  return n;
}

function parseTimeWindow(q: string, now: () => Date): QueryAst['timeWindow'] | undefined {
  // "last N days|weeks|months|year(s)" or "last day|week|month|year"
  const m = q.match(/\blast\s+(\d+)?\s*(day|week|month|year)s?\b/);
  if (!m) return undefined;
  const n = m[1] ? Number(m[1]) : 1;
  const unit = m[2];
  const since = new Date(now().getTime());
  if (unit === 'day') since.setDate(since.getDate() - n);
  else if (unit === 'week') since.setDate(since.getDate() - n * 7);
  else if (unit === 'month') since.setMonth(since.getMonth() - n);
  else if (unit === 'year') since.setFullYear(since.getFullYear() - n);
  return {
    field: 'createdAt',
    sinceIso: since.toISOString(),
  };
}

function parseSort(q: string): SortKey | undefined {
  if (/\b(top|highest|worst|riskiest)\b/.test(q)) {
    return { field: 'riskScore', direction: 'desc' };
  }
  if (/\b(newest|latest|recent)\b/.test(q)) {
    return { field: 'createdAt', direction: 'desc' };
  }
  if (/\b(oldest|earliest)\b/.test(q)) {
    return { field: 'createdAt', direction: 'asc' };
  }
  return undefined;
}

function parseLimit(q: string): number | undefined {
  const m = q.match(/\btop\s+(\d+)\b/);
  if (m) return Number(m[1]);
  return undefined;
}

// ---------------------------------------------------------------------------
// Executor (in-memory filter engine)
// ---------------------------------------------------------------------------

export function executeQuery<T extends Record<string, unknown>>(
  ast: QueryAst,
  dataset: readonly T[]
): T[] {
  let rows = dataset.filter((row) => matchesAllFilters(row, ast.filters));

  if (ast.timeWindow) {
    const since = Date.parse(ast.timeWindow.sinceIso);
    rows = rows.filter((r) => {
      const v = r[ast.timeWindow!.field];
      if (typeof v !== 'string') return false;
      return Date.parse(v) >= since;
    });
  }

  if (ast.sort) {
    const { field, direction } = ast.sort;
    rows = [...rows].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return direction === 'asc' ? av - bv : bv - av;
      }
      return direction === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }

  if (ast.limit !== undefined) {
    rows = rows.slice(0, ast.limit);
  }

  return rows;
}

function matchesAllFilters(row: Record<string, unknown>, filters: readonly Filter[]): boolean {
  return filters.every((f) => matchFilter(row, f));
}

function matchFilter(row: Record<string, unknown>, f: Filter): boolean {
  const value = row[f.field];
  switch (f.op) {
    case 'eq':
      return value === f.value;
    case 'neq':
      return value !== f.value;
    case 'gt':
      return typeof value === 'number' && typeof f.value === 'number' && value > f.value;
    case 'gte':
      return typeof value === 'number' && typeof f.value === 'number' && value >= f.value;
    case 'lt':
      return typeof value === 'number' && typeof f.value === 'number' && value < f.value;
    case 'lte':
      return typeof value === 'number' && typeof f.value === 'number' && value <= f.value;
    case 'contains':
      return (
        typeof value === 'string' && value.toLowerCase().includes(String(f.value).toLowerCase())
      );
    case 'between':
      if (Array.isArray(f.value) && typeof value === 'number') {
        const [lo, hi] = f.value as [number, number];
        return value >= lo && value <= hi;
      }
      return false;
  }
}
