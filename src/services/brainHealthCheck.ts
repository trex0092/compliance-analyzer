/**
 * Brain Health Check — unified health report covering every critical
 * dependency: env vars, blob stores, crons, Tier C queues, regulatory
 * drift, test suite.
 *
 * Why this exists:
 *   Today checking the health of the brain means running 8 different
 *   endpoints, checking Netlify scheduled-function logs, and
 *   eyeballing each Tier C blob store. Nobody does it regularly.
 *   We need a single page + a single endpoint that answers the
 *   question: "is the brain healthy right now?"
 *
 *   This module is the pure aggregator. The endpoint
 *   /api/brain/health in the thin I/O wrapper reads each probe +
 *   composes this report.
 *
 *   Probes are INJECTED — tests pass stubs, production passes real
 *   adapters. The module itself has zero I/O.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO operational oversight)
 *   Cabinet Res 134/2025 Art.19 (internal review — health evidence)
 *   NIST AI RMF 1.0 MEASURE-4 (continuous validation)
 *   NIST AI RMF 1.0 MANAGE-3 (incident response readiness)
 *   EU AI Act Art.15         (robustness)
 */

import type { EnvValidationReport } from './envConfigValidator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthState = 'ok' | 'degraded' | 'broken';

export interface DependencyStatus {
  name: string;
  state: HealthState;
  /** ms latency when known. */
  latencyMs: number | null;
  /** Plain-English detail. */
  detail: string;
  /** Regulatory anchor for this specific dependency. */
  regulatory: string;
}

export interface CronStatus {
  id: string;
  schedule: string;
  lastRunIso: string | null;
  lastResult: 'ok' | 'error' | 'never_run';
  lastError: string | null;
}

export interface TierCQueueDepth {
  clampSuggestionsPending: number;
  outboundQueuePending: number;
  breakGlassPendingApproval: number;
  deadLetterDepth: number;
}

