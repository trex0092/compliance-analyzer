/**
 * Trading Report Dispatcher — Sends daily trading reports to Asana.
 *
 * Follows the existing daily-heartbeat pattern from scheduled-screening:
 *   1. Generate report data from the trading brain
 *   2. Format as Asana task notes (rich text) + HTML + JSON
 *   3. Create Asana task in the TRADING project
 *   4. Attach HTML and JSON reports as files
 *
 * Environment variables:
 *   ASANA_TOKEN                 — Personal Access Token
 *   ASANA_TRADING_PROJECT_GID   — GID of the TRADING project in Asana
 *   ASANA_WORKSPACE_GID         — Workspace GID (for custom fields)
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (5yr record retention — reports are the audit trail)
 *   - MoE Circular 08/AML/2021 (AED 55K threshold monitoring in every report)
 *   - LBMA RGG v9 (responsible gold — daily origin traceability)
 */

import { createAsanaTask, isAsanaConfigured } from '../asanaClient';
import type { AsanaTaskPayload } from '../asanaClient';
import type { MetalsTradingBrain } from './metalsTradingBrain';
import {
  generateDailyReport,
  formatAsanaTaskNotes,
  formatHTMLReport,
  formatJSONReport,
} from './tradingDailyReport';
import type { TradingDailyReportData } from './tradingDailyReport';

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Resolve the trading project GID.
 * Browser: localStorage 'asanaTradingProjectId'
 * Server:  process.env.ASANA_TRADING_PROJECT_GID
 * Fallback: the default compliance project
 */
function getTradingProjectGid(): string {
  const fromStorage =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('asanaTradingProjectId')
      : null;

  const fromEnv =
    typeof process !== 'undefined' && process.env?.ASANA_TRADING_PROJECT_GID
      ? process.env.ASANA_TRADING_PROJECT_GID
      : null;

  // User-provided Asana project for TRADING
  // https://app.asana.com/1/1213645083721316/project/1213914392047122
  return fromStorage ?? fromEnv ?? '1213914392047122';
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

export interface DispatchResult {
  ok: boolean;
  taskGid?: string;
  reportId: string;
  error?: string;
  report: TradingDailyReportData;
  asanaNotes: string;
  htmlReport: string;
  jsonReport: string;
}

/**
 * Generate and dispatch the daily trading report to Asana.
 *
 * Returns the full result including all three report formats
 * so callers can display, store, or attach them independently.
 */
export async function dispatchDailyTradingReport(
  brain: MetalsTradingBrain,
): Promise<DispatchResult> {
  // 1. Generate report
  const report = generateDailyReport(brain);
  const asanaNotes = formatAsanaTaskNotes(report);
  const htmlReport = formatHTMLReport(report);
  const jsonReport = formatJSONReport(report);

  // 2. Check Asana configuration
  if (!isAsanaConfigured()) {
    return {
      ok: false,
      reportId: report.reportId,
      error: 'Asana not configured — set token in Settings or ASANA_TOKEN env var',
      report,
      asanaNotes,
      htmlReport,
      jsonReport,
    };
  }

  // 3. Build task name
  const portfolio = report.portfolio;
  const pnlSign = portfolio.totalPnL >= 0 ? '+' : '';
  const pnlStr = `${pnlSign}$${Math.abs(portfolio.totalPnL).toFixed(0)}`;
  const alertCount = report.alerts.critical + report.alerts.high;
  const alertTag = alertCount > 0 ? ` | ${alertCount} alerts` : '';

  const taskName = `Trading Daily Report — ${report.reportDate} | P&L: ${pnlStr}${alertTag}`;

  // 4. Compute due date (today)
  const today = new Date();
  const dueOn = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 5. Create Asana task
  const projectGid = getTradingProjectGid();

  const payload: AsanaTaskPayload = {
    name: taskName,
    notes: asanaNotes,
    projects: [projectGid],
    due_on: dueOn,
  };

  const result = await createAsanaTask(payload);

  return {
    ok: result.ok,
    taskGid: result.gid,
    reportId: report.reportId,
    error: result.error,
    report,
    asanaNotes,
    htmlReport,
    jsonReport,
  };
}

/**
 * Generate the report without dispatching to Asana.
 * Useful for preview, local storage, or manual review.
 */
export function generateTradingReportBundle(brain: MetalsTradingBrain): {
  report: TradingDailyReportData;
  asanaNotes: string;
  htmlReport: string;
  jsonReport: string;
} {
  const report = generateDailyReport(brain);
  return {
    report,
    asanaNotes: formatAsanaTaskNotes(report),
    htmlReport: formatHTMLReport(report),
    jsonReport: formatJSONReport(report),
  };
}
