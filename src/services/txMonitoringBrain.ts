/**
 * TM Monitoring Brain — orchestrator that composes the rule engine
 * + typology matcher (and future statistical layer) into a single
 * `TmVerdictRecord` per customer.
 *
 * Why this exists:
 *   The rule engine and the typology matcher each return a flat list
 *   of findings. The orchestrator is the place where we:
 *
 *     1. Partition findings by customer
 *     2. Dedupe (same finding reached via multiple paths)
 *     3. Compute the rolled-up TmVerdict + top severity
 *     4. Compute the STR filing deadline when verdict === 'auto-str'
 *     5. Emit a stable TmVerdictRecord for the Asana dispatcher +
 *        audit log
 *
 *   Pure function. No I/O. The caller (future cron + UI) injects
 *   the transaction batch + today's date + options.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.15, Art.26-27
 *   Cabinet Res 134/2025 Art.14
 *   FATF Rec 10, 11, 20, 21
 *   MoE Circular 08/AML/2021
 */

import {
  rollUpVerdict,
  topSeverityOf,
  type TmFinding,
  type TmVerdictRecord,
  type Transaction,
} from '../domain/transaction';
import { STR_FILING_DEADLINE_BUSINESS_DAYS } from '../domain/constants';
import { runRuleEngine, type RuleEngineOptions } from './txMonitoringRuleEngine';
import { runStatisticalLayer, type StatisticalLayerOptions } from './txStatisticalLayer';
import { runTypologyMatcher, type TypologyOptions } from './txTypologyMatcher';

// ---------------------------------------------------------------------------
// Business-day arithmetic for the STR filing deadline
// ---------------------------------------------------------------------------

/**
 * Add N business days to a date. Weekends in UAE are Saturday +
 * Sunday (per FDL Art.24 and Cabinet Res 134/2025 Art.19 —
 * government working week since January 2022). Public holidays
 * are NOT handled here; the caller can wrap with the existing
 * `src/utils/businessDays.ts` helper for the real gazette list.
 * Pure function.
 */
export function addBusinessDaysUae(from: Date, businessDays: number): Date {
  const d = new Date(from.getTime());
  let remaining = businessDays;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}

function formatDdMmYyyy(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface TmBrainOptions {
  readonly ruleEngine?: RuleEngineOptions;
  readonly typology?: TypologyOptions;
  readonly statistical?: StatisticalLayerOptions;
  /**
   * The "as of" date for STR deadline computation. Tests inject a
   * fixed date. Defaults to `new Date()`.
   */
  readonly asOf?: Date;
  /**
   * Window start/end override. If omitted, the orchestrator uses
   * the earliest and latest `atIso` across the batch.
   */
  readonly windowStartIso?: string;
  readonly windowEndIso?: string;
}

/**
 * Run the TM brain over a single customer's transaction window.
 * Returns one `TmVerdictRecord` for that customer. Pure.
 *
 * Contract:
 *   - All transactions must belong to the same customer. Mixed
 *     batches are not an error but will collapse into one record
 *     keyed by the first transaction's customerId (use
 *     `runTmBrainAllCustomers` for multi-customer batches).
 *   - Empty batch → verdict='pass', scannedTxCount=0, findings=[].
 */
export function runTmBrain(
  transactions: readonly Transaction[],
  options: TmBrainOptions = {}
): TmVerdictRecord {
  const asOf = options.asOf ?? new Date();
  const customerId = transactions[0]?.customerId ?? '';

  const ruleFindings = runRuleEngine(transactions, options.ruleEngine);
  const typologyFindings = runTypologyMatcher(transactions, options.typology);
  const statisticalFindings = runStatisticalLayer(transactions, options.statistical);

  // Dedupe by finding.id — if multiple layers produce a finding with
  // the same id (same customer, same kind, same tx cluster), keep
  // the first one. Order: rules → typology → statistical, so hard
  // threshold hits take precedence over statistical flags for the
  // same transactions.
  const seen = new Set<string>();
  const allFindings: TmFinding[] = [];
  for (const f of [...ruleFindings, ...typologyFindings, ...statisticalFindings]) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    allFindings.push(f);
  }

  const verdict = rollUpVerdict(allFindings);
  const top = topSeverityOf(allFindings);

  // Window bounds — earliest and latest atIso.
  let windowStart = options.windowStartIso ?? '';
  let windowEnd = options.windowEndIso ?? '';
  if ((!windowStart || !windowEnd) && transactions.length > 0) {
    const timestamps = transactions
      .map((t) => Date.parse(t.atIso))
      .filter((ms) => !Number.isNaN(ms))
      .sort((a, b) => a - b);
    if (!windowStart && timestamps.length > 0) {
      windowStart = new Date(timestamps[0]!).toISOString();
    }
    if (!windowEnd && timestamps.length > 0) {
      windowEnd = new Date(timestamps[timestamps.length - 1]!).toISOString();
    }
  }

  const strDeadline =
    verdict === 'auto-str'
      ? formatDdMmYyyy(addBusinessDaysUae(asOf, STR_FILING_DEADLINE_BUSINESS_DAYS))
      : undefined;

  const summary =
    allFindings.length === 0
      ? `PASS: ${transactions.length} transaction(s) scanned, no TM findings.`
      : `${verdict.toUpperCase()}: ${allFindings.length} finding(s) across ${transactions.length} transaction(s), top severity=${top}. ${
          verdict === 'auto-str'
            ? `STR filing deadline: ${strDeadline} — file without delay (FDL Art.26-27).`
            : ''
        }`.trim();

  return {
    schemaVersion: 1,
    customerId,
    evaluatedAtIso: asOf.toISOString(),
    windowStartIso: windowStart || asOf.toISOString(),
    windowEndIso: windowEnd || asOf.toISOString(),
    scannedTxCount: transactions.length,
    verdict,
    findings: allFindings,
    topSeverity: top,
    strFilingDeadlineDdMmYyyy: strDeadline,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.15',
      'FDL No.10/2025 Art.16',
      'FDL No.10/2025 Art.26-27',
      'Cabinet Res 134/2025 Art.14',
      'MoE Circular 08/AML/2021',
      'FATF Rec 10',
      'FATF Rec 20',
      'FATF Rec 21',
    ],
  };
}

/**
 * Run the TM brain over a multi-customer transaction batch. Groups
 * by `customerId` and returns one `TmVerdictRecord` per customer.
 * Pure.
 */
export function runTmBrainAllCustomers(
  transactions: readonly Transaction[],
  options: TmBrainOptions = {}
): readonly TmVerdictRecord[] {
  const byCustomer = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const list = byCustomer.get(tx.customerId) ?? [];
    list.push(tx);
    byCustomer.set(tx.customerId, list);
  }
  const out: TmVerdictRecord[] = [];
  for (const batch of byCustomer.values()) {
    out.push(runTmBrain(batch, options));
  }
  return out;
}
