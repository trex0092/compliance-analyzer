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
  /** Commitments that collided with at least one other tenant. */
  collisions: ReadonlyArray<{
    commitHash: string;
    tenantIds: readonly string[];
  }>;
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
 * Aggregate commitments from multiple tenants. Returns the
 * collisions without revealing any tenant's subjectKey.
 */
export function aggregateCrossTenantCommitments(
  commitments: readonly CrossTenantCommitment[]
): CrossTenantMatchReport {
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

  const collisions: Array<{ commitHash: string; tenantIds: readonly string[] }> = [];
  for (const [hash, tenants] of byHash) {
    if (tenants.size >= 2) {
      collisions.push({ commitHash: hash, tenantIds: Array.from(tenants).sort() });
    }
  }
  collisions.sort((a, b) => b.tenantIds.length - a.tenantIds.length);

  return {
    totalCommitments: commitments.length,
    distinctHashes: byHash.size,
    collisions,
    summary:
      collisions.length === 0
        ? `No cross-tenant collisions across ${commitments.length} commitment(s).`
        : `${collisions.length} cross-tenant collision(s) across ${commitments.length} commitment(s).`,
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
export const __test__ = { preimage };
