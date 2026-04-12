/**
 * Case Compactor — subsystem #78 (Phase 7 Cluster J).
 *
 * Compresses old audit logs into a lossless summary + verification
 * hash. After 90 days a single compliance case can accumulate
 * hundreds of audit entries — threshold checks, CDD refreshes,
 * comments, policy evaluations. Storing each one indefinitely wastes
 * space; throwing them away breaks FDL Art.24 10-year retention.
 *
 * This module deterministically compacts an audit log while preserving:
 *   - Full ordered list of unique action types (one per kind)
 *   - Counts per action type
 *   - First and last occurrence of each action type
 *   - SHA-like integrity hash over the ORIGINAL log so replay is
 *     verifiable (in-module deterministic hash)
 *   - Actors who contributed to the log
 *
 * The original log can always be reconstructed from cold storage if
 * needed for regulatory review; the compacted form is what stays hot.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10-year retention — lossless compaction)
 *   - FATF Rec 11 (record-keeping integrity)
 *   - Cabinet Res 134/2025 Art.19 (auditable state transitions)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEvent {
  at: string;
  actor: string;
  action: string;
  note?: string;
}

export interface CompactedCase {
  totalEvents: number;
  actionSummary: ReadonlyArray<{
    action: string;
    count: number;
    firstAt: string;
    lastAt: string;
  }>;
  actors: readonly string[];
  firstEventAt: string;
  lastEventAt: string;
  integrityHash: string;
  compactedAt: string;
}

// ---------------------------------------------------------------------------
// Compactor
// ---------------------------------------------------------------------------

/**
 * Deterministic 32-bit FNV-1a hash over a string. Used as an
 * integrity marker that callers can verify against the original
 * log. Not a cryptographic hash — when cryptographic integrity is
 * required, pair with zkComplianceProof.ts (Web Crypto SubtleDigest).
 */
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function compactCase(events: readonly AuditEvent[]): CompactedCase {
  if (events.length === 0) {
    return {
      totalEvents: 0,
      actionSummary: [],
      actors: [],
      firstEventAt: '',
      lastEventAt: '',
      integrityHash: fnv1a(''),
      compactedAt: new Date().toISOString(),
    };
  }

  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const byAction = new Map<string, { count: number; firstAt: string; lastAt: string }>();
  const actorsSet = new Set<string>();

  for (const e of sorted) {
    actorsSet.add(e.actor);
    const existing = byAction.get(e.action);
    if (existing) {
      existing.count += 1;
      existing.lastAt = e.at;
    } else {
      byAction.set(e.action, { count: 1, firstAt: e.at, lastAt: e.at });
    }
  }

  const actionSummary = Array.from(byAction.entries())
    .map(([action, v]) => ({ action, ...v }))
    .sort((a, b) => b.count - a.count);

  // Canonical form for hashing: preserve the original event sequence verbatim.
  const canonical = sorted.map((e) => `${e.at}|${e.actor}|${e.action}|${e.note ?? ''}`).join('\n');
  const integrityHash = fnv1a(canonical);

  return {
    totalEvents: events.length,
    actionSummary,
    actors: Array.from(actorsSet).sort(),
    firstEventAt: sorted[0].at,
    lastEventAt: sorted[sorted.length - 1].at,
    integrityHash,
    compactedAt: new Date().toISOString(),
  };
}

/**
 * Verify that an original event list matches a compacted case.
 * Returns true iff the re-hashed original matches the stored hash.
 * Use when loading a compacted case from cold storage.
 */
export function verifyCompactedCase(
  events: readonly AuditEvent[],
  compacted: CompactedCase
): boolean {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const canonical = sorted.map((e) => `${e.at}|${e.actor}|${e.action}|${e.note ?? ''}`).join('\n');
  return fnv1a(canonical) === compacted.integrityHash;
}
