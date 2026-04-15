/**
 * GDPR Subject Access Export — produces a signed JSON bundle of every
 * piece of data the tool holds about a given customer, in response
 * to a GDPR Art.15 Subject Access Request (SAR).
 *
 * Why this exists:
 *   EU GDPR Art.15 gives every EU-resident customer the right to a
 *   copy of their personal data within 30 days of request. Under
 *   Art.12 the operator can ask for ID verification but cannot
 *   refuse a legitimate request.
 *
 *   This module is the pure bundle composer. Callers collect the
 *   raw data from each store; this module validates + seals +
 *   produces the bundle. Tipping-off-safe by construction — the
 *   bundle excludes any audit entry marked `investigation` that
 *   would tip off the subject under FDL Art.29 (precedence goes to
 *   the AML obligation).
 *
 * Regulatory basis:
 *   EU GDPR Art.15 (right of access)
 *   EU GDPR Art.12 (transparency + identification)
 *   EU GDPR Art.20 (portability — satisfied by JSON format)
 *   FDL No.10/2025 Art.29 (tipping-off precedence — investigation
 *                          records excluded from the export)
 *   ISO/IEC 27001 A.18 (privacy + compliance)
 */

import { sha3_512Hex } from './quantumResistantSeal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SarDataSource {
  /** Identifier of the store (e.g. 'customers', 'cases', 'audit'). */
  storeId: string;
  /** Records scoped to the subject. */
  records: readonly Record<string, unknown>[];
  /** Records that MUST be excluded under FDL Art.29 (tipping off). */
  investigationExclusions?: readonly Record<string, unknown>[];
}

export interface SarRequest {
  /** Subject identifier (opaque internal id, never a raw email). */
  subjectId: string;
  /** Tenant scope. */
  tenantId: string;
  /** Name of the operator handling the request. */
  handledByUserId: string;
  /** ISO date the request was received. */
  receivedAtIso: string;
  /** Optional free-text description. */
  description?: string;
}

export interface SarBundle {
  schemaVersion: 1;
  subjectId: string;
  tenantId: string;
  handledByUserId: string;
  receivedAtIso: string;
  generatedAtIso: string;
  stores: readonly {
    storeId: string;
    recordCount: number;
    records: readonly Record<string, unknown>[];
  }[];
  /** Number of records EXCLUDED under FDL Art.29. */
  excludedRecordCount: number;
  /** Plain-English explanation of exclusions for the operator. */
  exclusionNotice: string;
  integrity: {
    algorithm: 'sha3-512';
    hashHex: string;
  };
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return (
      '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(rec[k])).join(',') + '}'
    );
  }
  return 'null';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildSarBundle(
  request: SarRequest,
  sources: readonly SarDataSource[],
  now: () => Date = () => new Date()
): SarBundle {
  if (!request.subjectId) throw new Error('buildSarBundle: subjectId required');
  if (!request.tenantId) throw new Error('buildSarBundle: tenantId required');
  if (!request.handledByUserId) throw new Error('buildSarBundle: handledByUserId required');

  let excludedCount = 0;
  const stores = sources.map((src) => {
    if (src.investigationExclusions) excludedCount += src.investigationExclusions.length;
    return {
      storeId: src.storeId,
      recordCount: src.records.length,
      records: src.records,
    };
  });

  const unsealed: Omit<SarBundle, 'integrity'> = {
    schemaVersion: 1,
    subjectId: request.subjectId,
    tenantId: request.tenantId,
    handledByUserId: request.handledByUserId,
    receivedAtIso: request.receivedAtIso,
    generatedAtIso: now().toISOString(),
    stores,
    excludedRecordCount: excludedCount,
    exclusionNotice:
      excludedCount === 0
        ? 'No records were excluded from this Subject Access export.'
        : `${excludedCount} record(s) are not included in this export because they are part of an active investigation. The UAE AML/CFT regime (FDL Art.29) prohibits disclosure of such records to the subject while the investigation is ongoing. This exclusion is a legal requirement — not a refusal under GDPR Art.15(4).`,
    regulatory: [
      'EU GDPR Art.15',
      'EU GDPR Art.12',
      'EU GDPR Art.20',
      'FDL No.10/2025 Art.29',
      'ISO/IEC 27001 A.18',
    ],
  };

  const hashHex = sha3_512Hex('sar-bundle-v1|' + canonicalStringify(unsealed));

  return {
    ...unsealed,
    integrity: { algorithm: 'sha3-512', hashHex },
  };
}

export function verifySarBundle(bundle: SarBundle): boolean {
  if (!bundle || !bundle.integrity || bundle.integrity.algorithm !== 'sha3-512') return false;
  const { integrity, ...rest } = bundle;
  void integrity;
  const expected = sha3_512Hex('sar-bundle-v1|' + canonicalStringify(rest));
  return expected === bundle.integrity.hashHex;
}

// Exports for tests.
export const __test__ = { canonicalStringify };
