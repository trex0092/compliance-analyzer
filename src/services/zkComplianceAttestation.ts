/**
 * Zero-Knowledge Compliance Attestation — subsystem #96 (Phase 9).
 *
 * Commit-and-reveal zero-knowledge proof of compliance screening
 * without disclosing the subject. Enables cross-jurisdictional
 * regulatory cooperation: a UAE DPMS can prove to a Swiss regulator
 * that customer X was screened against OFAC at time T, without
 * revealing who X is — only when the Swiss regulator independently
 * identifies X as suspicious AND presents their own commit do the
 * two parties reveal and cross-verify.
 *
 * Scheme (Pedersen-lite, hash-based — no elliptic curves needed):
 *
 *   1. Prover picks 256-bit random salt r.
 *   2. Prover computes commit = SHA3-512(r || subjectId || screeningTimestamp || listName).
 *   3. Prover publishes commit + timestamp (the ATTESTATION) to the
 *      regulator portal. Regulator stores it.
 *   4. Later, if the regulator independently suspects subjectId and
 *      wants to know if the prover screened them, the prover reveals
 *      (r, subjectId, screeningTimestamp, listName). Regulator re-
 *      computes the commit and verifies it matches the stored one.
 *
 * Properties:
 *   - Hiding: before reveal, regulator learns nothing about the subject
 *     (SHA3-512 is preimage-resistant, salt prevents dictionary attacks).
 *   - Binding: prover cannot substitute a different subject after
 *     commit (collision-resistance of SHA3-512).
 *   - Quantum-resistant: SHA3-512 is resistant to Grover at 256 bits.
 *
 * This is NOT a full zk-SNARK system. It's the minimum cryptographic
 * primitive that delivers the practical outcome the regulator cares
 * about: "prove you did the screening, and I can verify only if I
 * already suspect the same subject".
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24, 35 (retention, TFS)
 *   - FDL No.10/2025 Art.29 (no tipping-off — zk preserves this)
 *   - FATF Rec 40 (cross-border information sharing)
 *   - Cabinet Res 74/2020 Art.4-7 (freeze protocol proofs)
 *   - GDPR Art.5 + UAE PDPL (data minimisation — share proofs not data)
 */

import { sha3_512Hex } from './quantumResistantSeal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreeningEvent {
  subjectId: string;
  screenedAtIso: string;
  listName: 'UN' | 'OFAC' | 'EU' | 'UK' | 'UAE' | 'EOCN';
  matchScore?: number;
}

export interface ScreeningCommitment {
  commitHash: string;
  attestationPublishedAtIso: string;
  listName: ScreeningEvent['listName'];
  screenedAtIso: string;
}

export interface ScreeningReveal {
  salt: string;
  subjectId: string;
  screenedAtIso: string;
  listName: ScreeningEvent['listName'];
  matchScore?: number;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

function randomSalt(): string {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
  const arr = new Uint8Array(32);
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(arr);
  } else {
    const seed = Date.now();
    for (let i = 0; i < arr.length; i++) arr[i] = (seed + i * 131) & 0xff;
  }
  let hex = '';
  for (const b of arr) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function commitPreimage(
  salt: string,
  subjectId: string,
  screenedAtIso: string,
  listName: string
): string {
  // Domain-separated pipe-delimited preimage. Pipes cannot appear in
  // ISO timestamps or hex salts; subjectId is quoted to protect the
  // boundary.
  return `zk-compliance-v1|${salt}|"${subjectId}"|${screenedAtIso}|${listName}`;
}

/**
 * Commit to a screening event. Returns the commitment (public) plus
 * the reveal (private — keep locally until disclosure is required).
 */
export function commitScreening(event: ScreeningEvent): {
  commitment: ScreeningCommitment;
  reveal: ScreeningReveal;
} {
  const salt = randomSalt();
  const commitHash = sha3_512Hex(
    commitPreimage(salt, event.subjectId, event.screenedAtIso, event.listName)
  );
  return {
    commitment: {
      commitHash,
      attestationPublishedAtIso: new Date().toISOString(),
      listName: event.listName,
      screenedAtIso: event.screenedAtIso,
    },
    reveal: {
      salt,
      subjectId: event.subjectId,
      screenedAtIso: event.screenedAtIso,
      listName: event.listName,
      matchScore: event.matchScore,
    },
  };
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify a reveal against a previously-published commitment. Used by
 * the regulator when the prover discloses.
 */
export function verifyScreeningReveal(
  commitment: ScreeningCommitment,
  reveal: ScreeningReveal
): VerificationResult {
  if (commitment.listName !== reveal.listName) {
    return { valid: false, reason: 'listName mismatch' };
  }
  if (commitment.screenedAtIso !== reveal.screenedAtIso) {
    return { valid: false, reason: 'screenedAtIso mismatch' };
  }
  const recomputed = sha3_512Hex(
    commitPreimage(reveal.salt, reveal.subjectId, reveal.screenedAtIso, reveal.listName)
  );
  if (recomputed !== commitment.commitHash) {
    return { valid: false, reason: 'commit hash mismatch — forged or altered' };
  }
  return { valid: true };
}

/**
 * Cross-party match: a regulator has independently identified
 * subjectX as suspicious and wants to know if ANY published
 * commitment is a match. The regulator only needs to know (yes/no)
 * whether a commit corresponds to subjectX WITHOUT compelling the
 * prover to reveal the salt.
 *
 * Since the commitment is hiding under the salt, this must be done
 * by the prover: given a list of their own saved reveals, they
 * return the count of matches without exposing the non-matching
 * entries.
 */
export function selectiveDisclosure(
  suspect: { subjectId: string },
  priorReveals: readonly ScreeningReveal[]
): { matchCount: number; matches: readonly ScreeningReveal[] } {
  const matches = priorReveals.filter((r) => r.subjectId === suspect.subjectId);
  return { matchCount: matches.length, matches };
}
