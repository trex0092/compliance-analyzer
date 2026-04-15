/**
 * Load Test Harness — concurrency-bounded driver for running N
 * synthetic cases against the brain and emitting a latency / error
 * profile.
 *
 * Why this exists:
 *   The brain is deployed on Netlify. Netlify functions have cold-
 *   start + concurrent invocation limits. We need a harness that
 *   can realistically simulate production burst traffic and
 *   capture where the first breakpoint is.
 *
 *   Pure driver with respect to the verdict function. Tests inject
 *   a stub; production (a CLI under scripts/) injects a real HTTP
 *   caller.
 *
 * Regulatory basis:
 *   NIST AI RMF 1.0 MEASURE-4 (performance validation)
 *   EU AI Act Art.15         (robustness under load)
 *   ISO/IEC 27001 A.17       (business continuity)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadTestCase {
  id: string;
  features: Readonly<Record<string, number>>;
}

export type LoadVerdictFn = (
  caseInput: LoadTestCase
) => Promise<{ ok: boolean; latencyMs: number; errorMessage?: string }>;

export interface LoadTestOptions {
  /** Concurrent in-flight calls. Default 10. */
  concurrency?: number;
  /** Max total duration in ms before the harness aborts. Default 60s. */
  maxDurationMs?: number;
  /** Override "now" for tests. */
  now?: () => number;
}

export interface CallResult {
  caseId: string;
  ok: boolean;
  latencyMs: number;
  errorMessage: string | null;
}

export interface LatencyHistogram {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

export interface LoadTestReport {
  schemaVersion: 1;
  totalCases: number;
  completedCases: number;
  successfulCases: number;
  failedCases: number;
  durationMs: number;
  throughputPerSec: number;
  latency: LatencyHistogram;
  errors: ReadonlyArray<{ caseId: string; message: string }>;
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

// ---------------------------------------------------------------------------
// Concurrency controller
// ---------------------------------------------------------------------------

export async function runLoadTest(
  cases: readonly LoadTestCase[],
  verdictFn: LoadVerdictFn,
  opts: LoadTestOptions = {}
): Promise<LoadTestReport> {
  const concurrency = Math.max(1, opts.concurrency ?? 10);
  const maxDurationMs = opts.maxDurationMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());

  const startedAt = now();
  const results: CallResult[] = [];
  let nextIndex = 0;
  let abortReason: string | null = null;

  async function worker(): Promise<void> {
    while (true) {
      if (abortReason) return;
      const i = nextIndex++;
      if (i >= cases.length) return;
      if (now() - startedAt > maxDurationMs) {
        abortReason = 'max_duration_exceeded';
        return;
      }
      const c = cases[i]!;
      try {
        const r = await verdictFn(c);
        results.push({
          caseId: c.id,
          ok: r.ok,
          latencyMs: r.latencyMs,
          errorMessage: r.errorMessage ?? null,
        });
      } catch (err) {
        results.push({
          caseId: c.id,
          ok: false,
          latencyMs: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);

  const finishedAt = now();
  const durationMs = finishedAt - startedAt;

  // Build latency histogram.
  const latencies = results
    .filter((r) => r.ok)
    .map((r) => r.latencyMs)
    .sort((a, b) => a - b);
  const latency: LatencyHistogram = {
    p50: percentile(latencies, 50),
    p90: percentile(latencies, 90),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[latencies.length - 1] ?? 0,
  };

  const successful = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const throughput = durationMs > 0 ? (results.length / durationMs) * 1000 : 0;

  const errors = results
    .filter((r) => !r.ok)
    .map((r) => ({ caseId: r.caseId, message: r.errorMessage ?? 'unknown' }));

  return {
    schemaVersion: 1,
    totalCases: cases.length,
    completedCases: results.length,
    successfulCases: successful,
    failedCases: failed,
    durationMs,
    throughputPerSec: throughput,
    latency,
    errors,
    summary:
      `Ran ${results.length}/${cases.length} cases in ${durationMs}ms ` +
      `(${throughput.toFixed(1)} req/s). ` +
      `p50=${latency.p50}ms p95=${latency.p95}ms. ` +
      `${successful} ok / ${failed} failed.`,
    regulatory: [
      'NIST AI RMF 1.0 MEASURE-4',
      'EU AI Act Art.15',
      'ISO/IEC 27001 A.17',
    ],
  };
}
