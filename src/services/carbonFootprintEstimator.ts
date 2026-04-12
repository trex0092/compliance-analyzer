/**
 * Carbon Footprint Estimator for DPMS Gold Supply Chains
 *
 * Estimates Scope 1, 2 and 3 GHG emissions for precious-metals dealers using
 * gold-mining benchmarks, transport emission factors and IPCC AR6 coefficients.
 *
 * Regulatory: ISSB IFRS S2 (2023), TCFD Recommendations (2017), GRI 305,
 *             UAE Net Zero 2050 National Strategy, LBMA Responsible Gold
 *             Guidance v9 §6.2, CDP Climate Questionnaire C6-C8.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmissionScope = 'scope1' | 'scope2' | 'scope3';
export type EmissionUnit = 'tCO2e' | 'kgCO2e';

/** Emission intensity benchmarks (kgCO2e per troy-ounce, sourced from LBMA/WGC) */
export const GOLD_EMISSION_BENCHMARKS: Record<string, number> = {
  /** Artisanal/small-scale mining — highest intensity */
  asm_open_pit: 28_500,
  /** Large-scale open-pit hard-rock (industry median, WGC 2023) */
  large_scale_open_pit: 16_200,
  /** Underground mining — lower surface disturbance */
  underground: 11_800,
  /** Alluvial / placer — lowest extraction intensity */
  alluvial: 6_500,
  /** Recycled/secondary gold — near-zero upstream emissions */
  recycled: 450,
};

/** Transport emission factors (kgCO2e per tonne-km, IPCC AR6 Table 10.8) */
export const TRANSPORT_EF: Record<string, number> = {
  air_freight: 0.602,
  road_heavy_truck: 0.096,
  road_light_van: 0.271,
  sea_bulk: 0.008,
  sea_container: 0.016,
  rail: 0.028,
};

/** UAE grid electricity emission factor (kgCO2e per kWh, DEWA 2023) */
export const UAE_GRID_EF = 0.432;

export interface SupplyChainLeg {
  description: string;
  originCountry: string;
  destinationCountry: string;
  transportMode: keyof typeof TRANSPORT_EF;
  distanceKm: number;
  weightKg: number;
}

export interface GoldLot {
  lotId: string;
  weightTroyOz: number;
  miningType: keyof typeof GOLD_EMISSION_BENCHMARKS;
  recycledFraction: number;           // 0–1; if >0, blends recycled EF
  refiningEnergyKwh?: number;          // optional known refinery energy
  supplyChainLegs?: SupplyChainLeg[];
}

export interface OperationalData {
  facilityElectricityKwh: number;     // Scope 2 — purchased electricity
  naturalGasM3?: number;               // Scope 1 — combustion
  dieselLitres?: number;               // Scope 1 — combustion
  lpgKg?: number;                      // Scope 1 — combustion
  businessFlightKm?: number;           // Scope 3 — staff travel
  wasteKg?: number;                    // Scope 3 — waste disposal
  waterM3?: number;                    // Scope 3 — water usage
}

export interface CarbonFootprintInput {
  entityId: string;
  reportingPeriod: string;             // ISO 8601 period (e.g. "2025")
  goldLots: GoldLot[];
  operational: OperationalData;
  /** Optional: country-specific grid EF override (kgCO2e/kWh) */
  gridEmissionFactor?: number;
}

export interface ScopeBreakdown {
  scope1_tCO2e: number;               // Direct combustion
  scope2_tCO2e: number;               // Purchased energy
  scope3_upstream_tCO2e: number;      // Mining + transport + refining
  scope3_downstream_tCO2e: number;    // Staff travel + waste + water
  total_tCO2e: number;
}

export interface GoldLotFootprint {
  lotId: string;
  miningEmissions_tCO2e: number;
  transportEmissions_tCO2e: number;
  refiningEmissions_tCO2e: number;
  total_tCO2e: number;
  intensityKgPerOz: number;
  benchmarkIntensityKgPerOz: number;
  pctAboveBenchmark: number;
}

export type CarbonRiskRating = 'low' | 'medium' | 'high' | 'critical';

