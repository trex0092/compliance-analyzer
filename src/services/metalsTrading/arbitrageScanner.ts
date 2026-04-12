// ─── Arbitrage Scanner: Cross-Market Opportunity Detection ──────────────────
// Scans: spot/futures basis, cross-exchange spread, gold-silver ratio,
// physical-paper premium, regional differentials, triangular arb.

import type { Metal, Venue, TradeSide, ArbitrageOpportunity, PriceQuote } from './types';
import type { PriceOracle } from './priceOracle';

// ─── Configuration ──────────────────────────────────────────────────────────

interface ArbitrageConfig {
  minProfitBps: number; // minimum spread in bps to trigger
  maxExecutionMs: number; // max time to execute before window closes
  includePhysical: boolean; // include physical delivery arb
  transactionCostBps: number; // estimated round-trip cost
  maxExposure: number; // max position size in USD
  goldSilverRatioMean: number; // historical mean for ratio trade
  goldSilverRatioStdDev: number;
}

const DEFAULT_CONFIG: ArbitrageConfig = {
  minProfitBps: 15,
  maxExecutionMs: 5_000,
  includePhysical: true,
  transactionCostBps: 8,
  maxExposure: 500_000,
  goldSilverRatioMean: 75,
  goldSilverRatioStdDev: 8,
};

// ─── Scanner Class ──────────────────────────────────────────────────────────

export class ArbitrageScanner {
  private config: ArbitrageConfig;
  private opportunityHistory: ArbitrageOpportunity[] = [];
  private seenIds = new Set<string>();

  constructor(config: Partial<ArbitrageConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Full Scan ────────────────────────────────────────────────────────

  scanAll(oracle: PriceOracle): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    opportunities.push(...this.scanCrossExchange(oracle, 'XAU'));
    opportunities.push(...this.scanCrossExchange(oracle, 'XAG'));
    opportunities.push(...this.scanCrossExchange(oracle, 'XPT'));
    opportunities.push(...this.scanCrossExchange(oracle, 'XPD'));
    opportunities.push(...this.scanGoldSilverRatio(oracle));
    opportunities.push(...this.scanPhysicalPaperPremium(oracle));
    opportunities.push(...this.scanRegionalDifferential(oracle));
    opportunities.push(...this.scanTriangular(oracle));

    // Deduplicate
    const fresh = opportunities.filter((o) => !this.seenIds.has(o.id));
    for (const o of fresh) {
      this.seenIds.add(o.id);
      this.opportunityHistory.push(o);
    }

    // Prune old history
    const cutoff = Date.now() - 3_600_000;
    this.opportunityHistory = this.opportunityHistory.filter((o) => o.detectedAt > cutoff);

    return fresh.filter((o) => o.netProfit > 0);
  }

  // ─── Cross-Exchange Spread ────────────────────────────────────────────

  private scanCrossExchange(oracle: PriceOracle, metal: Metal): ArbitrageOpportunity[] {
    const quotes = oracle.getAllQuotes(metal);
    if (quotes.length < 2) return [];

    const results: ArbitrageOpportunity[] = [];

    for (let i = 0; i < quotes.length; i++) {
      for (let j = i + 1; j < quotes.length; j++) {
        const a = quotes[i];
        const b = quotes[j];

        // Can we buy on A and sell on B?
        const spreadAB = b.bid - a.ask;
        const spreadBA = a.bid - b.ask;

        if (spreadAB > 0) {
          const opp = this.buildCrossExchangeOpp(metal, a, b, spreadAB, 'BUY', 'SELL');
          if (opp) results.push(opp);
        }

        if (spreadBA > 0) {
          const opp = this.buildCrossExchangeOpp(metal, b, a, spreadBA, 'BUY', 'SELL');
          if (opp) results.push(opp);
        }
      }
    }

    return results;
  }

