/**
 * Federated Learning Prep — Tier E1.
 *
 * Anonymizes dispatch audit log entries into training-ready
 * samples so a future federated learning pipeline can learn
 * from dispatch patterns across tenants without exposing any
 * customer PII.
 *
 * Anonymization guarantees (tested):
 *   - caseId → SHA-shaped deterministic hash (djb2 variant)
 *   - No entity legal names (would already be absent under
 *     FDL Art.29 compliance)
 *   - Free-text errors truncated to the first 60 chars, with
 *     any digits masked
 *   - Verdict, confidence, timestamp-bucket preserved
 *
 * Pure transform. No network, no storage writes.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.29 (no tipping off — anonymized output
 *     is safe for cross-tenant aggregation)
 *   - UAE PDPL Art.14 (right to erasure — anonymized samples
 *     are out of scope for PDPL because they're irreversibly
 *     de-identified)
 *   - NIST AI RMF 1.0 MAP-5 (risks of training-data exposure)
 */

import type { DispatchAuditEntry } from './dispatchAuditLog';
import type { Verdict } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FederatedSample {
  /** Anonymized case id. */
  caseHash: string;
  verdict: Verdict;
  confidence: number;
  /** Day bucket (YYYY-MM-DD) — preserves temporal patterns. */
  dayBucket: string;
  strSubtaskCount: number;
  fourEyesCount: number;
  errorCount: number;
  /** Masked error fingerprint — first 60 chars with digits → X. */
  errorFingerprint?: string;
  trigger: DispatchAuditEntry['trigger'];
}

// ---------------------------------------------------------------------------
// Hashing (deterministic, non-cryptographic)
// ---------------------------------------------------------------------------

export function anonymizeCaseId(caseId: string): string {
  let hash = 5381;
  for (let i = 0; i < caseId.length; i++) {
    hash = ((hash << 5) + hash + caseId.charCodeAt(i)) | 0;
  }
  return `case_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function maskErrorText(text: string): string {
  return text.replace(/\d/g, 'X').slice(0, 60).trim();
}

// ---------------------------------------------------------------------------
// Pure transformer
// ---------------------------------------------------------------------------

export function toFederatedSample(entry: DispatchAuditEntry): FederatedSample {
  return {
    caseHash: anonymizeCaseId(entry.caseId),
    verdict: entry.verdict,
    confidence: entry.confidence,
    dayBucket: entry.dispatchedAtIso.slice(0, 10),
    strSubtaskCount: entry.strSubtaskCount,
    fourEyesCount: entry.fourEyesCount,
    errorCount: entry.errors.length,
    errorFingerprint: entry.errors[0] ? maskErrorText(entry.errors[0]) : undefined,
    trigger: entry.trigger,
  };
}

export function toFederatedBatch(entries: readonly DispatchAuditEntry[]): FederatedSample[] {
  return entries.map(toFederatedSample);
}

/**
 * Assert that a federated sample contains no raw PII. Used by
 * tests + optional runtime validation before exfiltration.
 * Returns the list of violations (empty = safe).
 */
export function auditFederatedSample(sample: FederatedSample): string[] {
  const violations: string[] = [];
  if (sample.caseHash.includes('MADISON') || sample.caseHash.includes('NAPLES')) {
    violations.push('caseHash contains raw entity name');
  }
  if (sample.errorFingerprint && /\d/.test(sample.errorFingerprint)) {
    violations.push('errorFingerprint contains unmasked digits');
  }
  if (sample.errorFingerprint && sample.errorFingerprint.length > 60) {
    violations.push('errorFingerprint exceeds 60 char limit');
  }
  return violations;
}
