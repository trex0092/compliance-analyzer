/**
 * Inventory Reconciliation — physical stock vs book reconciliation.
 *
 * For a DPMS, inventory IS the business. An unexplained discrepancy
 * between the physical stock count and the book balance is either
 * theft, diversion, or an accounting error — all of which need to
 * surface fast.
 *
 * Design:
 *   - BookInventory: the ledger state (what we think we have)
 *   - PhysicalCount: the count performed by staff
 *   - reconcile(): compares the two, reports variance, flags outliers
 *
 * Variance thresholds:
 *   - < 0.1% by weight   → acceptable (rounding, scale drift)
 *   - 0.1 - 0.5%         → warning (investigation required)
 *   - > 0.5%             → critical (brain event + MLRO alert)
 *
 * Regulatory: MoE 08/AML/2021 (record keeping), FDL Art.21, LBMA RGG v9 Step 4.
 */

import type { Metal } from './fineness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InventoryLine {
  sku: string;
  description: string;
  metal: Metal;
  fineness: number;
  quantity: number;
  weightGramsEach: number;
  location: string;
}

export interface BookInventory {
  asOf: string;
  lines: InventoryLine[];
}

export interface PhysicalCount {
  countedAt: string;
  countedBy: string;
  witnessedBy?: string;
  lines: Array<{
    sku: string;
    location: string;
    actualQuantity: number;
    actualWeightGrams?: number;
  }>;
}

export type VarianceSeverity = 'acceptable' | 'warning' | 'critical';

export interface LineVariance {
  sku: string;
  description: string;
  location: string;
  metal: Metal;
  bookQuantity: number;
  actualQuantity: number;
  quantityDelta: number;
  bookWeightGrams: number;
  actualWeightGrams?: number;
  weightDeltaGrams: number;
  weightDeltaPct: number;
  severity: VarianceSeverity;
  rationale: string;
}

export interface ReconciliationReport {
  asOf: string;
  countedAt: string;
  countedBy: string;
  witnessedBy?: string;
  totalLines: number;
  variances: LineVariance[];
  criticalCount: number;
  warningCount: number;
  acceptableCount: number;
  /** Total missing weight (sum of negative variances across all lines). */
  totalMissingGrams: number;
  /** Total surplus weight (sum of positive variances). */
  totalSurplusGrams: number;
  /** Lines that exist in book but were not counted at all. */
  uncounted: string[];
  /** Lines found in the count but not in the book. */
  unknown: string[];
  requiresBrainEvent: boolean;
}

// ---------------------------------------------------------------------------
// Variance classification thresholds
// ---------------------------------------------------------------------------

const ACCEPTABLE_WEIGHT_PCT = 0.1;
const WARNING_WEIGHT_PCT = 0.5;

