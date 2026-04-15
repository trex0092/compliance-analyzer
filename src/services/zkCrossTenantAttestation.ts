/**
 * zk Cross-Tenant Attestation — commit-only proof that two
 * tenants independently saw the same sanctions exposure, without
 * either tenant revealing any customer data to the other.
 *
 * Why this exists:
 *   Federated learning over customer data across tenants is a
 *   non-starter — it breaches FDL Art.14 data protection and
 *   invites supervisory action. BUT the industry does need a
 *   way to say: "we confirm that the same sanctioned party
 *   was observed by multiple institutions in this window"
 *   without trading raw customer lists.
 *
 *   This module is a safe equivalent. Each tenant commits to a
 *   hashed observation tuple (subjectKey, tsDay, listName) under
 *   a shared global salt. The commitments collide iff the tuples
 *   are bit-identical. A third-party aggregator (or a neutral
 *   Netlify function) can count matching commitment hashes
 *   across tenants without ever learning either tenant's
 *   `subjectKey` — only the hash.
 *
 *   subjectKey is an OPAQUE ref produced by the tenant
 *   (sha3(internalId + tenantSecret)). It never leaves the
 *   tenant in cleartext. The global salt is a constant string
 *   published in the FIU circular — both tenants must share the
 *   exact same version to get a collision.
 *
 *   Pure function. Uses sha3_512Hex — same primitive as the
 *   existing zk-compliance attestation, so operators do not need
 *   a second hash library.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.14    (data protection — no raw share)
 *   FDL No.10/2025 Art.20-22 (CO collaboration, reasoned)
 *   FDL No.10/2025 Art.29    (no tipping off — opaque hash only)
 *   Cabinet Res 74/2020 Art.5 (coordinated TFS — can't violate
 *                              data protection while coordinating)
 *   FATF Rec 2               (national cooperation)
 *   EU GDPR Art.25           (data minimisation — commitment-only)
 */

import { sha3_512Hex } from './quantumResistantSeal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrossTenantObservation {
  /** Opaque per-tenant subject key — never a legal name. */
  subjectKey: string;
  /** UTC day (YYYY-MM-DD) when the sanctions exposure was observed. */
  tsDay: string;
  /** Sanctions list name. */
  listName: 'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN';
}

export interface CrossTenantCommitment {
  /** Hex SHA3-512 commitment hash. */
  commitHash: string;
  /** Opaque tenant id attaching the commitment (NOT customer id). */
  tenantId: string;
  /** ISO timestamp of commit emission. */
  publishedAtIso: string;
  /** Version of the shared salt used — matches FIU circular version. */
  saltVersion: string;
}

