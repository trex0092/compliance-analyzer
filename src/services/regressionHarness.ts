/**
 * Regression Harness — golden-file runner that asserts every canonical
 * test case produces the same brain verdict across commits.
 *
 * Why this exists:
 *   vitest runs unit tests — pure functions in isolation. The
 *   regression harness runs INTEGRATION cases: real StrFeatures
 *   vectors against a real verdict function, and compares the
 *   output to a frozen golden file. Any behavioural drift breaks
 *   the harness.
 *
 *   This is what CI runs before every production deploy. It is
 *   also what MLROs run after a clamp suggestion is accepted +
 *   merged, to prove the new constants did not break a
 *   previously-stable verdict.
 *
 *   The harness is PURE with respect to the verdict function — no
 *   network, no blob I/O. The CLI wrapper injects a real verdict
 *   function; tests inject a stub.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO validated decision engine)
 *   Cabinet Res 134/2025 Art.19 (internal review — pre-deploy gate)
 *   NIST AI RMF 1.0 MEASURE-4 (test, evaluate, verify, validate)
 *   EU AI Act Art.15         (accuracy + robustness)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface GoldenCase {
  id: string;
  description: string;
  features: Readonly<Record<string, number>>;
  expectedVerdict: Verdict;
  /** Tolerance on confidence comparison. Default 0.05. */
  confidenceTolerance?: number;
  expectedConfidence?: number;
  regulatoryAnchor: string;
}

export type RegressionVerdictFn = (
  features: Readonly<Record<string, number>>
) => { verdict: Verdict; confidence: number } | Promise<{ verdict: Verdict; confidence: number }>;

export interface CaseResult {
  id: string;
  description: string;
  expectedVerdict: Verdict;
  actualVerdict: Verdict;
  expectedConfidence: number | null;
  actualConfidence: number;
  verdictMatch: boolean;
  confidenceMatch: boolean;
  /** True when BOTH verdict AND confidence (if checked) agree. */
  pass: boolean;
  regulatoryAnchor: string;
}

export interface RegressionReport {
  schemaVersion: 1;
  runAtIso: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  results: readonly CaseResult[];
  pass: boolean;
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runRegression(
  cases: readonly GoldenCase[],
  verdictFn: RegressionVerdictFn,
  now: () => Date = () => new Date()
): Promise<RegressionReport> {
  const results: CaseResult[] = [];

  for (const c of cases) {
    const tol = c.confidenceTolerance ?? 0.05;
    try {
      const actual = await Promise.resolve(verdictFn(c.features));
      const verdictMatch = actual.verdict === c.expectedVerdict;
      const confidenceMatch =
        c.expectedConfidence === undefined ||
        Math.abs(actual.confidence - c.expectedConfidence) <= tol;
      results.push({
        id: c.id,
        description: c.description,
        expectedVerdict: c.expectedVerdict,
        actualVerdict: actual.verdict,
        expectedConfidence: c.expectedConfidence ?? null,
        actualConfidence: actual.confidence,
        verdictMatch,
        confidenceMatch,
        pass: verdictMatch && confidenceMatch,
        regulatoryAnchor: c.regulatoryAnchor,
      });
    } catch (err) {
      results.push({
        id: c.id,
        description: `THREW: ${err instanceof Error ? err.message : String(err)}`,
        expectedVerdict: c.expectedVerdict,
        actualVerdict: 'pass',
        expectedConfidence: c.expectedConfidence ?? null,
        actualConfidence: 0,
        verdictMatch: false,
        confidenceMatch: false,
        pass: false,
        regulatoryAnchor: c.regulatoryAnchor,
      });
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const pass = passed === results.length;

  return {
    schemaVersion: 1,
    runAtIso: now().toISOString(),
    totalCases: cases.length,
    passedCases: passed,
    failedCases: cases.length - passed,
    results,
    pass,
    summary: pass
      ? `Regression PASS — ${passed}/${cases.length} golden cases match.`
      : `Regression FAIL — ${cases.length - passed} of ${cases.length} golden cases drifted.`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 MEASURE-4',
      'EU AI Act Art.15',
    ],
  };
}

/**
 * Produce a plain-text diff of the regression report suitable for
 * the CI console.
 */
export function formatRegressionReport(report: RegressionReport): string {
  const lines: string[] = [];
  lines.push('='.repeat(60));
  lines.push(`HAWKEYE STERLING — Regression Report`);
  lines.push(`Run at: ${report.runAtIso}`);
  lines.push(`Result: ${report.pass ? 'PASS' : 'FAIL'} (${report.passedCases}/${report.totalCases})`);
  lines.push('='.repeat(60));
  for (const r of report.results) {
    const marker = r.pass ? '✓' : '✗';
    lines.push(`${marker} ${r.id.padEnd(24)} ${r.expectedVerdict}→${r.actualVerdict} ${r.description}`);
    if (!r.pass) {
      if (!r.verdictMatch) {
        lines.push(`    verdict drift: expected ${r.expectedVerdict}, got ${r.actualVerdict}`);
      }
      if (!r.confidenceMatch) {
        lines.push(
          `    confidence drift: expected ${r.expectedConfidence}, got ${r.actualConfidence.toFixed(3)}`
        );
      }
    }
  }
  lines.push('='.repeat(60));
  lines.push(report.summary);
  return lines.join('\n');
}
