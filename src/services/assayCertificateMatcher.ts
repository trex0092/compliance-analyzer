/**
 * Assay Certificate Matcher — subsystem #73 (Phase 7 Cluster I).
 *
 * Cross-references assay certificate numbers declared on gold
 * shipments against the LBMA Good Delivery List (GDL) and the Dubai
 * Good Delivery (DGD) refiner registry. Detects:
 *
 *   - Forged certificates (number format doesn't match issuer)
 *   - Mismatched refiner / certificate number
 *   - Duplicate certificates (same number on two shipments)
 *   - Unknown refiners (not in LBMA GDL or DGD lists)
 *
 * The registry is injected so tests run without a live connector.
 * Production wires it to a periodic sync of lbma.org.uk and
 * dmcc.ae (Dubai Multi Commodities Centre) GDL data.
 *
 * Regulatory basis:
 *   - LBMA Responsible Gold Guidance v9
 *   - Dubai Good Delivery standard
 *   - UAE MoE RSG Framework
 *   - FATF Rec 11 (record-keeping integrity)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccreditedRefiner {
  id: string;
  name: string;
  country: string;
  accreditation: 'LBMA_GDL' | 'DGD' | 'BOTH';
  /** Regex of acceptable assay certificate numbers (issuer-specific format). */
  certificateNumberPattern: RegExp;
}

export interface AssayCertificateClaim {
  shipmentId: string;
  refinerId: string;
  certificateNumber: string;
  declaredGrossOz: number;
  declaredFineness: number;
}

export type RefinerLookup = (refinerId: string) => AccreditedRefiner | undefined;

export interface AssayMatchResult {
  shipmentId: string;
  ok: boolean;
  failures: string[];
  citation: string;
}

export interface AssayMatchReport {
  results: AssayMatchResult[];
  totalFailures: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

export function matchAssayCertificates(
  claims: readonly AssayCertificateClaim[],
  lookup: RefinerLookup
): AssayMatchReport {
  const results: AssayMatchResult[] = [];
  const seenNumbers = new Map<string, string>(); // cert number → first shipmentId

  for (const claim of claims) {
    const failures: string[] = [];
    const refiner = lookup(claim.refinerId);

    if (!refiner) {
      failures.push(
        `Refiner ${claim.refinerId} not in LBMA GDL or DGD registry — possibly unaccredited source`
      );
    } else {
      if (!refiner.certificateNumberPattern.test(claim.certificateNumber)) {
        failures.push(
          `Certificate number "${claim.certificateNumber}" does not match ${refiner.name} format — possible forgery`
        );
      }
    }

    const prior = seenNumbers.get(claim.certificateNumber);
    if (prior && prior !== claim.shipmentId) {
      failures.push(
        `Duplicate certificate number: also used on shipment ${prior}`
      );
    } else {
      seenNumbers.set(claim.certificateNumber, claim.shipmentId);
    }

    results.push({
      shipmentId: claim.shipmentId,
      ok: failures.length === 0,
      failures,
      citation: 'LBMA RGG v9 + DGD standard + FATF Rec 11',
    });
  }

  const totalFailures = results.filter((r) => !r.ok).length;
  const narrative =
    totalFailures === 0
      ? `Assay certificate matcher: all ${results.length} certificate(s) valid against LBMA GDL + DGD.`
      : `Assay certificate matcher: ${totalFailures}/${results.length} failure(s). Review forgery / duplicate risk.`;

  return { results, totalFailures, narrative };
}
