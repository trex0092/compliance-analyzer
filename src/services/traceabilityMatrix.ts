/**
 * Regulatory Traceability Matrix Generator — N10.
 *
 * Walks `src/domain/constants.ts` and produces a matrix mapping every
 * regulatory constant to:
 *
 *   1. The regulatory citation it implements (e.g. "FDL Art.16")
 *   2. The constant name and value
 *   3. The code file that reads it (via a static import scan)
 *   4. The test file that pins it (via a static import scan)
 *
 * This is the evidence artefact MoE / LBMA / FIU inspectors ask for:
 * "prove every obligation in FDL / Cabinet Res maps to a concrete
 * control in your tool, and prove every control has a test that
 * pins the regulatory value."
 *
 * Pure compute — the caller passes the text content of the files,
 * the generator walks them with regex + simple AST-like scanning,
 * and returns a deterministic matrix.
 *
 * Regulatory basis:
 *   FDL Art.24 (record retention with reconstruction)
 *   CLAUDE.md "Constants Architecture" — single source of truth
 *   MoE Inspection Manual v4 §9 (traceability requirement)
 */

export interface TraceabilityEntry {
  /** Constant name as exported from src/domain/constants.ts. */
  constantName: string;
  /** Value extracted from the constant declaration (best-effort). */
  rawValue: string;
  /** Regulatory citations extracted from the JSDoc comment. */
  citations: string[];
  /** Relative paths of source files that import this constant. */
  readBy: string[];
  /** Relative paths of test files that import this constant. */
  pinnedBy: string[];
  /** Human-readable description extracted from the JSDoc comment. */
  description: string;
}

export interface TraceabilityMatrix {
  generatedAtIso: string;
  /** Total constants exported from src/domain/constants.ts. */
  totalConstants: number;
  /** Constants backed by at least one regulatory citation. */
  citedConstants: number;
  /** Constants with at least one source caller. */
  coveredConstants: number;
  /** Constants with at least one test pin. */
  pinnedConstants: number;
  entries: readonly TraceabilityEntry[];
}

// ---------------------------------------------------------------------------
// Constant extractor
// ---------------------------------------------------------------------------

interface RawConstant {
  name: string;
  value: string;
  description: string;
  citations: string[];
}

/**
 * Extract every top-level `export const NAME = VALUE` declaration
 * from the constants file, along with its preceding JSDoc block.
 *
 * The scanner is intentionally small and regex-based — constants.ts
 * is a flat file with only export-const declarations, so full AST
 * parsing would be overkill.
 */
export function extractConstants(constantsSource: string): RawConstant[] {
  const out: RawConstant[] = [];
  // Find every export const declaration. The regex captures an
  // optional leading JSDoc block, the name, and the raw value
  // (up to the semicolon at end-of-line).
  const re =
    /(?:\/\*\*([\s\S]*?)\*\/\s*\n)?export const ([A-Z][A-Z0-9_]*(?:_[A-Z0-9]+)*)\s*(?::\s*[^=]+)?\s*=\s*([^;\n]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(constantsSource)) !== null) {
    const [, jsdoc, name, rawValue] = match;
    const { description, citations } = parseJsDoc(jsdoc ?? '');
    out.push({
      name,
      value: rawValue.trim(),
      description,
      citations,
    });
  }
  return out;
}

function parseJsDoc(jsdoc: string): { description: string; citations: string[] } {
  if (!jsdoc) return { description: '', citations: [] };
  // Strip leading asterisks + whitespace from each line.
  const lines = jsdoc
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l.length > 0);
  const text = lines.join(' ');
  // Every citation inside parentheses that contains a regulatory
  // reference keyword (FDL, Cabinet, FATF, EOCN, MoE, LBMA, Art.).
  const citations: string[] = [];
  const citationRe = /\(([^)]*(?:FDL|Cabinet|FATF|EOCN|MoE|LBMA|Art\.)[^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = citationRe.exec(text)) !== null) {
    citations.push(m[1].trim());
  }
  return { description: text, citations };
}

// ---------------------------------------------------------------------------
// Importer scanner
// ---------------------------------------------------------------------------

