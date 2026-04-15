/**
 * Consent Store — purpose-bound consent records for EU-resident
 * customers.
 *
 * Why this exists:
 *   EU GDPR Art.6 requires a lawful basis for every processing
 *   activity, and Art.7 requires that consent (when used as the
 *   basis) be freely given, specific, informed, and unambiguous.
 *   Operators must be able to prove for each customer: who consented
 *   to what, when, and on what version of the notice.
 *
 *   This module is the pure consent ledger. It records consent
 *   grants and withdrawals, scoped by purpose, with references to
 *   the specific notice version the customer consented to.
 *
 *   Pure function + injectable store.
 *
 * Regulatory basis:
 *   EU GDPR Art.6  (lawful basis)
 *   EU GDPR Art.7  (conditions for consent)
 *   EU GDPR Art.13 (information at collection time)
 *   EU GDPR Art.17 (right to erasure — withdrawal)
 *   FDL No.10/2025 Art.14 (data protection)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConsentPurpose =
  | 'service_delivery'
  | 'aml_screening'
  | 'marketing'
  | 'analytics'
  | 'third_party_sharing'
  | 'profiling';

export type ConsentStatus = 'granted' | 'withdrawn' | 'expired' | 'superseded';

export interface ConsentRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  purpose: ConsentPurpose;
  noticeVersion: string;
  status: ConsentStatus;
  grantedAtIso: string;
  withdrawnAtIso: string | null;
  lawfulBasis: 'consent' | 'contract' | 'legal_obligation' | 'legitimate_interest';
  /** Free-text reason captured at grant time. */
  reason: string;
}

export interface ConsentSnapshot {
  records: readonly ConsentRecord[];
}

// ---------------------------------------------------------------------------
// Purpose catalogue
// ---------------------------------------------------------------------------

export const DEFAULT_PURPOSES: Readonly<Record<ConsentPurpose, { label: string; lawfulBasisDefault: ConsentRecord['lawfulBasis'] }>> = {
  service_delivery: { label: 'Service delivery', lawfulBasisDefault: 'contract' },
  aml_screening: { label: 'AML/CFT screening', lawfulBasisDefault: 'legal_obligation' },
  marketing: { label: 'Marketing communications', lawfulBasisDefault: 'consent' },
  analytics: { label: 'Product analytics', lawfulBasisDefault: 'legitimate_interest' },
  third_party_sharing: { label: 'Third-party data sharing', lawfulBasisDefault: 'consent' },
  profiling: { label: 'Automated profiling', lawfulBasisDefault: 'consent' },
};

// ---------------------------------------------------------------------------
// Pure operations
// ---------------------------------------------------------------------------

export interface GrantInput {
  tenantId: string;
  subjectId: string;
  purpose: ConsentPurpose;
  noticeVersion: string;
  reason: string;
  lawfulBasis?: ConsentRecord['lawfulBasis'];
  now?: () => Date;
}

export function grantConsent(
  snapshot: ConsentSnapshot,
  input: GrantInput
): ConsentSnapshot {
  if (!input.subjectId) throw new Error('grantConsent: subjectId required');
  if (!input.reason || input.reason.length < 5) {
    throw new Error('grantConsent: reason ≥5 chars required');
  }
  const now = (input.now ?? (() => new Date()))();
  const ts = now.toISOString();

  // Supersede any existing granted record for this (subject, purpose).
  const records = snapshot.records.map((r) => {
    if (
      r.subjectId === input.subjectId &&
      r.tenantId === input.tenantId &&
      r.purpose === input.purpose &&
      r.status === 'granted'
    ) {
      return { ...r, status: 'superseded' as ConsentStatus };
    }
    return r;
  });

  const record: ConsentRecord = {
    id: `consent:${input.tenantId}:${input.subjectId}:${input.purpose}:${ts}`,
    tenantId: input.tenantId,
    subjectId: input.subjectId,
    purpose: input.purpose,
    noticeVersion: input.noticeVersion,
    status: 'granted',
    grantedAtIso: ts,
    withdrawnAtIso: null,
    lawfulBasis: input.lawfulBasis ?? DEFAULT_PURPOSES[input.purpose].lawfulBasisDefault,
    reason: input.reason,
  };
  return { records: [...records, record] };
}

export interface WithdrawInput {
  tenantId: string;
  subjectId: string;
  purpose: ConsentPurpose;
  reason: string;
  now?: () => Date;
}

export function withdrawConsent(
  snapshot: ConsentSnapshot,
  input: WithdrawInput
): ConsentSnapshot {
  const now = (input.now ?? (() => new Date()))();
  const ts = now.toISOString();
  const records = snapshot.records.map((r) => {
    if (
      r.subjectId === input.subjectId &&
      r.tenantId === input.tenantId &&
      r.purpose === input.purpose &&
      r.status === 'granted'
    ) {
      return { ...r, status: 'withdrawn' as ConsentStatus, withdrawnAtIso: ts };
    }
    return r;
  });
  return { records };
}

export function listActiveConsent(
  snapshot: ConsentSnapshot,
  subjectId: string,
  tenantId: string
): readonly ConsentRecord[] {
  return snapshot.records.filter(
    (r) => r.subjectId === subjectId && r.tenantId === tenantId && r.status === 'granted'
  );
}

export function hasActiveConsent(
  snapshot: ConsentSnapshot,
  subjectId: string,
  tenantId: string,
  purpose: ConsentPurpose
): boolean {
  return listActiveConsent(snapshot, subjectId, tenantId).some((r) => r.purpose === purpose);
}
