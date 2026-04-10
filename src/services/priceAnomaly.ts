/**
 * Price Anomaly Detection vs LBMA / DGD Benchmark.
 *
 * A transaction price materially off the LBMA daily fix is a
 * laundering tell: over-invoicing to repatriate illicit funds,
 * under-invoicing to disguise profit, or fictitious pricing to
 * reconcile cash books.
 *
 * Expected deviation bands (gold, troy ounce, USD):
 *   Retail jewellery : +20% to +50% over spot (labour, design, retail margin)
 *   Wholesale bullion: ±0.5% around spot
 *   Investment bar   : ±0.3% around spot
 *   Scrap buy-back   : -5% to -15% under spot (refining loss + margin)
 *
 * Anything outside these bands is flagged. Severity depends on
 * absolute deviation and transaction size.
 *
 * Regulatory: FATF Rec 20, Cabinet Res 134/2025 Art.19.
 */

import type { Metal } from './fineness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketSegment = 'retail_jewellery' | 'wholesale_bullion' | 'investment_bar' | 'scrap_buyback';

export interface BenchmarkPrice {
  metal: Metal;
  /** Price per troy ounce in USD. */
  amPerTroyOzUsd: number;
  pmPerTroyOzUsd?: number;
  date: string;
  source: 'LBMA' | 'DGD' | 'COMEX' | 'SGE';
}

export interface PricedTransaction {
  id: string;
  at: string;
  metal: Metal;
  segment: MarketSegment;
  /** Transaction quantity in troy oz. */
  quantityTroyOz: number;
  /** Transaction price per troy oz in USD. */
  pricePerTroyOzUsd: number;
  /** Total value = quantity × price. */
  totalValueUsd: number;
}

export type PriceAnomalySeverity = 'acceptable' | 'warning' | 'critical';

export interface PriceAnomaly {
  transactionId: string;
  segment: MarketSegment;
  benchmarkUsd: number;
  actualUsd: number;
  deviationPct: number;
  expectedMinPct: number;
  expectedMaxPct: number;
  severity: PriceAnomalySeverity;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Expected bands per segment
// ---------------------------------------------------------------------------

interface PriceBand {
  minPct: number; // vs benchmark
  maxPct: number;
  /** Absolute deviation beyond this is critical regardless of direction. */
  criticalAbsPct: number;
}

const PRICE_BANDS: Record<MarketSegment, PriceBand> = {
  retail_jewellery: { minPct: 20, maxPct: 50, criticalAbsPct: 100 },
  wholesale_bullion: { minPct: -0.5, maxPct: 0.5, criticalAbsPct: 3 },
  investment_bar: { minPct: -0.3, maxPct: 0.3, criticalAbsPct: 2 },
  scrap_buyback: { minPct: -15, maxPct: -5, criticalAbsPct: 20 },
};

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export function assessPriceAnomaly(
  tx: PricedTransaction,
  benchmark: BenchmarkPrice,
): PriceAnomaly {
  if (tx.metal !== benchmark.metal) {
    throw new Error(
      `assessPriceAnomaly: metal mismatch (tx=${tx.metal}, benchmark=${benchmark.metal})`,
    );
  }

  const benchmarkUsd = benchmark.pmPerTroyOzUsd ?? benchmark.amPerTroyOzUsd;
  const deviationPct =
    ((tx.pricePerTroyOzUsd - benchmarkUsd) / benchmarkUsd) * 100;
  const band = PRICE_BANDS[tx.segment];

  let severity: PriceAnomalySeverity;
  let rationale: string;

  if (Math.abs(deviationPct) >= band.criticalAbsPct) {
    severity = 'critical';
    rationale = `${deviationPct > 0 ? '+' : ''}${deviationPct.toFixed(2)}% deviation ≥ critical threshold ±${band.criticalAbsPct}% for ${tx.segment}`;
  } else if (deviationPct > band.maxPct || deviationPct < band.minPct) {
    severity = 'warning';
    rationale = `${deviationPct > 0 ? '+' : ''}${deviationPct.toFixed(2)}% outside expected ${band.minPct}% to ${band.maxPct}% for ${tx.segment}`;
  } else {
    severity = 'acceptable';
    rationale = `${deviationPct > 0 ? '+' : ''}${deviationPct.toFixed(2)}% within expected range`;
  }

  return {
    transactionId: tx.id,
    segment: tx.segment,
    benchmarkUsd,
    actualUsd: tx.pricePerTroyOzUsd,
    deviationPct: Math.round(deviationPct * 100) / 100,
    expectedMinPct: band.minPct,
    expectedMaxPct: band.maxPct,
    severity,
    rationale,
  };
}

export function batchAssess(
  txs: readonly PricedTransaction[],
  benchmarks: readonly BenchmarkPrice[],
): PriceAnomaly[] {
  const byDateMetal = new Map<string, BenchmarkPrice>();
  for (const b of benchmarks) {
    byDateMetal.set(`${b.date}|${b.metal}`, b);
  }
  const out: PriceAnomaly[] = [];
  for (const tx of txs) {
    const date = tx.at.slice(0, 10);
    const benchmark = byDateMetal.get(`${date}|${tx.metal}`);
    if (!benchmark) continue;
    out.push(assessPriceAnomaly(tx, benchmark));
  }
  return out;
}