export interface CarbonFootprintReport {
  entityId: string;
  reportingPeriod: string;
  generatedAt: string;
  scopeBreakdown: ScopeBreakdown;
  lotFootprints: GoldLotFootprint[];
  totalGoldTroyOz: number;
  portfolioIntensityKgPerOz: number;
  industryMedianKgPerOz: number;
  deviationFromMedianPct: number;
  carbonRisk: CarbonRiskRating;
  tcfdAligned: boolean;
  ifrss2Compliant: boolean;
  netZeroGap_tCO2e: number;           // emissions beyond UAE NZ2050 target
  recommendedOffsets_tCO2e: number;
  narrativeSummary: string;
  flags: string[];
  regulatoryRefs: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Combustion emission factors (kgCO2e per unit) */
const EF_NATURAL_GAS_M3 = 2.04;     // IPCC AR6
const EF_DIESEL_L = 2.68;            // IPCC AR6
const EF_LPG_KG = 2.98;             // IPCC AR6
const EF_AIR_TRAVEL_KM = 0.255;     // DEFRA 2023 (economy class per passenger-km)
const EF_WASTE_KG = 0.467;          // DEFRA 2023 landfill EF
const EF_WATER_M3 = 0.344;          // Water UK / lifecycle

/** UAE Net Zero 2050 interim target: 70% reduction from 2019 baseline.
 *  Industry average DPMS carbon intensity: ~16 kgCO2e/oz.
 *  NZ2050 target for DPMS: ≤4.8 kgCO2e/oz (70% below median). */
const NZ2050_TARGET_KG_PER_OZ = 4.8;

/** Industry median per WGC/LBMA 2023: 16.2 kgCO2e/troy oz (large-scale mining) */
const INDUSTRY_MEDIAN_KG_PER_OZ = 16.2;

// ─── Core Estimation Logic ────────────────────────────────────────────────────

function estimateLotFootprint(lot: GoldLot): GoldLotFootprint {
  const pureEF = GOLD_EMISSION_BENCHMARKS[lot.miningType] ?? GOLD_EMISSION_BENCHMARKS.large_scale_open_pit;
  const recycledEF = GOLD_EMISSION_BENCHMARKS.recycled;
  const blendedEF = pureEF * (1 - lot.recycledFraction) + recycledEF * lot.recycledFraction;

  const miningEmissions_kgCO2e = blendedEF * lot.weightTroyOz;

  // Refining — default: 0.8 kWh/oz (industry average); use UAE grid EF
  const refiningKwh = lot.refiningEnergyKwh ?? lot.weightTroyOz * 0.8;
  const refiningEmissions_kgCO2e = refiningKwh * UAE_GRID_EF;

  // Transport legs
  let transportEmissions_kgCO2e = 0;
  for (const leg of lot.supplyChainLegs ?? []) {
    const ef = TRANSPORT_EF[leg.transportMode] ?? 0.096;
    transportEmissions_kgCO2e += ef * leg.weightKg * (leg.distanceKm / 1000);
  }

  const total_kgCO2e = miningEmissions_kgCO2e + refiningEmissions_kgCO2e + transportEmissions_kgCO2e;
  const total_tCO2e = total_kgCO2e / 1000;
  const intensityKgPerOz = lot.weightTroyOz > 0 ? total_kgCO2e / lot.weightTroyOz : 0;
  const benchmarkIntensityKgPerOz = blendedEF;
  const pctAboveBenchmark = benchmarkIntensityKgPerOz > 0
    ? ((intensityKgPerOz - benchmarkIntensityKgPerOz) / benchmarkIntensityKgPerOz) * 100
    : 0;

  return {
    lotId: lot.lotId,
    miningEmissions_tCO2e: miningEmissions_kgCO2e / 1000,
    transportEmissions_tCO2e: transportEmissions_kgCO2e / 1000,
    refiningEmissions_tCO2e: refiningEmissions_kgCO2e / 1000,
    total_tCO2e,
    intensityKgPerOz,
    benchmarkIntensityKgPerOz,
    pctAboveBenchmark,
  };
}

function estimateScope1(op: OperationalData): number {
  let kgCO2e = 0;
  if (op.naturalGasM3) kgCO2e += op.naturalGasM3 * EF_NATURAL_GAS_M3;
  if (op.dieselLitres) kgCO2e += op.dieselLitres * EF_DIESEL_L;
  if (op.lpgKg) kgCO2e += op.lpgKg * EF_LPG_KG;
  return kgCO2e / 1000;
}

function estimateScope2(op: OperationalData, gridEF: number): number {
  return (op.facilityElectricityKwh * gridEF) / 1000;
}

function estimateScope3Downstream(op: OperationalData): number {
  let kgCO2e = 0;
  if (op.businessFlightKm) kgCO2e += op.businessFlightKm * EF_AIR_TRAVEL_KM;
  if (op.wasteKg) kgCO2e += op.wasteKg * EF_WASTE_KG;
  if (op.waterM3) kgCO2e += op.waterM3 * EF_WATER_M3;
  return kgCO2e / 1000;
}

function deriveCarbonRisk(intensityKgPerOz: number): CarbonRiskRating {
  if (intensityKgPerOz <= NZ2050_TARGET_KG_PER_OZ) return 'low';
  if (intensityKgPerOz <= INDUSTRY_MEDIAN_KG_PER_OZ * 0.7) return 'medium';
  if (intensityKgPerOz <= INDUSTRY_MEDIAN_KG_PER_OZ * 1.3) return 'high';
  return 'critical';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function estimateCarbonFootprint(input: CarbonFootprintInput): CarbonFootprintReport {
  const gridEF = input.gridEmissionFactor ?? UAE_GRID_EF;
  const flags: string[] = [];

  // Per-lot upstream emissions
  const lotFootprints = input.goldLots.map(estimateLotFootprint);
  const scope3Upstream_tCO2e = lotFootprints.reduce((s, l) => s + l.total_tCO2e, 0);
  const totalGoldTroyOz = input.goldLots.reduce((s, l) => s + l.weightTroyOz, 0);

  // Operational scopes
  const scope1 = estimateScope1(input.operational);
  const scope2 = estimateScope2(input.operational, gridEF);
  const scope3Downstream = estimateScope3Downstream(input.operational);

  const total_tCO2e = scope1 + scope2 + scope3Upstream_tCO2e + scope3Downstream;

  const scopeBreakdown: ScopeBreakdown = {
    scope1_tCO2e: scope1,
    scope2_tCO2e: scope2,
    scope3_upstream_tCO2e: scope3Upstream_tCO2e,
    scope3_downstream_tCO2e: scope3Downstream,
    total_tCO2e,
  };

  const portfolioIntensityKgPerOz = totalGoldTroyOz > 0
    ? (scope3Upstream_tCO2e * 1000) / totalGoldTroyOz
    : 0;

  const deviationFromMedianPct = ((portfolioIntensityKgPerOz - INDUSTRY_MEDIAN_KG_PER_OZ) / INDUSTRY_MEDIAN_KG_PER_OZ) * 100;

  const carbonRisk = deriveCarbonRisk(portfolioIntensityKgPerOz);

  // Net Zero gap
  const targetTotal_tCO2e = totalGoldTroyOz * NZ2050_TARGET_KG_PER_OZ / 1000;
  const netZeroGap_tCO2e = Math.max(0, total_tCO2e - targetTotal_tCO2e);

  // Compliance flags
  if (carbonRisk === 'critical') flags.push('CRITICAL: Emissions >30% above industry median — LBMA RGG v9 §6.2 requires improvement plan');
  if (portfolioIntensityKgPerOz > NZ2050_TARGET_KG_PER_OZ * 3) flags.push('WARNING: More than 3× UAE NZ2050 interim target — disclose under IFRS S2');
  if (input.goldLots.some(l => l.miningType === 'asm_open_pit')) flags.push('INFO: ASM open-pit lots — EDD required per OECD DDG 2016 Annex II');
  if (deviationFromMedianPct > 50) flags.push('HIGH: Portfolio intensity 50% above industry median — escalate to sustainability committee');
  if (input.goldLots.some(l => l.recycledFraction < 0.1)) flags.push('INFO: <10% recycled gold — consider secondary sourcing to reduce Scope 3');

  const tcfdAligned = input.operational.facilityElectricityKwh > 0;
  const ifrss2Compliant = total_tCO2e > 0 && totalGoldTroyOz > 0;

  const narrativeSummary =
    `Entity ${input.entityId} generated an estimated ${total_tCO2e.toFixed(2)} tCO2e ` +
    `(${portfolioIntensityKgPerOz.toFixed(1)} kgCO2e/oz) during ${input.reportingPeriod}. ` +
    `Industry median is ${INDUSTRY_MEDIAN_KG_PER_OZ} kgCO2e/oz; ` +
    `deviation: ${deviationFromMedianPct > 0 ? '+' : ''}${deviationFromMedianPct.toFixed(1)}%. ` +
    `Carbon risk: ${carbonRisk.toUpperCase()}. ` +
    `Net Zero 2050 gap: ${netZeroGap_tCO2e.toFixed(2)} tCO2e.`;

  return {
    entityId: input.entityId,
    reportingPeriod: input.reportingPeriod,
    generatedAt: new Date().toISOString(),
    scopeBreakdown,
    lotFootprints,
    totalGoldTroyOz,
    portfolioIntensityKgPerOz,
    industryMedianKgPerOz: INDUSTRY_MEDIAN_KG_PER_OZ,
    deviationFromMedianPct,
    carbonRisk,
    tcfdAligned,
    ifrss2Compliant,
    netZeroGap_tCO2e,
    recommendedOffsets_tCO2e: netZeroGap_tCO2e,
    narrativeSummary,
    flags,
    regulatoryRefs: [
      'ISSB IFRS S2 (2023) — Climate-related Disclosures',
      'TCFD Recommendations (2017)',
      'GRI 305 — Emissions',
      'UAE Net Zero 2050 National Strategy',
      'LBMA Responsible Gold Guidance v9 §6.2',
      'IPCC AR6 WG3 Annex III emission factors',
      'CDP Climate Questionnaire C6-C8',
      'WGC Responsible Gold Mining Principles 2019',
    ],
  };
}