export interface SourceFile {
  /** Relative path for the matrix output (e.g. "src/services/foo.ts"). */
  path: string;
  /** Raw file content. */
  content: string;
}

/**
 * Given a list of files and the target constant names, return the
 * subset of files that import any of the targets from the domain
 * constants module. The match is deliberately permissive — any
 * `import ... from '.../domain/constants'` line that mentions the
 * constant name counts.
 */
export function findImporters(
  files: readonly SourceFile[],
  constantNames: readonly string[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of constantNames) out.set(name, []);

  for (const file of files) {
    // Find all import statements pulling from the domain/constants
    // module (supports relative imports via '../../domain/constants',
    // path alias '@/domain/constants', and the bare module specifier).
    const importRe = /import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*['"][^'"]*domain\/constants['"]/g;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(file.content)) !== null) {
      const imported = m[1]
        .split(',')
        .map((s) =>
          s
            .trim()
            .replace(/^type\s+/, '')
            .replace(/\s+as\s+\w+$/, '')
        )
        .filter((s) => s.length > 0);
      for (const name of imported) {
        if (out.has(name)) {
          out.get(name)!.push(file.path);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matrix assembler
// ---------------------------------------------------------------------------

export interface MatrixInput {
  /** Contents of src/domain/constants.ts. */
  constantsSource: string;
  /** List of src/ files to scan for importers (excluding tests). */
  sourceFiles: readonly SourceFile[];
  /** List of tests/ files to scan for importers. */
  testFiles: readonly SourceFile[];
  /** Optional override for the generated-at timestamp (used by tests). */
  generatedAtIso?: string;
}

export function buildTraceabilityMatrix(input: MatrixInput): TraceabilityMatrix {
  const constants = extractConstants(input.constantsSource);
  const names = constants.map((c) => c.name);
  const readBy = findImporters(input.sourceFiles, names);
  const pinnedBy = findImporters(input.testFiles, names);

  const entries: TraceabilityEntry[] = constants.map((c) => ({
    constantName: c.name,
    rawValue: c.value,
    citations: c.citations,
    readBy: (readBy.get(c.name) ?? []).sort(),
    pinnedBy: (pinnedBy.get(c.name) ?? []).sort(),
    description: c.description,
  }));

  const citedConstants = entries.filter((e) => e.citations.length > 0).length;
  const coveredConstants = entries.filter((e) => e.readBy.length > 0).length;
  const pinnedConstants = entries.filter((e) => e.pinnedBy.length > 0).length;

  return {
    generatedAtIso: input.generatedAtIso ?? new Date().toISOString(),
    totalConstants: entries.length,
    citedConstants,
    coveredConstants,
    pinnedConstants,
    entries,
  };
}

/**
 * Render the matrix as a markdown table suitable for handing to an
 * inspector.
 */
export function renderMatrixMarkdown(matrix: TraceabilityMatrix): string {
  const lines: string[] = [];
  lines.push('# Regulatory Traceability Matrix');
  lines.push('');
  lines.push(`Generated: ${matrix.generatedAtIso}`);
  lines.push('');
  lines.push(
    `- **Total constants:** ${matrix.totalConstants}\n` +
      `- **With regulatory citation:** ${matrix.citedConstants}\n` +
      `- **Read by source files:** ${matrix.coveredConstants}\n` +
      `- **Pinned by tests:** ${matrix.pinnedConstants}`
  );
  lines.push('');
  lines.push('| Constant | Value | Citations | Read by | Pinned by |');
  lines.push('|---|---|---|---|---|');
  for (const e of matrix.entries) {
    const cits = e.citations.length > 0 ? e.citations.join('; ') : '_none_';
    const reads = e.readBy.length > 0 ? e.readBy.map((p) => `\`${p}\``).join(', ') : '_none_';
    const pins = e.pinnedBy.length > 0 ? e.pinnedBy.map((p) => `\`${p}\``).join(', ') : '_none_';
    lines.push(`| \`${e.constantName}\` | \`${e.rawValue}\` | ${cits} | ${reads} | ${pins} |`);
  }
  return lines.join('\n');
}
