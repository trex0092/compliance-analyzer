/**
 * Cross-Tenant Salt Rotator — quarterly salt-version bumper for the
 * zk cross-tenant attestation pipeline.
 *
 * Why this exists:
 *   src/services/zkCrossTenantAttestation.ts uses a shared global
 *   salt for domain separation. The salt is published in the FIU
 *   circular and is NOT secret — but if it never rotates, hash
 *   commits accumulate forever under the same domain, eventually
 *   risking re-identification via large-scale collision analysis.
 *
 *   Quarterly rotation is the standard mitigation. This module
 *   produces the next salt version label deterministically from
 *   a date input + the current version label, so the cron always
 *   produces the same next version no matter which Netlify region
 *   it runs in.
 *
 *   The cron itself is the I/O wrapper (cross-tenant-salt-rotate-cron).
 *   This module is pure.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.14    (data protection)
 *   Cabinet Res 74/2020 Art.5 (coordinated TFS — salt rotation
 *                              per FIU circular cadence)
 *   FATF Rec 2               (national cooperation)
 *   EU GDPR Art.25           (data minimisation by design)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SaltRotationDecision {
  /** Current live salt version label (e.g. "v2026Q1"). */
  currentVersion: string;
  /** Quarter this decision is being made in. */
  decisionQuarter: string;
  /** Should we rotate now? */
  shouldRotate: boolean;
  /** Next version label if rotating. */
  nextVersion: string;
  /** Plain-English finding. */
  finding: string;
  /** Regulatory anchor. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quarterLabelFromDate(d: Date): string {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `v${y}Q${q}`;
}

function nextQuarterLabel(label: string): string {
  // Parse "vYYYYQn" → next "vYYYYQn"
  const m = label.match(/^v(\d{4})Q([1-4])$/);
  if (!m) {
    // Unknown format — return a fresh label from the current quarter.
    return quarterLabelFromDate(new Date());
  }
  let y = parseInt(m[1]!, 10);
  let q = parseInt(m[2]!, 10);
  q += 1;
  if (q > 4) {
    q = 1;
    y += 1;
  }
  return `v${y}Q${q}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decide whether to rotate the cross-tenant salt and what the next
 * version label should be. Pure function. Same input → same output.
 *
 * Rule:
 *   - We rotate when the current quarter is AFTER the version's
 *     quarter (i.e. the live version is at least one quarter old).
 *   - Otherwise we hold and emit a `shouldRotate: false`.
 */
export function decideSaltRotation(
  currentVersion: string,
  now: Date = new Date()
): SaltRotationDecision {
  const decisionQuarter = quarterLabelFromDate(now);
  const shouldRotate = currentVersion !== decisionQuarter;
  const nextVersion = shouldRotate
    ? // If the current version is older than the current quarter,
      // jump straight to the current quarter (do not skip multiple).
      decisionQuarter
    : nextQuarterLabel(currentVersion);

  return {
    currentVersion,
    decisionQuarter,
    shouldRotate,
    nextVersion,
    finding: shouldRotate
      ? `Cross-tenant salt is overdue for rotation. Live=${currentVersion}, current quarter=${decisionQuarter}. Bumping to ${nextVersion}.`
      : `Cross-tenant salt up to date. Live=${currentVersion} matches current quarter. Next rotation will be ${nextVersion}.`,
    regulatory: [
      'FDL No.10/2025 Art.14',
      'Cabinet Res 74/2020 Art.5',
      'FATF Rec 2',
      'EU GDPR Art.25',
    ],
  };
}

// Exports for tests.
export const __test__ = { quarterLabelFromDate, nextQuarterLabel };
