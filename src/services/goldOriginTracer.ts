/**
 * Gold Origin Tracer — subsystem #72 (Phase 7 Cluster I).
 *
 * LBMA Responsible Gold Guidance v9 + UAE MoE RSG Framework require
 * DPMS operators to trace gold back to its source and verify that it
 * is NOT sourced from Conflict-Affected or High-Risk Areas (CAHRAs).
 * This module maps declared origin countries to CAHRA status, scores
 * the overall supply chain, and flags shipments that need enhanced
 * due diligence or refusal.
 *
 * CAHRA list as of April 2026 (subject to change — extend here and
 * re-run `/regulatory-update` when OECD updates the list):
 *   - DRC, CAR, Sudan, South Sudan, Mali, Burkina Faso, Niger,
 *     Libya, Yemen, Myanmar
 *
 * Regulatory basis:
 *   - LBMA Responsible Gold Guidance v9 (CAHRA due diligence)
 *   - UAE MoE Responsible Sourcing of Gold (RSG) Framework
 *   - OECD Due Diligence Guidance for Responsible Supply Chains of
 *     Minerals from Conflict-Affected and High-Risk Areas
 *   - FATF Rec 10 (CDD on origin)
 *   - FDL No.10/2025 Art.12-14 (KYC on supply chain)
 */

// ---------------------------------------------------------------------------
// CAHRA data
// ---------------------------------------------------------------------------

const CAHRA_COUNTRIES: ReadonlySet<string> = new Set([
  'CD', // Democratic Republic of the Congo
  'CF', // Central African Republic
  'SD', // Sudan
  'SS', // South Sudan
  'ML', // Mali
  'BF', // Burkina Faso
  'NE', // Niger
  'LY', // Libya
  'YE', // Yemen
  'MM', // Myanmar
]);

const ADJACENT_RISK: ReadonlySet<string> = new Set([
  'CG', // Republic of Congo (DRC neighbour)
  'RW', // Rwanda (DRC neighbour)
  'BI', // Burundi
  'UG', // Uganda
  'TZ', // Tanzania
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldShipment {
  shipmentId: string;
  ozGross: number;
  declaredOriginCountry: string; // ISO-3166 alpha-2
  refinerLbmaAccredited: boolean;
  dgdHallmark: boolean;
  transitCountries?: readonly string[];
  assayCertificateNo?: string;
}

export interface OriginTraceResult {
  shipmentId: string;
  verdict: 'clean' | 'edd_required' | 'escalate' | 'refuse';
  reasons: string[];
  citation: string;
}

export interface OriginTraceReport {
  results: OriginTraceResult[];
  refuseCount: number;
  eddCount: number;
  cleanCount: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

export function traceGoldOrigin(shipments: readonly GoldShipment[]): OriginTraceReport {
  const results: OriginTraceResult[] = [];

  for (const s of shipments) {
    const reasons: string[] = [];
    let verdict: OriginTraceResult['verdict'] = 'clean';

    const origin = s.declaredOriginCountry.toUpperCase();
    const transits = (s.transitCountries ?? []).map((c) => c.toUpperCase());
    const allCountries = [origin, ...transits];

    for (const c of allCountries) {
      if (CAHRA_COUNTRIES.has(c)) {
        reasons.push(`${c} is on the CAHRA list (OECD + LBMA RGG v9)`);
        verdict = 'refuse';
      } else if (ADJACENT_RISK.has(c)) {
        reasons.push(`${c} is a DRC-adjacent high-risk jurisdiction`);
        if (verdict === 'clean') verdict = 'escalate';
      }
    }

    if (!s.refinerLbmaAccredited) {
      reasons.push('Refiner is NOT LBMA-accredited — RGG v9 requires verified refiners');
      if (verdict === 'clean') verdict = 'edd_required';
    }
    if (!s.dgdHallmark) {
      reasons.push('Missing Dubai Good Delivery hallmark — cannot verify provenance');
      if (verdict === 'clean') verdict = 'edd_required';
    }
    if (!s.assayCertificateNo || s.assayCertificateNo.trim() === '') {
      reasons.push('Missing assay certificate — cannot verify fineness / origin');
      if (verdict === 'clean') verdict = 'edd_required';
    }

    results.push({
      shipmentId: s.shipmentId,
      verdict,
      reasons,
      citation:
        verdict === 'refuse'
          ? 'LBMA RGG v9 + UAE MoE RSG Framework + OECD CAHRA Guidance'
          : verdict === 'escalate'
            ? 'LBMA RGG v9 Step 3 (EDD on high-risk supply chain)'
            : verdict === 'edd_required'
              ? 'LBMA RGG v9 Step 2 (refiner + provenance verification)'
              : 'LBMA RGG v9 Step 1 (standard supply-chain CDD)',
    });
  }

  const refuseCount = results.filter((r) => r.verdict === 'refuse').length;
  const eddCount = results.filter(
    (r) => r.verdict === 'edd_required' || r.verdict === 'escalate'
  ).length;
  const cleanCount = results.filter((r) => r.verdict === 'clean').length;

  const narrative =
    `Gold origin tracer: ${results.length} shipment(s) — ` +
    `${cleanCount} clean, ${eddCount} EDD required, ${refuseCount} refuse per LBMA RGG v9.`;

  return { results, refuseCount, eddCount, cleanCount, narrative };
}
