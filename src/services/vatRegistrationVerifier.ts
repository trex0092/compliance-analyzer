/**
 * VAT Registration Verifier — subsystem #75 (Phase 7 Cluster I).
 *
 * Every legitimate UAE DPMS trader needs an active Tax Registration
 * Number (TRN) from the Federal Tax Authority (FTA). Front companies
 * often operate without one, or use expired / suspended TRNs to
 * obscure real control. This subsystem takes a TRN + declared name +
 * declared address and verifies:
 *
 *   - TRN format is valid (15 digits starting with 10000)
 *   - TRN is active (not expired / suspended)
 *   - Declared name matches the TRN's registered name
 *   - Declared address matches the TRN's registered address
 *
 * The registry is injected — in production, we'd wire the FTA
 * e-dirham / e-services API; in tests, an in-memory map.
 *
 * Regulatory basis:
 *   - UAE Federal Tax Authority regulations
 *   - MoE Circular 08/AML/2021 (DPMS registration verification)
 *   - FATF Rec 10 (CDD on legal entities)
 *   - FDL No.10/2025 Art.12-14 (identity verification)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrnRecord {
  trn: string;
  status: 'active' | 'suspended' | 'expired' | 'unknown';
  registeredName: string;
  registeredAddress: string;
  activatedAt?: string;
  expiresAt?: string;
}

export type TrnLookup = (trn: string) => TrnRecord | undefined;

export interface TrnClaim {
  traderId: string;
  declaredTrn: string;
  declaredName: string;
  declaredAddress: string;
}

export interface TrnVerificationResult {
  traderId: string;
  ok: boolean;
  failures: string[];
  severity: 'none' | 'medium' | 'high' | 'critical';
  citation: string;
}

export interface TrnVerificationReport {
  results: TrnVerificationResult[];
  totalFailed: number;
  narrative: string;
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

const TRN_FORMAT = /^100[0-9]{12}$/;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function verifyTrnRegistrations(
  claims: readonly TrnClaim[],
  lookup: TrnLookup
): TrnVerificationReport {
  const results: TrnVerificationResult[] = [];

  for (const claim of claims) {
    const failures: string[] = [];
    let severity: TrnVerificationResult['severity'] = 'none';

    if (!TRN_FORMAT.test(claim.declaredTrn)) {
      failures.push('Invalid TRN format (must be 15 digits starting 100)');
      severity = 'high';
    }

    const record = lookup(claim.declaredTrn);
    if (!record) {
      failures.push('TRN not found in FTA registry — possible front company');
      severity = 'critical';
    } else {
      if (record.status !== 'active') {
        failures.push(`TRN status is ${record.status}`);
        severity = 'high';
      }
      if (normalise(record.registeredName) !== normalise(claim.declaredName)) {
        failures.push(
          `Registered name mismatch: "${record.registeredName}" vs declared "${claim.declaredName}"`
        );
        if (severity === 'none') severity = 'medium';
      }
      if (normalise(record.registeredAddress) !== normalise(claim.declaredAddress)) {
        failures.push(
          `Registered address mismatch: "${record.registeredAddress}" vs declared "${claim.declaredAddress}"`
        );
        if (severity === 'none') severity = 'medium';
      }
    }

    results.push({
      traderId: claim.traderId,
      ok: failures.length === 0,
      failures,
      severity,
      citation: 'MoE Circular 08/AML/2021 + FATF Rec 10 + FTA registration law',
    });
  }

  const totalFailed = results.filter((r) => !r.ok).length;
  const narrative =
    totalFailed === 0
      ? `VAT registration verifier: all ${results.length} TRN(s) valid + active + matching.`
      : `VAT registration verifier: ${totalFailed}/${results.length} failed verification. ` +
        `Review for front-company risk.`;

  return { results, totalFailed, narrative };
}
