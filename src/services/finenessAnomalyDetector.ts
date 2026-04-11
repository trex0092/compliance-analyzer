/**
 * Fineness Anomaly Detector — subsystem #74 (Phase 7 Cluster I).
 *
 * Gold fineness (999.9 / 999.5 / 995 / 916 / 750 etc.) must match
 * the refiner's declared capability. A refiner listed as 999.9
 * investment-grade cannot legitimately produce 750 (18k) jewellery
 * bullion; nor vice versa. Mismatches flag either data-entry errors
 * or material misrepresentation.
 *
 * This module takes declared fineness + refiner capability map and
 * returns per-claim findings.
 *
 * Regulatory basis:
 *   - LBMA Responsible Gold Guidance v9
 *   - Dubai Good Delivery standard (fineness bands)
 *   - FATF Rec 10 (CDD on product accuracy)
 *   - UAE MoE DPMS sector guidance
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefinerCapability {
  refinerId: string;
  allowedFineness: readonly number[]; // e.g. [999.9, 999.5]
}

export interface FinenessClaim {
  shipmentId: string;
  refinerId: string;
  declaredFineness: number;
}

export interface FinenessFinding {
  shipmentId: string;
  refinerId: string;
  declaredFineness: number;
  allowed: readonly number[];
  mismatch: boolean;
  reason: string;
}

export interface FinenessReport {
  findings: FinenessFinding[];
  mismatches: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

const FINENESS_TOLERANCE = 0.2; // e.g. 999.9 matches 999.8-1000

export function detectFinenessAnomalies(
  claims: readonly FinenessClaim[],
  capabilities: readonly RefinerCapability[]
): FinenessReport {
  const capByRefiner = new Map<string, RefinerCapability>();
  for (const c of capabilities) capByRefiner.set(c.refinerId, c);

  const findings: FinenessFinding[] = [];
  let mismatches = 0;

  for (const claim of claims) {
    const cap = capByRefiner.get(claim.refinerId);
    if (!cap) {
      findings.push({
        shipmentId: claim.shipmentId,
        refinerId: claim.refinerId,
        declaredFineness: claim.declaredFineness,
        allowed: [],
        mismatch: true,
        reason: `Refiner ${claim.refinerId} has no published capability profile`,
      });
      mismatches += 1;
      continue;
    }

    const within = cap.allowedFineness.some(
      (f) => Math.abs(f - claim.declaredFineness) <= FINENESS_TOLERANCE
    );
    if (within) {
      findings.push({
        shipmentId: claim.shipmentId,
        refinerId: claim.refinerId,
        declaredFineness: claim.declaredFineness,
        allowed: cap.allowedFineness,
        mismatch: false,
        reason: 'Within refiner capability profile',
      });
    } else {
      findings.push({
        shipmentId: claim.shipmentId,
        refinerId: claim.refinerId,
        declaredFineness: claim.declaredFineness,
        allowed: cap.allowedFineness,
        mismatch: true,
        reason: `Declared fineness ${claim.declaredFineness} outside refiner profile ${JSON.stringify(cap.allowedFineness)}`,
      });
      mismatches += 1;
    }
  }

  const narrative =
    mismatches === 0
      ? `Fineness anomaly detector: all ${findings.length} claim(s) within refiner capability.`
      : `Fineness anomaly detector: ${mismatches}/${findings.length} mismatch(es). Review misrepresentation risk (LBMA RGG v9).`;

  return { findings, mismatches, narrative };
}