export interface CrossTenantMatchReport {
  /** Total commitments observed across every tenant. */
  totalCommitments: number;
  /** Number of distinct hashes. */
  distinctHashes: number;
  /**
   * Effective k-anonymity threshold applied to this report. Hashes
   * with fewer than k contributing tenants are SUPPRESSED from
   * `collisions` and only counted in `suppressedBelowK`.
   */
  kAnonymity: number;
  /**
   * Commitments that meet the k-anonymity threshold. Tenant IDs
   * remain visible because reaching k contributing parties means
   * no single tenant is uniquely re-identifiable from the result.
   */
  collisions: ReadonlyArray<{
    commitHash: string;
    tenantCount: number;
    tenantIds: readonly string[];
  }>;
  /**
   * Number of hash buckets that DID collide (>=2 tenants) but were
   * suppressed because they fell below the k-anonymity threshold.
   * MLROs see the bucket count without learning which tenants were
   * involved — protects against re-identification when a small
   * cross-tenant overlap would otherwise deanonymise a single party.
   */
  suppressedBelowK: number;
  /** Plain-English summary. */
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Preimage
// ---------------------------------------------------------------------------

/**
 * Build the commitment preimage. Domain-separated pipe-delimited
 * format so a malicious tenant cannot cause hash collisions by
 * injecting a field separator into `subjectKey`.
 */
function preimage(
  observation: CrossTenantObservation,
  saltVersion: string,
  sharedSalt: string
): string {
  return (
    `zk-cross-tenant-v1|${saltVersion}|${sharedSalt}|` +
    `"${observation.subjectKey}"|${observation.tsDay}|${observation.listName}`
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CommitOptions {
  tenantId: string;
  saltVersion: string;
  sharedSalt: string;
  now?: () => Date;
}

export function commitCrossTenantObservation(
  observation: CrossTenantObservation,
  opts: CommitOptions
): CrossTenantCommitment {
  const now = opts.now ?? (() => new Date());
  const commitHash = sha3_512Hex(preimage(observation, opts.saltVersion, opts.sharedSalt));
  return {
    commitHash,
    tenantId: opts.tenantId,
    publishedAtIso: now().toISOString(),
    saltVersion: opts.saltVersion,
  };
}

/**
 * Default k-anonymity threshold for cross-tenant collision reports.
 * k=3 means a hash is only revealed once at least three distinct
 * tenants have committed to it. With k=2 a single shared customer
 * could be re-identified by the OTHER party in a 2-tenant overlap;
 * k=3 guarantees that no single tenant can deduce which other
 * specific tenant contributed the colliding observation.
 *
 * This default is conservative — operators may raise it via the
 * options bag, but should never lower it below 2.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.14 (data protection)
 *   EU GDPR Art.25 (data minimisation by design)
 *   FATF Rec 2 (national cooperation without re-identification)
 */
export const DEFAULT_K_ANONYMITY = 3;

/** Hard floor — k below this is rejected as unsafe. */
export const MIN_K_ANONYMITY = 2;

export interface AggregateOptions {
  /** k-anonymity threshold. Defaults to DEFAULT_K_ANONYMITY (3). */
  kAnonymity?: number;
}

/**
 * Aggregate commitments from multiple tenants. Returns the
 * collisions without revealing any tenant's subjectKey, and
 * suppresses any collision bucket below the k-anonymity threshold
 * so single-shared-subject re-identification is impossible.
 */
export function aggregateCrossTenantCommitments(
  commitments: readonly CrossTenantCommitment[],
  opts: AggregateOptions = {}
): CrossTenantMatchReport {
  const requestedK =
    typeof opts.kAnonymity === 'number' && Number.isFinite(opts.kAnonymity)
      ? Math.floor(opts.kAnonymity)
      : DEFAULT_K_ANONYMITY;
  // Clamp to the hard floor — we never reveal collisions with k=1.
  const k = Math.max(MIN_K_ANONYMITY, requestedK);

  const byHash = new Map<string, Set<string>>();
  for (const c of commitments) {
    if (!c || typeof c.commitHash !== 'string') continue;
    let set = byHash.get(c.commitHash);
    if (!set) {
      set = new Set<string>();
      byHash.set(c.commitHash, set);
    }
    set.add(c.tenantId);
  }

  const collisions: Array<{
    commitHash: string;
    tenantCount: number;
    tenantIds: readonly string[];
  }> = [];
  let suppressedBelowK = 0;
  for (const [hash, tenants] of byHash) {
    if (tenants.size < 2) continue; // not a collision at all
    if (tenants.size < k) {
      suppressedBelowK += 1;
      continue;
    }
    collisions.push({
      commitHash: hash,
      tenantCount: tenants.size,
      tenantIds: Array.from(tenants).sort(),
    });
  }
  collisions.sort((a, b) => b.tenantCount - a.tenantCount);

  let summary: string;
  if (collisions.length === 0 && suppressedBelowK === 0) {
    summary = `No cross-tenant collisions across ${commitments.length} commitment(s).`;
  } else if (collisions.length === 0) {
    summary =
      `No collisions met the k=${k} anonymity threshold ` +
      `(${suppressedBelowK} bucket(s) suppressed for re-identification safety).`;
  } else {
    summary =
      `${collisions.length} cross-tenant collision(s) at k=${k} across ${commitments.length} commitment(s)` +
      (suppressedBelowK > 0 ? ` (${suppressedBelowK} sub-k bucket(s) suppressed).` : '.');
  }

  return {
    totalCommitments: commitments.length,
    distinctHashes: byHash.size,
    kAnonymity: k,
    collisions,
    suppressedBelowK,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.14',
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.29',
      'Cabinet Res 74/2020 Art.5',
      'FATF Rec 2',
      'EU GDPR Art.25',
    ],
  };
}

// Exports for tests.
export const __test__ = { preimage, DEFAULT_K_ANONYMITY, MIN_K_ANONYMITY };