function classifyVariance(weightDeltaPct: number, quantityDelta: number): VarianceSeverity {
  const absPct = Math.abs(weightDeltaPct);
  // Any quantity mismatch is at least a warning — scale drift doesn't
  // explain a missing piece.
  if (quantityDelta !== 0 && absPct > WARNING_WEIGHT_PCT) return 'critical';
  if (quantityDelta !== 0) return 'warning';
  if (absPct > WARNING_WEIGHT_PCT) return 'critical';
  if (absPct > ACCEPTABLE_WEIGHT_PCT) return 'warning';
  return 'acceptable';
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export function reconcile(book: BookInventory, count: PhysicalCount): ReconciliationReport {
  // Index book by sku+location for O(1) lookup
  const bookMap = new Map<string, InventoryLine>();
  for (const line of book.lines) {
    bookMap.set(`${line.sku}|${line.location}`, line);
  }

  // Index count similarly
  const countMap = new Map<string, { actualQuantity: number; actualWeightGrams?: number }>();
  for (const line of count.lines) {
    countMap.set(`${line.sku}|${line.location}`, {
      actualQuantity: line.actualQuantity,
      actualWeightGrams: line.actualWeightGrams,
    });
  }

  const variances: LineVariance[] = [];
  const uncounted: string[] = [];
  let totalMissing = 0;
  let totalSurplus = 0;

  // Walk book entries — every book line should be in the count
  for (const line of book.lines) {
    const key = `${line.sku}|${line.location}`;
    const counted = countMap.get(key);
    const bookWeightGrams = line.quantity * line.weightGramsEach;

    if (!counted) {
      uncounted.push(key);
      continue;
    }

    const actualWeight = counted.actualWeightGrams ?? counted.actualQuantity * line.weightGramsEach;
    const weightDeltaGrams = actualWeight - bookWeightGrams;
    const weightDeltaPct = bookWeightGrams === 0 ? 0 : (weightDeltaGrams / bookWeightGrams) * 100;
    const quantityDelta = counted.actualQuantity - line.quantity;

    const severity = classifyVariance(weightDeltaPct, quantityDelta);

    if (weightDeltaGrams < 0) totalMissing += -weightDeltaGrams;
    else totalSurplus += weightDeltaGrams;

    const rationaleParts: string[] = [];
    if (quantityDelta !== 0) {
      rationaleParts.push(`quantity ${quantityDelta > 0 ? '+' : ''}${quantityDelta}`);
    }
    if (Math.abs(weightDeltaPct) > ACCEPTABLE_WEIGHT_PCT) {
      rationaleParts.push(`weight ${weightDeltaPct > 0 ? '+' : ''}${weightDeltaPct.toFixed(2)}%`);
    }
    const rationale = rationaleParts.length > 0 ? rationaleParts.join(', ') : 'within tolerance';

    variances.push({
      sku: line.sku,
      description: line.description,
      location: line.location,
      metal: line.metal,
      bookQuantity: line.quantity,
      actualQuantity: counted.actualQuantity,
      quantityDelta,
      bookWeightGrams,
      actualWeightGrams: counted.actualWeightGrams,
      weightDeltaGrams,
      weightDeltaPct,
      severity,
      rationale,
    });
  }

  // Count lines that aren't in the book = unknown surplus
  const unknown: string[] = [];
  for (const countedLine of count.lines) {
    const key = `${countedLine.sku}|${countedLine.location}`;
    if (!bookMap.has(key)) unknown.push(key);
  }

  const criticalCount = variances.filter((v) => v.severity === 'critical').length;
  const warningCount = variances.filter((v) => v.severity === 'warning').length;
  const acceptableCount = variances.filter((v) => v.severity === 'acceptable').length;

  return {
    asOf: book.asOf,
    countedAt: count.countedAt,
    countedBy: count.countedBy,
    witnessedBy: count.witnessedBy,
    totalLines: book.lines.length,
    variances,
    criticalCount,
    warningCount,
    acceptableCount,
    totalMissingGrams: Math.round(totalMissing * 1000) / 1000,
    totalSurplusGrams: Math.round(totalSurplus * 1000) / 1000,
    uncounted,
    unknown,
    requiresBrainEvent: criticalCount > 0 || uncounted.length > 0 || unknown.length > 0,
  };
}

/**
 * Build a brain-event payload from a reconciliation report. Only
 * called when `requiresBrainEvent` is true.
 */
export function reportToBrainEvent(report: ReconciliationReport): Record<string, unknown> {
  const severity: 'info' | 'medium' | 'high' | 'critical' =
    report.criticalCount > 0
      ? 'critical'
      : report.uncounted.length > 0 || report.unknown.length > 0
        ? 'high'
        : report.warningCount > 0
          ? 'medium'
          : 'info';

  return {
    kind: 'manual',
    severity,
    summary: `Inventory reconciliation at ${report.countedAt}: ${report.criticalCount} critical, ${report.warningCount} warning, ${report.totalMissingGrams.toFixed(1)}g missing, ${report.totalSurplusGrams.toFixed(1)}g surplus`,
    refId: `RECON-${report.countedAt.slice(0, 10)}`,
    meta: {
      source: 'inventory-reconciliation',
      countedBy: report.countedBy,
      witnessedBy: report.witnessedBy,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
      totalMissingGrams: report.totalMissingGrams,
      totalSurplusGrams: report.totalSurplusGrams,
      uncountedSkus: report.uncounted.slice(0, 20),
      unknownSkus: report.unknown.slice(0, 20),
    },
  };
}
