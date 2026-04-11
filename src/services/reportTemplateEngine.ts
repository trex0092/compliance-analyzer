/**
 * Report Template Engine — QWeb-inspired minimal templating for compliance documents.
 *
 * Inspired by OCA/reporting-engine :: base_comment_template (Mako) +
 * Odoo's QWeb templating. This is a minimal pure-TypeScript template
 * engine that supports:
 *
 *   - {{ expression }}        — variable interpolation (HTML-escaped)
 *   - {{{ expression }}}      — raw interpolation (no escape, use with care)
 *   - {% if condition %}...{% endif %}   — conditional blocks
 *   - {% for item in list %}...{% endfor %} — iteration
 *   - Dot-access: {{ customer.name }}, {{ case.risk.level }}
 *   - Built-in filters: | upper, | lower, | date, | currency
 *
 * NO arbitrary JavaScript execution, NO eval, NO new Function(). The
 * expression grammar is a narrow property-access path + optional
 * pipe-filter chain. Safe by construction for compliance use.
 *
 * Used by goAML template builders, STR narrative templates, 4-eyes
 * approval letters, inspector packs, and regulatory cover letters.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.26-27 (STR/SAR filing templates)
 *   - MoE Circular 08/AML/2021 (goAML XML templates)
 *   - Cabinet Res 134/2025 Art.19 (auditable document generation)
 *   - FATF Rec 20 (structured reporting)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateContext = Record<string, unknown>;

export interface RenderOptions {
  /** Throw on unknown variables instead of emitting ''. Default: false. */
  strict?: boolean;
  /** Override the HTML escaper (e.g. pass identity for Markdown output). */
  escape?: (s: string) => string;
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type FilterFn = (input: unknown, ...args: string[]) => string;

const FILTERS: Record<string, FilterFn> = {
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  trim: (v) => String(v).trim(),
  date: (v) => {
    const d = v instanceof Date ? v : new Date(String(v));
    if (!Number.isFinite(d.getTime())) return String(v);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    return `${dd}/${mm}/${yyyy}`;
  },
  currency: (v, unit = 'AED') => {
    const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
    if (!Number.isFinite(n)) return String(v);
    return `${unit} ${n.toLocaleString('en-AE')}`;
  },
  default: (v, fallback = '') => (v === undefined || v === null || v === '' ? fallback : String(v)),
  length: (v) => {
    if (Array.isArray(v)) return String(v.length);
    if (typeof v === 'string') return String(v.length);
    return '0';
  },
};

function applyFilters(value: unknown, filterChain: string[]): string {
  let current: unknown = value;
  for (const raw of filterChain) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const [name, ...rest] = trimmed.split(/\s+/);
    const fn = FILTERS[name];
    if (!fn) continue;
    current = fn(current, ...rest);
  }
  return current === null || current === undefined ? '' : String(current);
}

// ---------------------------------------------------------------------------
// Expression resolver (narrow: property path only)
// ---------------------------------------------------------------------------

