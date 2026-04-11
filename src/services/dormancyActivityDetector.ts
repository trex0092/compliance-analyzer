/**
 * Dormancy → Activity Detector — subsystem #46.
 *
 * Classic layering entry point: an account sits dormant for 90+ days
 * then suddenly transacts at volume. This subsystem scans a timeline
 * of transactions for each entity, computes the gap to the previous
 * transaction, and flags entities where (gap >= dormancy_days) AND
 * (subsequent_volume > N * historical_median).
 *
 * Pure function, deterministic. Default dormancy threshold is 90 days
 * per FATF Rec 10 (ongoing monitoring) and Cabinet Res 134/2025
 * Art.7-10 (CDD tiers imply re-review after 90-180 days for standard
 * customers).
 *
 * Regulatory basis:
 *   - FATF Rec 10 (ongoing CDD)
 *   - Cabinet Res 134/2025 Art.7-10 (CDD tiering)
 *   - MoE Circular 08/AML/2021 (transaction monitoring for DPMS)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DormancyTransaction {
  customerId: string;
  at: string; // ISO
  amountAED: number;
}

export interface DormancyConfig {
  dormancyDays?: number; // default 90
  volumeBurstMultiplier?: number; // default 5× median
  minTransactions?: number; // default 3 to avoid noise on new customers
}

export interface DormancyHit {
  customerId: string;
  gapDays: number;
  firstActivityAt: string;
  firstActivityAmountAED: number;
  historicalMedianAED: number;
  multiplier: number;
}

export interface DormancyReport {
  hits: DormancyHit[];
  checked: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectDormancyActivity(
  transactions: readonly DormancyTransaction[],
  config: DormancyConfig = {}
): DormancyReport {
  const dormancyDays = config.dormancyDays ?? 90;
  const multiplier = config.volumeBurstMultiplier ?? 5;
  const minTx = config.minTransactions ?? 3;

  // Group by customer
  const byCustomer = new Map<string, DormancyTransaction[]>();
  for (const tx of transactions) {
    const list = byCustomer.get(tx.customerId) ?? [];
    list.push(tx);
    byCustomer.set(tx.customerId, list);
  }

  const hits: DormancyHit[] = [];

  for (const [customerId, txs] of byCustomer) {
    if (txs.length < minTx) continue;
    // Sort by time
    const sorted = [...txs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    // Historical median BEFORE the current transaction
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const gapMs = Date.parse(curr.at) - Date.parse(prev.at);
      const gapDays = gapMs / 86_400_000;
      if (gapDays < dormancyDays) continue;

      const historical = sorted.slice(0, i).map((t) => t.amountAED);
      if (historical.length < minTx - 1) continue; // need a baseline
      const median = computeMedian(historical);
      if (median <= 0) continue;

      const currAmountVsMedian = curr.amountAED / median;
      if (currAmountVsMedian >= multiplier) {
        hits.push({
          customerId,
          gapDays: Math.round(gapDays),
          firstActivityAt: curr.at,
          firstActivityAmountAED: curr.amountAED,
          historicalMedianAED: Math.round(median),
          multiplier: Math.round(currAmountVsMedian * 10) / 10,
        });
        break; // only report the first hit per customer
      }
    }
  }

  const narrative =
    hits.length === 0
      ? `Dormancy-activity detector: 0 hits across ${byCustomer.size} customer(s).`
      : `Dormancy-activity detector: ${hits.length} customer(s) exhibited dormant-then-burst patterns ` +
        `(${hits
          .slice(0, 3)
          .map((h) => `${h.customerId}@${h.gapDays}d ×${h.multiplier}`)
          .join(', ')}${hits.length > 3 ? ', ...' : ''}).`;

  return { hits, checked: byCustomer.size, narrative };
}

function computeMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