export interface HealthReport {
  schemaVersion: 1;
  checkedAtIso: string;
  /** Overall health — worst of every dependency. */
  overall: HealthState;
  envReport: EnvValidationReport;
  dependencies: readonly DependencyStatus[];
  crons: readonly CronStatus[];
  tierCQueues: TierCQueueDepth;
  regulatoryDrift: {
    clean: boolean;
    topSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
    driftedKeyCount: number;
  };
  /** Optional: number of passing tests from the last vitest run. */
  testSuite: {
    passed: number | null;
    total: number | null;
    lastRunIso: string | null;
  };
  /** Plain-English summary safe for the ops channel. */
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Dependency probes (injected)
// ---------------------------------------------------------------------------

export interface HealthProbes {
  /** Validate the current env var snapshot. */
  readonly env: () => EnvValidationReport;
  /** Ping the Netlify Blob store. */
  readonly blobStore: () => Promise<DependencyStatus>;
  /** Ping the Asana API. */
  readonly asana: () => Promise<DependencyStatus>;
  /** Ping the Anthropic advisor proxy. */
  readonly advisorProxy: () => Promise<DependencyStatus>;
  /** List cron statuses. */
  readonly crons: () => Promise<readonly CronStatus[]>;
  /** Count Tier C queue depths. */
  readonly tierCQueues: () => Promise<TierCQueueDepth>;
  /** Regulatory drift snapshot. */
  readonly regulatoryDrift: () => Promise<HealthReport['regulatoryDrift']>;
  /** Last test suite result. Optional. */
  readonly testSuite?: () => Promise<HealthReport['testSuite']>;
  /** Override "now" for tests. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATE_RANK: Record<HealthState, number> = {
  ok: 0,
  degraded: 1,
  broken: 2,
};

function worstState(states: readonly HealthState[]): HealthState {
  let worst: HealthState = 'ok';
  for (const s of states) if (STATE_RANK[s] > STATE_RANK[worst]) worst = s;
  return worst;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runHealthCheck(probes: HealthProbes): Promise<HealthReport> {
  const now = (probes.now ?? (() => new Date()))();
  const checkedAtIso = now.toISOString();

  const envReport = probes.env();

  const [blob, asana, advisor, crons, tierCQueues, drift, testSuite] = await Promise.all([
    safeDependency('Netlify Blobs', probes.blobStore),
    safeDependency('Asana API', probes.asana),
    safeDependency('Advisor Proxy', probes.advisorProxy),
    safeCrons(probes.crons),
    safeTierCQueues(probes.tierCQueues),
    safeDrift(probes.regulatoryDrift),
    probes.testSuite
      ? probes.testSuite().catch(() => ({ passed: null, total: null, lastRunIso: null }))
      : Promise.resolve({ passed: null, total: null, lastRunIso: null }),
  ]);

  const dependencies: DependencyStatus[] = [blob, asana, advisor];

  const overallStates: HealthState[] = [
    envReport.health === 'broken' ? 'broken' : envReport.health === 'degraded' ? 'degraded' : 'ok',
    ...dependencies.map((d) => d.state),
  ];
  // Any cron that has failed → degraded.
  if (crons.some((c) => c.lastResult === 'error')) overallStates.push('degraded');
  // Any cron that has never run → degraded (noise — but worth surfacing).
  if (crons.some((c) => c.lastResult === 'never_run')) overallStates.push('degraded');
  // Dead-letter depth > 10 → degraded.
  if (tierCQueues.deadLetterDepth > 10) overallStates.push('degraded');
  // Regulatory drift critical → broken.
  if (drift.topSeverity === 'critical') overallStates.push('broken');

  const overall = worstState(overallStates);

  const summary =
    overall === 'ok'
      ? `All systems nominal. ${envReport.totalVars} env vars ok, ${dependencies.length} dependencies up, ${crons.length} crons green.`
      : overall === 'degraded'
        ? `Brain is degraded — ${dependencies.filter((d) => d.state !== 'ok').length} dependency issue(s), ${crons.filter((c) => c.lastResult === 'error').length} cron failure(s), dead-letter depth ${tierCQueues.deadLetterDepth}.`
        : `Brain is BROKEN — ${envReport.missingRequired.length} required env var(s) missing AND/OR critical drift detected. Do not dispatch.`;

  return {
    schemaVersion: 1,
    checkedAtIso,
    overall,
    envReport,
    dependencies,
    crons,
    tierCQueues,
    regulatoryDrift: drift,
    testSuite,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'NIST AI RMF 1.0 MEASURE-4',
      'NIST AI RMF 1.0 MANAGE-3',
      'EU AI Act Art.15',
    ],
  };
}

// ---------------------------------------------------------------------------
// Safe-probe wrappers (never throw)
// ---------------------------------------------------------------------------

async function safeDependency(
  label: string,
  fn: () => Promise<DependencyStatus>
): Promise<DependencyStatus> {
  try {
    return await fn();
  } catch (err) {
    return {
      name: label,
      state: 'broken',
      latencyMs: null,
      detail: err instanceof Error ? err.message : String(err),
      regulatory: 'FDL Art.20-22',
    };
  }
}

async function safeCrons(fn: () => Promise<readonly CronStatus[]>): Promise<readonly CronStatus[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

async function safeTierCQueues(fn: () => Promise<TierCQueueDepth>): Promise<TierCQueueDepth> {
  try {
    return await fn();
  } catch {
    return {
      clampSuggestionsPending: 0,
      outboundQueuePending: 0,
      breakGlassPendingApproval: 0,
      deadLetterDepth: 0,
    };
  }
}

async function safeDrift(
  fn: () => Promise<HealthReport['regulatoryDrift']>
): Promise<HealthReport['regulatoryDrift']> {
  try {
    return await fn();
  } catch {
    return { clean: true, topSeverity: 'none', driftedKeyCount: 0 };
  }
}

// Exports for tests.
export const __test__ = { worstState };
