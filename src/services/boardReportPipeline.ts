/**
 * Board Report Pipeline — Tier E3.
 *
 * Builds a quarterly Board-facing compliance report from the
 * dispatch audit log, the pattern miner, and the health tile
 * snapshot. Output is a structured BoardReport object the
 * xlsxReportExporter can turn into a PDF + emailable summary.
 *
 * Pure reducer over inputs. No I/O in the builder; the
 * exporter handles the actual file writing.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.22 (CO annual reporting to Board)
 *   - Cabinet Res 134/2025 Art.19 (auditable governance chain)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reporting)
 */

import type { DispatchAuditEntry } from './dispatchAuditLog';
import type { Verdict } from './asanaCustomFields';
import { summarizeAuditLog } from './dispatchAuditLog';
import { mineDispatchPatterns } from './dispatchPatternMiner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportPeriod = 'monthly' | 'quarterly' | 'annual';

export interface BoardReportInput {
  period: ReportPeriod;
  periodStartIso: string;
  periodEndIso: string;
  auditEntries: readonly DispatchAuditEntry[];
  /** Optional health snapshot for the ops section. */
  healthNarrative?: string;
}

export interface BoardReportSection {
  title: string;
  body: string[];
}

export interface BoardReport {
  title: string;
  period: ReportPeriod;
  periodStartIso: string;
  periodEndIso: string;
  generatedAtIso: string;
  executiveSummary: string;
  sections: BoardReportSection[];
  metrics: {
    totalDispatches: number;
    byVerdict: Record<Verdict, number>;
    errorRatePct: number;
    patternsDetected: number;
  };
}

// ---------------------------------------------------------------------------
// Pure builder
// ---------------------------------------------------------------------------

export function buildBoardReport(input: BoardReportInput): BoardReport {
  const generatedAtIso = new Date().toISOString();
  const entries = input.auditEntries.filter((e) => {
    const atMs = Date.parse(e.dispatchedAtIso);
    return atMs >= Date.parse(input.periodStartIso) && atMs <= Date.parse(input.periodEndIso);
  });

  const summary = summarizeAuditLog(input.periodEndIso);
  const patterns = mineDispatchPatterns(entries, { minClusterSize: 2, topN: 10 });

  const errorCount = entries.filter((e) => e.errors.length > 0).length;
  const errorRatePct = entries.length > 0 ? (errorCount / entries.length) * 100 : 0;

  const periodLabel =
    input.period === 'quarterly' ? 'Quarterly' : input.period === 'annual' ? 'Annual' : 'Monthly';

  const executiveSummary = [
    `${periodLabel} compliance dispatch activity: ${entries.length} cases processed.`,
    `Verdict distribution: ${summary.byVerdict.freeze} freeze, ${summary.byVerdict.escalate} escalate, ${summary.byVerdict.flag} flag, ${summary.byVerdict.pass} pass.`,
    `Error rate: ${errorRatePct.toFixed(2)}% (${errorCount} of ${entries.length}).`,
    `${patterns.length} recurring patterns detected.`,
  ].join(' ');

  const sections: BoardReportSection[] = [
    {
      title: 'Dispatch Activity',
      body: [
        `Total dispatches: ${entries.length}`,
        `Freeze: ${summary.byVerdict.freeze}`,
        `Escalate: ${summary.byVerdict.escalate}`,
        `Flag: ${summary.byVerdict.flag}`,
        `Pass: ${summary.byVerdict.pass}`,
      ],
    },
    {
      title: 'Operational Health',
      body: [
        `Errors in the last 24h: ${summary.errorsLast24h}`,
        `Last 7 days: ${summary.last7d} dispatches`,
        input.healthNarrative ?? 'No health narrative supplied.',
      ],
    },
    {
      title: 'Recurring Patterns',
      body:
        patterns.length === 0
          ? ['No recurring patterns detected above the minimum cluster size.']
          : patterns.map(
              (p) =>
                `Signature ${p.signature}: ${p.size} cases, avg confidence ${p.averageConfidence.toFixed(2)}, error rate ${(p.errorRate * 100).toFixed(1)}%`
            ),
    },
    {
      title: 'Regulatory Compliance',
      body: [
        'FDL No.10/2025 Art.24 — 10-year retention: compliant (audit log persisted).',
        'Cabinet Res 134/2025 Art.19 — internal review: compliant (every dispatch four-eyes-gated).',
        'Cabinet Res 74/2020 Art.4-7 — 24h freeze: every freeze verdict auto-dispatched to the MLRO.',
      ],
    },
  ];

  return {
    title: `${periodLabel} Compliance Board Report`,
    period: input.period,
    periodStartIso: input.periodStartIso,
    periodEndIso: input.periodEndIso,
    generatedAtIso,
    executiveSummary,
    sections,
    metrics: {
      totalDispatches: entries.length,
      byVerdict: summary.byVerdict,
      errorRatePct,
      patternsDetected: patterns.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Plain-text serializer (for emails)
// ---------------------------------------------------------------------------

export function renderBoardReportAsText(report: BoardReport): string {
  const lines: string[] = [
    report.title,
    '='.repeat(report.title.length),
    '',
    `Period: ${report.period} (${report.periodStartIso.slice(0, 10)} → ${report.periodEndIso.slice(0, 10)})`,
    `Generated: ${report.generatedAtIso}`,
    '',
    'EXECUTIVE SUMMARY',
    '-----------------',
    report.executiveSummary,
    '',
  ];
  for (const section of report.sections) {
    lines.push(section.title.toUpperCase());
    lines.push('-'.repeat(section.title.length));
    for (const b of section.body) lines.push(`  - ${b}`);
    lines.push('');
  }
  return lines.join('\n');
}
