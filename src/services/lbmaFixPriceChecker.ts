/**
 * LBMA Fix Price Checker — subsystem #71 (Phase 7 Cluster I).
 *
 * The LBMA Gold Price (AM + PM fix) is the global daily benchmark
 * for physical gold. Trades priced more than ~2% off the fix at the
 * trade timestamp are a textbook red flag in a DPMS compliance review:
 * they're either booking errors, off-market deals, or price-laundering.
 *
 * This subsystem compares a trade's USD/oz price against the nearest
 * LBMA fix and reports deviation percentage. Outside tolerance → flag.
 * Above double tolerance → escalate. Above triple → likely freeze.
 *
 * The LBMA fix lookup is injected — production wires a REST client
 * (lbma.org.uk daily price JSON), tests use an in-memory map.
 *
 * Regulatory basis:
 *   - LBMA Responsible Gold Guidance v9 (fair pricing attestation)
 *   - UAE MoE RSG Framework (responsible sourcing of gold)
 *   - MoE Circular 08/AML/2021 (DPMS transaction monitoring)
 *   - FATF Rec 10 (CDD — understanding customer trade rationale)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LbmaFix {
  /** ISO date of the fix. */
  date: string;
  /** 'AM' or 'PM' session. */
  session: 'AM' | 'PM';
  /** USD per troy ounce. */
  usdPerOz: number;
}

export type FixLookup = (tradeAt: string) => LbmaFix | undefined;

export interface GoldTrade {
  tradeId: string;
  tradeAt: string; // ISO
  usdPerOz: number;
  ozTraded: number;
}

export interface FixCheckConfig {
  /** Deviation tolerance in percent (default 2). */
  tolerancePct?: number;
}

export interface FixCheckResult {
  tradeId: string;
  fix: LbmaFix;
  deviationPct: number;
  bucket: 'within_tolerance' | 'flag' | 'escalate' | 'freeze';
  reason: string;
}

export interface FixCheckReport {
  checked: number;
  results: readonly FixCheckResult[];
  flagged: number;
  escalated: number;
  frozen: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

export function checkLbmaFixDeviations(
  trades: readonly GoldTrade[],
  lookup: FixLookup,
  config: FixCheckConfig = {}
): FixCheckReport {
  const tolerance = config.tolerancePct ?? 2;
  const results: FixCheckResult[] = [];
  let flagged = 0;
  let escalated = 0;
  let frozen = 0;

  for (const trade of trades) {
    const fix = lookup(trade.tradeAt);
    if (!fix) continue;

    const deviation = ((trade.usdPerOz - fix.usdPerOz) / fix.usdPerOz) * 100;
    const absDev = Math.abs(deviation);

    let bucket: FixCheckResult['bucket'];
    let reason: string;
    if (absDev <= tolerance) {
      bucket = 'within_tolerance';
      reason = `Within ${tolerance}% of LBMA ${fix.session} fix (${fix.usdPerOz.toFixed(2)} USD/oz)`;
    } else if (absDev <= tolerance * 2) {
      bucket = 'flag';
      flagged += 1;
      reason = `${deviation.toFixed(2)}% deviation from LBMA ${fix.session} fix — investigate pricing rationale (LBMA RGG v9)`;
    } else if (absDev <= tolerance * 3) {
      bucket = 'escalate';
      escalated += 1;
      reason = `${deviation.toFixed(2)}% deviation — material off-market pricing (MoE Circular 08/AML/2021)`;
    } else {
      bucket = 'freeze';
      frozen += 1;
      reason = `${deviation.toFixed(2)}% deviation — suspected price laundering (FATF Rec 10 + LBMA RGG v9)`;
    }

    results.push({
      tradeId: trade.tradeId,
      fix,
      deviationPct: Math.round(deviation * 100) / 100,
      bucket,
      reason,
    });
  }

  const narrative =
    results.length === 0
      ? 'LBMA fix price checker: no trades had matching fixes.'
      : `LBMA fix price checker: ${results.length} trade(s) checked, ` +
        `${flagged} flagged / ${escalated} escalated / ${frozen} potential freeze.`;

  return { checked: results.length, results, flagged, escalated, frozen, narrative };
}
