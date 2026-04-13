/**
 * MLRO Performance Metrics.
 *
 * Aggregates a stream of compliance decisions + four-eyes events +
 * STR filings into the per-MLRO KPIs that auditors and senior
 * management actually care about:
 *
 *   - Median + p95 decision latency (case-opened → final verdict)
 *   - Average four-eyes turnaround time (first approval → second)
 *   - STR draft → file time (draft saved → goAML reference attached)
 *   - Screening volume per MLRO seat
 *   - Per-verdict distribution
 *
 * Pure compute. No I/O. The MLRO dashboard reads its data from the
 * Netlify Blobs audit stores and feeds it here for reporting.
 */

import type { ComplianceDecision } from './complianceDecisionEngine';

export interface MlroEvent {
  /** Hashed MLRO id — never the cleartext username. */
  mlroIdHash: string;
  /** ISO timestamp the event landed. */
  at: string;
  kind: 'decision' | 'four-eyes-first' | 'four-eyes-second' | 'str-draft' | 'str-filed';
  /** Verdict, when kind === 'decision'. */
  verdict?: ComplianceDecision['verdict'];
  /** Latency in ms from the case being opened to this event. */
  latencyMs?: number;
  /** Tenant scope. */
  tenantId: string;
  /** STR / approval / case id this event refers to. */
  refId?: string;
}

export interface MlroMetrics {
  mlroIdHash: string;
  totalDecisions: number;
  decisionLatency: {
    medianMs: number;
    p95Ms: number;
  };
  fourEyesTurnaroundMs: {
    medianMs: number;
    p95Ms: number;
  };
  strDraftToFileMs: {
    medianMs: number;
    p95Ms: number;
  };
  verdictDistribution: Record<ComplianceDecision['verdict'], number>;
}

export interface PortfolioMetrics {
  windowFromIso: string;
  windowToIso: string;
  totalEvents: number;
  perMlro: MlroMetrics[];
  /** Aggregated across every MLRO. */
  aggregate: {
    totalDecisions: number;
    decisionLatency: { medianMs: number; p95Ms: number };
    verdictDistribution: Record<ComplianceDecision['verdict'], number>;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

function p95(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return quantile(sorted, 0.95);
}

function emptyVerdictDistribution(): Record<ComplianceDecision['verdict'], number> {
  return { pass: 0, flag: 0, escalate: 0, freeze: 0 };
}

/**
 * Produce per-MLRO and aggregate metrics for a window of events.
 * `events` does not need to be sorted — the function sorts internally.
 */
export function computeMlroMetrics(events: readonly MlroEvent[]): PortfolioMetrics {
  if (events.length === 0) {
    const now = new Date().toISOString();
    return {
      windowFromIso: now,
      windowToIso: now,
      totalEvents: 0,
      perMlro: [],
      aggregate: {
        totalDecisions: 0,
        decisionLatency: { medianMs: 0, p95Ms: 0 },
        verdictDistribution: emptyVerdictDistribution(),
      },
    };
  }

  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : 1));
  const windowFromIso = sorted[0].at;
  const windowToIso = sorted[sorted.length - 1].at;

  // Group by MLRO.
  const byMlro = new Map<string, MlroEvent[]>();
  for (const ev of sorted) {
    const list = byMlro.get(ev.mlroIdHash) ?? [];
    list.push(ev);
    byMlro.set(ev.mlroIdHash, list);
  }

  const perMlro: MlroMetrics[] = [];
  for (const [mlroIdHash, mlroEvents] of byMlro) {
    const decisions = mlroEvents.filter((e) => e.kind === 'decision');
    const decisionLatencies = decisions.map((e) => e.latencyMs ?? 0).filter((n) => n > 0);

    // Pair four-eyes-first and four-eyes-second by refId so we can
    // compute the turnaround time between them.
    const firstByRef = new Map<string, number>();
    const turnarounds: number[] = [];
    for (const e of mlroEvents) {
      if (!e.refId) continue;
      if (e.kind === 'four-eyes-first') {
        firstByRef.set(e.refId, new Date(e.at).getTime());
      } else if (e.kind === 'four-eyes-second') {
        const firstTs = firstByRef.get(e.refId);
        if (firstTs !== undefined) {
          turnarounds.push(new Date(e.at).getTime() - firstTs);
          firstByRef.delete(e.refId);
        }
      }
    }

    // Pair str-draft and str-filed by refId for STR turnaround.
    const draftByRef = new Map<string, number>();
    const strDraftToFile: number[] = [];
    for (const e of mlroEvents) {
      if (!e.refId) continue;
      if (e.kind === 'str-draft') {
        draftByRef.set(e.refId, new Date(e.at).getTime());
      } else if (e.kind === 'str-filed') {
        const ts = draftByRef.get(e.refId);
        if (ts !== undefined) {
          strDraftToFile.push(new Date(e.at).getTime() - ts);
          draftByRef.delete(e.refId);
        }
      }
    }

    const dist = emptyVerdictDistribution();
    for (const d of decisions) {
      if (d.verdict) dist[d.verdict]++;
    }

    perMlro.push({
      mlroIdHash,
      totalDecisions: decisions.length,
      decisionLatency: {
        medianMs: Math.round(median(decisionLatencies)),
        p95Ms: Math.round(p95(decisionLatencies)),
      },
      fourEyesTurnaroundMs: {
        medianMs: Math.round(median(turnarounds)),
        p95Ms: Math.round(p95(turnarounds)),
      },
      strDraftToFileMs: {
        medianMs: Math.round(median(strDraftToFile)),
        p95Ms: Math.round(p95(strDraftToFile)),
      },
      verdictDistribution: dist,
    });
  }

  // Aggregate latency + verdict distribution across the whole window.
  const aggregateLatencies: number[] = [];
  const aggregateDist = emptyVerdictDistribution();
  let aggregateDecisions = 0;
  for (const ev of sorted) {
    if (ev.kind !== 'decision') continue;
    aggregateDecisions++;
    if (ev.verdict) aggregateDist[ev.verdict]++;
    if (typeof ev.latencyMs === 'number' && ev.latencyMs > 0) {
      aggregateLatencies.push(ev.latencyMs);
    }
  }

  return {
    windowFromIso,
    windowToIso,
    totalEvents: events.length,
    perMlro: perMlro.sort((a, b) => b.totalDecisions - a.totalDecisions),
    aggregate: {
      totalDecisions: aggregateDecisions,
      decisionLatency: {
        medianMs: Math.round(median(aggregateLatencies)),
        p95Ms: Math.round(p95(aggregateLatencies)),
      },
      verdictDistribution: aggregateDist,
    },
  };
}
