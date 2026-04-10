/**
 * Assay / Fineness Validator — gold purity math and assay cert validation.
 *
 * Foundation module for the precious metals modules that follow. Every
 * bar, transaction, and VAT classification depends on knowing whether
 * a quantity of gold meets an expected fineness.
 *
 * Fineness ↔ karat conversion table (gold):
 *   24K  = 999.9 / 1000 (fine gold)
 *   22K  = 916 / 1000
 *   21K  = 875 / 1000
 *   18K  = 750 / 1000
 *   14K  = 585 / 1000
 *   10K  = 417 / 1000
 *   9K   = 375 / 1000
 *
 * Silver thresholds:
 *   Fine silver = 999
 *   Sterling    = 925
 *   Britannia   = 958
 *   Coin silver = 900
 *
 * Platinum thresholds:
 *   PT950 = 950
 *   PT900 = 900
 *   PT850 = 850
 *
 * LBMA Good Delivery minimums:
 *   Gold     ≥ 995 fineness, 350-430 troy oz per bar
 *   Silver   ≥ 999 fineness, 750-1100 troy oz per bar
 *   Platinum ≥ 999.5 fineness, 32-192 troy oz per bar
 *
 * UAE VAT Decree-Law 8/2017: "investment gold" = ≥ 995 fineness bullion
 * + gold coins; zero-rated. Everything else = 5% VAT.
 *
 * Regulatory: LBMA Assaying Rules, DGD standard, MoE 08/AML/2021.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Metal = 'gold' | 'silver' | 'platinum' | 'palladium';

export interface Fineness {
  /** Millesimal fineness (parts per thousand), e.g. 999, 916, 750. */
  value: number;
  metal: Metal;
}

export interface AssayCertificate {
  refinerName: string;
  refinerLicense?: string;
  barSerial: string;
  declaredFineness: number;
  measuredFineness: number;
  assayMethod: 'fire_assay' | 'xrf' | 'icp_ms' | 'spectroscopy' | 'other';
  assayDate: string;
  assayerName: string;
  assayerAccreditation?: string;
}

export interface FinenessValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  discrepancyPpt: number; // parts per thousand difference
  discrepancyPct: number;
}

export type KaratLabel = '24K' | '22K' | '21K' | '18K' | '14K' | '10K' | '9K';

// ---------------------------------------------------------------------------
// Karat ↔ fineness conversion
// ---------------------------------------------------------------------------

const KARAT_TO_FINENESS: Record<KaratLabel, number> = {
  '24K': 999.9,
  '22K': 916,
  '21K': 875,
  '18K': 750,
  '14K': 585,
  '10K': 417,
  '9K': 375,
};

export function karatToFineness(karat: KaratLabel): number {
  return KARAT_TO_FINENESS[karat];
}

/** Convert a millesimal fineness to the nearest standard karat label. */
export function finenessToKarat(fineness: number): KaratLabel | null {
  if (fineness < 0 || fineness > 1000) return null;
  const entries = Object.entries(KARAT_TO_FINENESS) as [KaratLabel, number][];
  // Sort by fineness descending and take the highest karat that the
  // measured value meets or exceeds (within 10 ppt tolerance).
  entries.sort((a, b) => b[1] - a[1]);
  for (const [label, threshold] of entries) {
    if (fineness >= threshold - 10) return label;
  }
  return null;
}

/** Weight of pure metal in a mixed-fineness piece. */
export function pureWeight(grossGrams: number, fineness: number): number {
  if (grossGrams < 0 || fineness < 0 || fineness > 1000) {
    throw new RangeError(
      'pureWeight: gross grams and fineness must be non-negative, fineness ≤ 1000'
    );
  }
  return (grossGrams * fineness) / 1000;
}

// ---------------------------------------------------------------------------
// LBMA Good Delivery bar specs (for validation)
// ---------------------------------------------------------------------------

export interface GoodDeliverySpec {
  metal: Metal;
  minFineness: number;
  minWeightTroyOz: number;
  maxWeightTroyOz: number;
  tolerancePpt: number; // acceptable measurement tolerance
}

export const GOOD_DELIVERY_SPECS: Record<Metal, GoodDeliverySpec> = {
  gold: {
    metal: 'gold',
    minFineness: 995,
    minWeightTroyOz: 350,
    maxWeightTroyOz: 430,
    tolerancePpt: 0.5,
  },
  silver: {
    metal: 'silver',
    minFineness: 999,
    minWeightTroyOz: 750,
    maxWeightTroyOz: 1100,
    tolerancePpt: 0.5,
  },
  platinum: {
    metal: 'platinum',
    minFineness: 999.5,
    minWeightTroyOz: 32,
    maxWeightTroyOz: 192,
    tolerancePpt: 0.5,
  },
  palladium: {
    metal: 'palladium',
    minFineness: 999.5,
    minWeightTroyOz: 32,
    maxWeightTroyOz: 192,
    tolerancePpt: 0.5,
  },
};

const GRAMS_PER_TROY_OZ = 31.1034768;

export function gramsToTroyOz(grams: number): number {
  return grams / GRAMS_PER_TROY_OZ;
}

export function troyOzToGrams(troyOz: number): number {
  return troyOz * GRAMS_PER_TROY_OZ;
}

/**
 * Validate a bar against the LBMA Good Delivery spec for its metal.
 * Returns ok=true if the bar meets the spec.
 */