  private buildCrossExchangeOpp(
    metal: Metal,
    buyQuote: PriceQuote,
    sellQuote: PriceQuote,
    grossSpread: number,
    buySide: TradeSide,
    sellSide: TradeSide
  ): ArbitrageOpportunity | null {
    const midPrice = (buyQuote.ask + sellQuote.bid) / 2;
    const spreadBps = midPrice > 0 ? (grossSpread / midPrice) * 10_000 : 0;

    if (spreadBps < this.config.minProfitBps) return null;

    const maxQty = Math.floor(this.config.maxExposure / buyQuote.ask);
    const transactionCost = midPrice * maxQty * (this.config.transactionCostBps / 10_000);
    const grossProfit = grossSpread * maxQty;
    const netProfit = grossProfit - transactionCost;

    if (netProfit <= 0) return null;

    return {
      id: `CE-${metal}-${buyQuote.venue}-${sellQuote.venue}-${Date.now()}`,
      type: 'CROSS_EXCHANGE',
      metalA: metal,
      venueA: buyQuote.venue,
      venueB: sellQuote.venue,
      priceA: buyQuote.ask,
      priceB: sellQuote.bid,
      spreadAbs: grossSpread,
      spreadPct: spreadBps / 100,
      estimatedProfit: grossProfit,
      estimatedCosts: transactionCost,
      netProfit,
      confidence: Math.min(spreadBps / 50, 0.95),
      expiryMs: this.config.maxExecutionMs,
      detectedAt: Date.now(),
      riskFactors: ['Execution risk', 'Settlement timing', 'Counterparty risk'],
      executionPlan: [
        { step: 1, action: `Buy ${metal}`, venue: buyQuote.venue, side: buySide, qty: maxQty },
        { step: 2, action: `Sell ${metal}`, venue: sellQuote.venue, side: sellSide, qty: maxQty },
      ],
    };
  }

  // ─── Gold/Silver Ratio Trade ──────────────────────────────────────────

  private scanGoldSilverRatio(oracle: PriceOracle): ArbitrageOpportunity[] {
    const gold = oracle.getConsolidated('XAU');
    const silver = oracle.getConsolidated('XAG');
    if (!gold || !silver || silver.mid === 0) return [];

    const ratio = gold.mid / silver.mid;
    const deviation = (ratio - this.config.goldSilverRatioMean) / this.config.goldSilverRatioStdDev;

    if (Math.abs(deviation) < 1.5) return []; // Need 1.5 sigma deviation

    const isRatioHigh = deviation > 0; // Silver undervalued
    const spreadPct = Math.abs(deviation) * 2; // rough profit estimate

    const opp: ArbitrageOpportunity = {
      id: `GSR-${Date.now()}`,
      type: 'RATIO_TRADE',
      metalA: isRatioHigh ? 'XAG' : 'XAU',
      metalB: isRatioHigh ? 'XAU' : 'XAG',
      venueA: gold.venue,
      venueB: silver.venue,
      priceA: isRatioHigh ? silver.mid : gold.mid,
      priceB: isRatioHigh ? gold.mid : silver.mid,
      spreadAbs: Math.abs(ratio - this.config.goldSilverRatioMean),
      spreadPct,
      estimatedProfit: this.config.maxExposure * (spreadPct / 100),
      estimatedCosts: this.config.maxExposure * (this.config.transactionCostBps / 10_000) * 2,
      netProfit:
        this.config.maxExposure * (spreadPct / 100) -
        this.config.maxExposure * (this.config.transactionCostBps / 10_000) * 2,
      confidence: Math.min(Math.abs(deviation) / 3, 0.9),
      expiryMs: 86_400_000, // ratio trades have longer horizon
      detectedAt: Date.now(),
      riskFactors: [
        `G/S ratio: ${ratio.toFixed(1)} (mean: ${this.config.goldSilverRatioMean})`,
        `Deviation: ${deviation.toFixed(2)} sigma`,
        'Mean reversion may take days/weeks',
        'Correlation risk',
      ],
      executionPlan: isRatioHigh
        ? [
            {
              step: 1,
              action: 'Buy silver (undervalued)',
              venue: silver.venue,
              side: 'BUY',
              qty: Math.floor(this.config.maxExposure / silver.mid),
            },
            {
              step: 2,
              action: 'Sell gold (overvalued vs silver)',
              venue: gold.venue,
              side: 'SELL',
              qty: Math.floor(this.config.maxExposure / gold.mid / ratio),
            },
          ]
        : [
            {
              step: 1,
              action: 'Buy gold (undervalued)',
              venue: gold.venue,
              side: 'BUY',
              qty: Math.floor(this.config.maxExposure / gold.mid),
            },
            {
              step: 2,
              action: 'Sell silver (overvalued vs gold)',
              venue: silver.venue,
              side: 'SELL',
              qty: Math.floor((this.config.maxExposure / silver.mid) * ratio),
            },
          ],
    };

    return opp.netProfit > 0 ? [opp] : [];
  }

