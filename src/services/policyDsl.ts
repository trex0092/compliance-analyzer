/**
 * Compliance Policy DSL.
 *
 * A tiny, sandboxed mini-language that MLROs can edit WITHOUT writing
 * TypeScript. Rules take the form:
 *
 *   IF <condition> THEN <verdict>
 *
 * Where <condition> is a boolean expression built from:
 *   - field references:   pep, sanctions_score, country, amount_aed
 *   - literals:           true, false, "IR", 55000, 0.9
 *   - comparisons:        ==, !=, >, >=, <, <=
 *   - membership:         in ["IR", "KP"]
 *   - logical operators:  and, or, not
 *   - grouping:           ( ... )
 *
 * And <verdict> is one of: pass | flag | escalate | freeze.
 *
 * A policy is an ordered list of rules. The first matching rule wins.
 * If nothing matches, the default verdict is `pass`.
 *
 * Example policy text:
 *
 *   IF sanctions_score >= 0.9 THEN freeze
 *   IF pep == true and country in ["IR", "KP", "MM"] THEN escalate
 *   IF amount_aed >= 55000 and cash_ratio > 0.5 THEN flag
 *   IF amount_aed < 1000 THEN pass
 *
 * Security: the parser REJECTS any unexpected token. There is no eval,
 * no string interpolation, no function calls, no property access
 * beyond flat field names. The surface is narrow by design.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.5 (documented risk methodology)
 *   - FDL Art.20 (CO documents reasoning)
 *   - FATF Rec 1 (risk-based approach)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export type Literal = string | number | boolean;

export type Expr =
  | { kind: 'literal'; value: Literal }
  | { kind: 'field'; name: string }
  | { kind: 'array'; items: Literal[] }
  | { kind: 'binary'; op: CompareOp; left: Expr; right: Expr }
  | { kind: 'in'; left: Expr; right: Expr }
  | { kind: 'and'; left: Expr; right: Expr }
  | { kind: 'or'; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr };

type CompareOp = '==' | '!=' | '>' | '>=' | '<' | '<=';

export interface Rule {
  lineNumber: number;
  condition: Expr;
  verdict: Verdict;
}

export interface Policy {
  rules: Rule[];
  source: string;
}

export type FieldValue = Literal | null | undefined;
export type Facts = Record<string, FieldValue>;

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type Token =
  | { t: 'ident'; v: string }
  | { t: 'number'; v: number }
  | { t: 'string'; v: string }
  | { t: 'symbol'; v: string };

function tokenise(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j++;
      if (j >= line.length) throw new Error(`unterminated string literal`);
      tokens.push({ t: 'string', v: line.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(line[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < line.length && /[0-9.]/.test(line[j])) j++;
      tokens.push({ t: 'number', v: Number(line.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i + 1;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      tokens.push({ t: 'ident', v: line.slice(i, j) });
      i = j;
      continue;
    }
    if ('()[],'.includes(ch)) {
      tokens.push({ t: 'symbol', v: ch });
      i++;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (['==', '!=', '>=', '<='].includes(two)) {
      tokens.push({ t: 'symbol', v: two });
      i += 2;
      continue;
    }
    if ('><'.includes(ch)) {
      tokens.push({ t: 'symbol', v: ch });
      i++;
      continue;
    }
    throw new Error(`unexpected character: ${ch}`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  parseExpr(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.matchIdent('or')) {
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.matchIdent('and')) {
      const right = this.parseNot();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.matchIdent('not')) {
      return { kind: 'not', expr: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parsePrimary();
    const cur = this.peek();
    if (cur?.t === 'symbol' && ['==', '!=', '>', '>=', '<', '<='].includes(cur.v)) {
      this.pos++;
      const right = this.parsePrimary();
      return { kind: 'binary', op: cur.v as CompareOp, left, right };
    }
    if (this.matchIdent('in')) {
      const right = this.parsePrimary();
      return { kind: 'in', left, right };
    }
    return left;
  }

  private parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok) throw new Error('unexpected end of expression');
    if (tok.t === 'symbol' && tok.v === '(') {
      this.pos++;
      const expr = this.parseExpr();
      this.expect('symbol', ')');
      return expr;
    }
    if (tok.t === 'symbol' && tok.v === '[') {
      this.pos++;
      const items: Literal[] = [];
      for (;;) {
        const next = this.peek();
        if (!next) throw new Error('unterminated array');
        if (next.t === 'symbol' && next.v === ']') {
          this.pos++;
          break;
        }
        if (next.t === 'number') items.push(next.v);
        else if (next.t === 'string') items.push(next.v);
        else if (next.t === 'ident' && (next.v === 'true' || next.v === 'false')) {
          items.push(next.v === 'true');
        } else throw new Error(`invalid array literal: ${String(next.v)}`);
        this.pos++;
        const sep = this.peek();
        if (sep?.t === 'symbol' && sep.v === ',') {
          this.pos++;
        }
      }
      return { kind: 'array', items };
    }
    if (tok.t === 'number') {
      this.pos++;
      return { kind: 'literal', value: tok.v };
    }
    if (tok.t === 'string') {
      this.pos++;
      return { kind: 'literal', value: tok.v };
    }
    if (tok.t === 'ident') {
      this.pos++;
      if (tok.v === 'true') return { kind: 'literal', value: true };
      if (tok.v === 'false') return { kind: 'literal', value: false };
      return { kind: 'field', name: tok.v };
    }
    throw new Error(`unexpected token: ${JSON.stringify(tok)}`);
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private matchIdent(v: string): boolean {
    const cur = this.peek();
    if (cur?.t === 'ident' && cur.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(kind: Token['t'], v: string): void {
    const cur = this.peek();
    if (!cur || cur.t !== kind || cur.v !== v) {
      throw new Error(`expected ${kind} "${v}"`);
    }
    this.pos++;
  }

  isDone(): boolean {
    return this.pos >= this.tokens.length;
  }
}

// ---------------------------------------------------------------------------
// Policy parser (line-oriented)
// ---------------------------------------------------------------------------

const VALID_VERDICTS: Verdict[] = ['pass', 'flag', 'escalate', 'freeze'];

export function parsePolicy(source: string): Policy {
  const rules: Rule[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    // Expected shape: IF <cond> THEN <verdict>
    const match = /^IF\s+(.+?)\s+THEN\s+([a-zA-Z]+)\s*$/i.exec(raw);
    if (!match) {
      throw new Error(
        `policy line ${i + 1}: expected "IF <condition> THEN <verdict>", got "${raw}"`
      );
    }
    const [, condText, verdictText] = match;
    const verdict = verdictText.toLowerCase() as Verdict;
    if (!VALID_VERDICTS.includes(verdict)) {
      throw new Error(`policy line ${i + 1}: unknown verdict "${verdictText}"`);
    }
    const tokens = tokenise(condText);
    const parser = new Parser(tokens);
    const condition = parser.parseExpr();
    if (!parser.isDone()) {
      throw new Error(`policy line ${i + 1}: trailing tokens in condition`);
    }
    rules.push({ lineNumber: i + 1, condition, verdict });
  }
  return { rules, source };
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function evalExpr(expr: Expr, facts: Facts): Literal | null {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'field':
      return facts[expr.name] ?? null;
    case 'array':
      // Arrays are only meaningful on the RHS of `in`.
      return null;
    case 'not':
      return !toBoolean(evalExpr(expr.expr, facts));
    case 'and':
      return toBoolean(evalExpr(expr.left, facts)) && toBoolean(evalExpr(expr.right, facts));
    case 'or':
      return toBoolean(evalExpr(expr.left, facts)) || toBoolean(evalExpr(expr.right, facts));
    case 'binary': {
      const l = evalExpr(expr.left, facts);
      const r = evalExpr(expr.right, facts);
      switch (expr.op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '>':
          return typeof l === 'number' && typeof r === 'number' && l > r;
        case '>=':
          return typeof l === 'number' && typeof r === 'number' && l >= r;
        case '<':
          return typeof l === 'number' && typeof r === 'number' && l < r;
        case '<=':
          return typeof l === 'number' && typeof r === 'number' && l <= r;
      }
      return false;
    }
    case 'in': {
      const l = evalExpr(expr.left, facts);
      if (expr.right.kind !== 'array') return false;
      return expr.right.items.includes(l as Literal);
    }
  }
}

function toBoolean(v: Literal | null): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return false;
}

export interface PolicyTrace {
  verdict: Verdict;
  matchedRule: Rule | null;
  evaluatedRules: number;
}

export function evaluatePolicy(policy: Policy, facts: Facts): PolicyTrace {
  let evaluated = 0;
  for (const rule of policy.rules) {
    evaluated++;
    const v = evalExpr(rule.condition, facts);
    if (toBoolean(v)) {
      return { verdict: rule.verdict, matchedRule: rule, evaluatedRules: evaluated };
    }
  }
  return { verdict: 'pass', matchedRule: null, evaluatedRules: evaluated };
}