const PATH_SEGMENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function resolveExpression(expr: string, context: TemplateContext): unknown {
  const parts = expr.split('.');
  let current: unknown = context;
  for (const part of parts) {
    if (!PATH_SEGMENT.test(part)) {
      throw new TemplateError(`Invalid expression segment: ${part}`);
    }
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function isTruthy(v: unknown): boolean {
  if (!v) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Default HTML escape
// ---------------------------------------------------------------------------

function defaultEscape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Parser + renderer
// ---------------------------------------------------------------------------

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'interp'; expr: string; filters: string[]; raw: boolean }
  | { kind: 'if'; condition: string; body: Node[] }
  | { kind: 'for'; iterName: string; sourceExpr: string; body: Node[] };

function tokenise(template: string): Array<{ kind: 'text' | 'tag'; value: string }> {
  const tokens: Array<{ kind: 'text' | 'tag'; value: string }> = [];
  let i = 0;
  while (i < template.length) {
    const nextInterp = template.indexOf('{{', i);
    const nextBlock = template.indexOf('{%', i);
    let next = -1;
    if (nextInterp >= 0 && (nextBlock < 0 || nextInterp < nextBlock)) {
      next = nextInterp;
    } else if (nextBlock >= 0) {
      next = nextBlock;
    }
    if (next === -1) {
      tokens.push({ kind: 'text', value: template.slice(i) });
      break;
    }
    if (next > i) {
      tokens.push({ kind: 'text', value: template.slice(i, next) });
    }
    const closing = next === nextInterp ? '}}' : '%}';
    const end = template.indexOf(closing, next);
    if (end === -1) {
      throw new TemplateError(`Unterminated template tag at offset ${next}`);
    }
    tokens.push({ kind: 'tag', value: template.slice(next, end + closing.length) });
    i = end + closing.length;
  }
  return tokens;
}

function parseTokens(
  tokens: ReadonlyArray<{ kind: 'text' | 'tag'; value: string }>,
  cursor: { i: number },
  stopTags: readonly string[] = []
): Node[] {
  const nodes: Node[] = [];
  while (cursor.i < tokens.length) {
    const tok = tokens[cursor.i];
    if (tok.kind === 'text') {
      nodes.push({ kind: 'text', value: tok.value });
      cursor.i += 1;
      continue;
    }
    const tagContent = tok.value.slice(2, -2).trim();

    // End tags
    if (stopTags.includes(tagContent)) {
      return nodes;
    }

    // {% if ... %}
    if (tagContent.startsWith('if ')) {
      cursor.i += 1;
      const condition = tagContent.slice(3).trim();
      const body = parseTokens(tokens, cursor, ['endif']);
      if (cursor.i >= tokens.length) throw new TemplateError('Missing {% endif %}');
      cursor.i += 1;
      nodes.push({ kind: 'if', condition, body });
      continue;
    }

    // {% for x in list %}
    if (tagContent.startsWith('for ')) {
      cursor.i += 1;
      const forMatch = tagContent.match(/^for\s+(\w+)\s+in\s+(.+)$/);
      if (!forMatch) throw new TemplateError(`Invalid for tag: ${tagContent}`);
      const body = parseTokens(tokens, cursor, ['endfor']);
      if (cursor.i >= tokens.length) throw new TemplateError('Missing {% endfor %}');
      cursor.i += 1;
      nodes.push({ kind: 'for', iterName: forMatch[1], sourceExpr: forMatch[2].trim(), body });
      continue;
    }

    // {{ expression | filter }}
    if (tok.value.startsWith('{{') && tok.value.endsWith('}}')) {
      const raw = tok.value.startsWith('{{{') && tok.value.endsWith('}}}');
      const inner = raw ? tok.value.slice(3, -3).trim() : tagContent;
      const [expr, ...filters] = inner.split('|').map((p) => p.trim());
      nodes.push({ kind: 'interp', expr, filters, raw });
      cursor.i += 1;
      continue;
    }

    throw new TemplateError(`Unknown template tag: ${tagContent}`);
  }
  return nodes;
}

function renderNodes(
  nodes: readonly Node[],
  context: TemplateContext,
  opts: Required<Pick<RenderOptions, 'escape'>> & RenderOptions
): string {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') {
      out.push(node.value);
    } else if (node.kind === 'interp') {
      // Invalid-syntax errors from resolveExpression ALWAYS propagate
      // — they represent attempted injection, not missing data. Only
      // the "unknown field returned undefined" case is caught by
      // non-strict mode below.
      const value = resolveExpression(node.expr, context);
      if (value === undefined && opts.strict) {
        throw new TemplateError(`Unknown variable: ${node.expr}`);
      }
      const rendered = applyFilters(value, node.filters);
      out.push(node.raw ? rendered : opts.escape(rendered));
    } else if (node.kind === 'if') {
      const value = resolveExpression(node.condition, context);
      if (isTruthy(value)) {
        out.push(renderNodes(node.body, context, opts));
      }
    } else if (node.kind === 'for') {
      const source = resolveExpression(node.sourceExpr, context);
      if (Array.isArray(source)) {
        for (const item of source) {
          out.push(renderNodes(node.body, { ...context, [node.iterName]: item }, opts));
        }
      }
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderTemplate(
  template: string,
  context: TemplateContext,
  options: RenderOptions = {}
): string {
  const tokens = tokenise(template);
  const cursor = { i: 0 };
  const nodes = parseTokens(tokens, cursor);
  const opts = { ...options, escape: options.escape ?? defaultEscape };
  return renderNodes(nodes, context, opts);
}