  // ─── Physical vs Paper Premium ────────────────────────────────────────

  private scanPhysicalPaperPremium(oracle: PriceOracle): ArbitrageOpportunity[] {
    if (!this.config.includePhysical) return [];

    const metals: Metal[] = ['XAU', 'XAG'];
    const results: ArbitrageOpportunity[] = [];

    for (const metal of metals) {
      const physical = oracle.getByVenue(metal, 'PHYSICAL');
      const spot = oracle.getConsolidated(metal);
      if (!physical || !spot) continue;

      const premium = physical.mid - spot.mid;
      const premiumPct = spot.mid > 0 ? (premium / spot.mid) * 100 : 0;

      // Physical premium > 2% = arb opportunity
      if (Math.abs(premiumPct) > 2) {
        const sellPhysical = premiumPct > 0;
        results.push({
          id: `PP-${metal}-${Date.now()}`,
          type: 'PHYSICAL_PAPER',
          metalA: metal,
          venueA: sellPhysical ? 'PHYSICAL' : 'OTC_SPOT',
          venueB: sellPhysical ? 'OTC_SPOT' : 'PHYSICAL',
          priceA: sellPhysical ? physical.bid : spot.ask,
          priceB: sellPhysical ? spot.ask : physical.ask,
          spreadAbs: Math.abs(premium),
          spreadPct: Math.abs(premiumPct),
          estimatedProfit: Math.abs(premium) * (this.config.maxExposure / spot.mid),
          estimatedCosts: this.config.maxExposure * 0.005, // physical handling costs ~50bps
          netProfit:
            Math.abs(premium) * (this.config.maxExposure / spot.mid) -
            this.config.maxExposure * 0.005,
          confidence: 0.55, // physical arb has more friction
          expiryMs: 86_400_000 * 7, // week-long horizon
          detectedAt: Date.now(),
          riskFactors: [
            'Physical delivery logistics',
            'Storage costs',
            'Insurance',
            'Assay verification',
          ],
          executionPlan: [
            {
              step: 1,
              action: sellPhysical ? 'Sell physical metal' : 'Buy paper position',
              venue: sellPhysical ? 'PHYSICAL' : 'OTC_SPOT',
              side: 'SELL',
              qty: Math.floor(this.config.maxExposure / spot.mid),
            },
            {
              step: 2,
              action: sellPhysical ? 'Buy paper position' : 'Buy physical metal',
              venue: sellPhysical ? 'OTC_SPOT' : 'PHYSICAL',
              side: 'BUY',
              qty: Math.floor(this.config.maxExposure / spot.mid),
            },
          ],
        });
      }
    }

    return results;
  }

  // ─── Regional Price Differential ──────────────────────────────────────

  private scanRegionalDifferential(oracle: PriceOracle): ArbitrageOpportunity[] {
    const results: ArbitrageOpportunity[] = [];
    const regions: [Venue, Venue][] = [
      ['LBMA', 'SGE'],
      ['LBMA', 'DMCC'],
      ['DMCC', 'SGE'],
      ['COMEX', 'LBMA'],
    ];

    for (const metal of ['XAU', 'XAG'] as Metal[]) {
      for (const [regionA, regionB] of regions) {
        const a = oracle.getByVenue(metal, regionA);
        const b = oracle.getByVenue(metal, regionB);
        if (!a || !b) continue;

        const spread = b.bid - a.ask;
        const spreadPct = a.ask > 0 ? (spread / a.ask) * 100 : 0;

        if (spreadPct > 0.3) {
          // 30bps minimum for regional arb
          results.push({
            id: `RG-${metal}-${regionA}-${regionB}-${Date.now()}`,
            type: 'REGIONAL',
            metalA: metal,
            venueA: regionA,
            venueB: regionB,
            priceA: a.ask,
            priceB: b.bid,
            spreadAbs: spread,
            spreadPct,
            estimatedProfit: spread * (this.config.maxExposure / a.ask),
            estimatedCosts:
              this.config.maxExposure * ((this.config.transactionCostBps * 2) / 10_000),
            netProfit:
              spread * (this.config.maxExposure / a.ask) -
              this.config.maxExposure * ((this.config.transactionCostBps * 2) / 10_000),
            confidence: Math.min(spreadPct / 1.0, 0.85),
            expiryMs: 30_000,
            detectedAt: Date.now(),
            riskFactors: [
              'Time zone risk',
              'FX conversion',
              'Settlement mismatch',
              'Regulatory differences',
            ],
            executionPlan: [
              {
                step: 1,
                action: `Buy ${metal} on ${regionA}`,
                venue: regionA,
                side: 'BUY',
                qty: Math.floor(this.config.maxExposure / a.ask),
              },
              {
                step: 2,
                action: `Sell ${metal} on ${regionB}`,
                venue: regionB,
                side: 'SELL',
                qty: Math.floor(this.config.maxExposure / a.ask),
              },
            ],
          });
        }
      }
    }

    return results;
  }