export function validateGoodDelivery(
  metal: Metal,
  fineness: number,
  weightGrams: number
): FinenessValidation {
  const spec = GOOD_DELIVERY_SPECS[metal];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (fineness < spec.minFineness) {
    errors.push(
      `Fineness ${fineness} below LBMA Good Delivery minimum ${spec.minFineness} for ${metal}`
    );
  }

  const troyOz = gramsToTroyOz(weightGrams);
  if (troyOz < spec.minWeightTroyOz) {
    errors.push(
      `Weight ${troyOz.toFixed(2)} troy oz below minimum ${spec.minWeightTroyOz} for ${metal}`
    );
  }
  if (troyOz > spec.maxWeightTroyOz) {
    errors.push(
      `Weight ${troyOz.toFixed(2)} troy oz above maximum ${spec.maxWeightTroyOz} for ${metal}`
    );
  }

  // Warning zones — 1 ppt below spec is a rounding boundary
  if (fineness >= spec.minFineness - 1 && fineness < spec.minFineness) {
    warnings.push(
      `Fineness ${fineness} is within 1 ppt of the Good Delivery floor; verify assay method`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    discrepancyPpt: 0,
    discrepancyPct: 0,
  };
}

// ---------------------------------------------------------------------------
// Assay discrepancy detection
// ---------------------------------------------------------------------------

/**
 * Validate an assay certificate. Flags declared-vs-measured
 * discrepancies beyond normal measurement tolerance and checks the
 * assayer credentials.
 */
export function validateAssay(cert: AssayCertificate, metal: Metal = 'gold'): FinenessValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (cert.declaredFineness < 0 || cert.declaredFineness > 1000) {
    errors.push(`Declared fineness ${cert.declaredFineness} is out of range [0, 1000]`);
  }
  if (cert.measuredFineness < 0 || cert.measuredFineness > 1000) {
    errors.push(`Measured fineness ${cert.measuredFineness} is out of range [0, 1000]`);
  }

  const diffPpt = cert.declaredFineness - cert.measuredFineness;
  const diffPct = cert.declaredFineness === 0 ? 0 : (diffPpt / cert.declaredFineness) * 100;

  const spec = GOOD_DELIVERY_SPECS[metal];
  const tolerance = spec.tolerancePpt;

  if (Math.abs(diffPpt) > tolerance) {
    if (diffPpt > 0) {
      errors.push(
        `Measured fineness is ${diffPpt.toFixed(1)} ppt BELOW declared — possible fraud or impurity`
      );
    } else {
      warnings.push(
        `Measured fineness is ${Math.abs(diffPpt).toFixed(1)} ppt ABOVE declared — unusual but not adverse`
      );
    }
  }

  if (!cert.assayerAccreditation) {
    warnings.push('Assayer has no declared accreditation');
  }
  if (!cert.refinerLicense) {
    warnings.push('Refiner license number is missing');
  }
  if (!cert.barSerial || cert.barSerial.length < 4) {
    errors.push('Bar serial number missing or too short');
  }

  // Assay date sanity
  const assayDate = new Date(cert.assayDate);
  if (isNaN(assayDate.getTime())) {
    errors.push(`Invalid assay date: ${cert.assayDate}`);
  } else if (assayDate.getTime() > Date.now()) {
    errors.push('Assay date is in the future');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    discrepancyPpt: Math.abs(diffPpt),
    discrepancyPct: Math.abs(diffPct),
  };
}

// ---------------------------------------------------------------------------
// Investment gold classification (UAE VAT Decree-Law 8/2017)
// ---------------------------------------------------------------------------

export interface InvestmentGoldClassification {
  isInvestmentGold: boolean;
  reason: string;
  vatRate: 0 | 0.05;
}

/**
 * Classify a gold item as investment gold (zero-rated) or
 * non-investment (5% VAT). Per UAE VAT Decree-Law 8/2017:
 *   - Bullion ≥ 995 fineness in bar / ingot / wafer form → zero-rated
 *   - Coins minted as legal tender with ≥ 900 fineness → zero-rated
 *   - Jewellery, scrap, industrial gold → 5% VAT
 */
export function classifyInvestmentGold(params: {
  fineness: number;
  form: 'bar' | 'ingot' | 'wafer' | 'coin' | 'jewellery' | 'scrap' | 'industrial';
  isLegalTender?: boolean;
}): InvestmentGoldClassification {
  const { fineness, form, isLegalTender } = params;

  if (form === 'jewellery' || form === 'scrap' || form === 'industrial') {
    return {
      isInvestmentGold: false,
      reason: `Form "${form}" is not investment gold — standard 5% VAT applies`,
      vatRate: 0.05,
    };
  }

  if ((form === 'bar' || form === 'ingot' || form === 'wafer') && fineness >= 995) {
    return {
      isInvestmentGold: true,
      reason: `Bullion ${form} at fineness ${fineness} ≥ 995 — zero-rated`,
      vatRate: 0,
    };
  }

  if (form === 'coin' && fineness >= 900 && isLegalTender) {
    return {
      isInvestmentGold: true,
      reason: `Legal tender coin at fineness ${fineness} ≥ 900 — zero-rated`,
      vatRate: 0,
    };
  }

  if (form === 'coin' && (fineness < 900 || !isLegalTender)) {
    return {
      isInvestmentGold: false,
      reason: `Coin fails investment-gold criteria (fineness ${fineness} or not legal tender) — 5% VAT`,
      vatRate: 0.05,
    };
  }

  return {
    isInvestmentGold: false,
    reason: `Fineness ${fineness} below 995 — not investment gold, 5% VAT`,
    vatRate: 0.05,
  };
}