  // ─── Triangular Arbitrage (XAU/USD → XAU/AED → USD/AED) ──────────────

  private scanTriangular(oracle: PriceOracle): ArbitrageOpportunity[] {
    const goldUSD = oracle.getConsolidated('XAU', 'USD');
    const goldAED = oracle.getConsolidated('XAU', 'AED');
    if (!goldUSD || !goldAED || goldAED.mid === 0) return [];

    // Implied USD/AED rate from gold
    const impliedRate = goldAED.mid / goldUSD.mid;
    const officialRate = 3.6725; // CBUAE peg, with minor float

    const deviation = (Math.abs(impliedRate - officialRate) / officialRate) * 100;

    if (deviation < 0.15) return []; // need 15bps deviation

    const buyGoldInCheapCurrency = impliedRate > officialRate;

    return [
      {
        id: `TRI-XAU-USD-AED-${Date.now()}`,
        type: 'TRIANGULAR',
        metalA: 'XAU',
        venueA: goldUSD.venue,
        venueB: goldAED.venue,
        priceA: goldUSD.mid,
        priceB: goldAED.mid,
        spreadAbs: Math.abs(impliedRate - officialRate),
        spreadPct: deviation,
        estimatedProfit: this.config.maxExposure * (deviation / 100),
        estimatedCosts: this.config.maxExposure * 0.002,
        netProfit: this.config.maxExposure * (deviation / 100) - this.config.maxExposure * 0.002,
        confidence: Math.min(deviation / 0.5, 0.8),
        expiryMs: 10_000,
        detectedAt: Date.now(),
        riskFactors: ['FX rate slippage', 'CBUAE rate publication lag', 'AED liquidity'],
        executionPlan: buyGoldInCheapCurrency
          ? [
              {
                step: 1,
                action: 'Buy XAU in USD',
                venue: goldUSD.venue,
                side: 'BUY',
                qty: Math.floor(this.config.maxExposure / goldUSD.ask),
              },
              {
                step: 2,
                action: 'Sell XAU in AED',
                venue: goldAED.venue,
                side: 'SELL',
                qty: Math.floor(this.config.maxExposure / goldUSD.ask),
              },
              {
                step: 3,
                action: 'Convert AED → USD at official rate',
                venue: 'OTC_SPOT',
                side: 'SELL',
                qty: 0,
              },
            ]
          : [
              {
                step: 1,
                action: 'Buy XAU in AED',
                venue: goldAED.venue,
                side: 'BUY',
                qty: Math.floor(this.config.maxExposure / goldUSD.ask),
              },
              {
                step: 2,
                action: 'Sell XAU in USD',
                venue: goldUSD.venue,
                side: 'SELL',
                qty: Math.floor(this.config.maxExposure / goldUSD.ask),
              },
              {
                step: 3,
                action: 'Convert USD → AED at official rate',
                venue: 'OTC_SPOT',
                side: 'BUY',
                qty: 0,
              },
            ],
      },
    ];
  }

  // ─── Queries ────────────────────────────────────────────────────────────

  getHistory(): ArbitrageOpportunity[] {
    return this.opportunityHistory;
  }

  getStats(): {
    totalDetected: number;
    totalProfit: number;
    avgConfidence: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    let totalProfit = 0;
    let totalConfidence = 0;

    for (const opp of this.opportunityHistory) {
      byType[opp.type] = (byType[opp.type] ?? 0) + 1;
      totalProfit += opp.netProfit;
      totalConfidence += opp.confidence;
    }

    return {
      totalDetected: this.opportunityHistory.length,
      totalProfit,
      avgConfidence:
        this.opportunityHistory.length > 0 ? totalConfidence / this.opportunityHistory.length : 0,
      byType,
    };
  }
}
