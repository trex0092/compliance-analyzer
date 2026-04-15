/**
 * Policy Editor — versioned AML policy document store with diff,
 * three-signature approval flow, and tamper-evident chain.
 *
 * Why this exists:
 *   The AML policy is today a PDF attached to the tool. Every
 *   amendment requires: version it, diff it, route it through the
 *   CO, the MLRO, and the Board, store the signed copy, and keep
 *   an audit trail of who approved what and when.
 *
 *   Manual Word-doc workflows lose signatures, mis-version amendments,
 *   and fail at inspection time when the regulator asks "show me
 *   the policy in force on 2024-07-15".
 *
 *   This module is the pure versioning + diff + approval engine.
 *   No storage — the caller wires it to a Netlify Blob store.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO policy ownership)
 *   FDL No.10/2025 Art.24    (policy retention — 10 years)
 *   Cabinet Res 134/2025 Art.12-14 (approval workflows)
 *   Cabinet Res 134/2025 Art.18-19 (policy review cadence)
 *   MoE Circular 08/AML/2021 (DPMS policy mandatory elements)
 *   FATF Rec 1, Rec 18       (risk-based approach; internal controls)
 */

import { sha3_512Hex } from './quantumResistantSeal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PolicyStatus = 'draft' | 'pending_approval' | 'approved' | 'superseded' | 'rejected';

export interface PolicySignature {
  signerUserId: string;
  signerRole: 'mlro' | 'co' | 'board';
  signedAtIso: string;
}

export interface PolicyVersion {
  id: string;
  tenantId: string;
  version: number;
  /** Preceding version id (null for first version). */
  previousId: string | null;
  /** SHA3-512 hash of the policy body. */
  bodyHashHex: string;
  /** The actual policy text (markdown). */
  body: string;
  createdAtIso: string;
  createdByUserId: string;
  status: PolicyStatus;
  signatures: readonly PolicySignature[];
  /** Reason the version was created. */
  changeReason: string;
  /** Effective-from date when approved. */
  effectiveFromIso: string | null;
  regulatory: readonly string[];
}

export interface DiffLine {
  kind: 'equal' | 'added' | 'removed';
  text: string;
}

export interface PolicyDiff {
  fromVersion: number;
  toVersion: number;
  lines: readonly DiffLine[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

// ---------------------------------------------------------------------------
// Version creation
// ---------------------------------------------------------------------------

export interface CreateVersionInput {
  tenantId: string;
  previous: PolicyVersion | null;
  body: string;
  createdByUserId: string;
  changeReason: string;
  now?: () => Date;
}

export function createPolicyVersion(input: CreateVersionInput): PolicyVersion {
  if (!input.body || input.body.trim().length === 0) {
    throw new Error('createPolicyVersion: body required');
  }
  if (!input.changeReason || input.changeReason.trim().length < 10) {
    throw new Error('createPolicyVersion: changeReason must be ≥10 chars');
  }
  const now = (input.now ?? (() => new Date()))();
  const nextVersion = (input.previous?.version ?? 0) + 1;
  const bodyHashHex = sha3_512Hex('policy-body-v1|' + input.body);
  const id = sha3_512Hex(
    `policy-version-v1|${input.tenantId}|${nextVersion}|${bodyHashHex}|${now.toISOString()}`
  ).slice(0, 32);
  return {
    id,
    tenantId: input.tenantId,
    version: nextVersion,
    previousId: input.previous?.id ?? null,
    bodyHashHex,
    body: input.body,
    createdAtIso: now.toISOString(),
    createdByUserId: input.createdByUserId,
    status: 'draft',
    signatures: [],
    changeReason: input.changeReason,
    effectiveFromIso: null,
    regulatory: [
      'FDL No.10/2025 Art.20-21',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.12-14',
      'Cabinet Res 134/2025 Art.18-19',
      'MoE Circular 08/AML/2021',
      'FATF Rec 1',
      'FATF Rec 18',
    ],
  };
}

// ---------------------------------------------------------------------------
// Signature flow
// ---------------------------------------------------------------------------

export interface SignInput {
  version: PolicyVersion;
  signerUserId: string;
  signerRole: PolicySignature['signerRole'];
  now?: () => Date;
}

export function signPolicyVersion(input: SignInput): PolicyVersion {
  if (input.version.status === 'approved' || input.version.status === 'superseded') {
    throw new Error('signPolicyVersion: cannot sign a finalised version');
  }
  // Reject duplicate signature from the same user (role can be different
  // per session — we dedupe on userId).
  if (input.version.signatures.some((s) => s.signerUserId === input.signerUserId)) {
    throw new Error('signPolicyVersion: user has already signed this version');
  }
  // Enforce role-specific single-slot semantics — each role signs once.
  if (input.version.signatures.some((s) => s.signerRole === input.signerRole)) {
    throw new Error(`signPolicyVersion: role ${input.signerRole} already signed this version`);
  }
  const now = (input.now ?? (() => new Date()))();
  const signatures: PolicySignature[] = [
    ...input.version.signatures,
    {
      signerUserId: input.signerUserId,
      signerRole: input.signerRole,
      signedAtIso: now.toISOString(),
    },
  ];
  const haveAllThree =
    signatures.some((s) => s.signerRole === 'mlro') &&
    signatures.some((s) => s.signerRole === 'co') &&
    signatures.some((s) => s.signerRole === 'board');

  return {
    ...input.version,
    signatures,
    status: haveAllThree ? 'approved' : 'pending_approval',
    effectiveFromIso: haveAllThree ? now.toISOString() : null,
  };
}

export function rejectPolicyVersion(
  version: PolicyVersion,
  reason: string,
  rejectorUserId: string,
  now: () => Date = () => new Date()
): PolicyVersion {
  if (!reason || reason.length < 10) {
    throw new Error('rejectPolicyVersion: reason ≥10 chars required');
  }
  return {
    ...version,
    status: 'rejected',
    changeReason: `${version.changeReason} [REJECTED by ${rejectorUserId} at ${now().toISOString()}: ${reason}]`,
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Tiny line-based diff — not an LCS algorithm but good enough for
 * policy docs where lines rarely reorder. For each line in `to`:
 *   - present in `from` → 'equal'
 *   - absent → 'added'
 * Lines present in `from` but missing from `to` → 'removed' at end.
 */
export function diffPolicyBodies(fromBody: string, toBody: string): DiffLine[] {
  const fromLines = new Set(fromBody.split('\n'));
  const toLines = toBody.split('\n');
  const out: DiffLine[] = [];
  for (const line of toLines) {
    if (fromLines.has(line)) {
      out.push({ kind: 'equal', text: line });
      fromLines.delete(line);
    } else {
      out.push({ kind: 'added', text: line });
    }
  }
  for (const removed of fromLines) {
    out.push({ kind: 'removed', text: removed });
  }
  return out;
}

export function policyDiff(from: PolicyVersion, to: PolicyVersion): PolicyDiff {
  const lines = diffPolicyBodies(from.body, to.body);
  return {
    fromVersion: from.version,
    toVersion: to.version,
    lines,
    addedCount: lines.filter((l) => l.kind === 'added').length,
    removedCount: lines.filter((l) => l.kind === 'removed').length,
    unchangedCount: lines.filter((l) => l.kind === 'equal').length,
  };
}

/**
 * Verify the tamper-evident chain of a version history.
 * Returns true when every version's `previousId` correctly points
 * back to its predecessor AND every body hash matches its body.
 */
export function verifyPolicyChain(history: readonly PolicyVersion[]): boolean {
  if (history.length === 0) return true;
  const sorted = [...history].sort((a, b) => a.version - b.version);
  let prevId: string | null = null;
  for (const v of sorted) {
    if (v.previousId !== prevId) return false;
    const recompute = sha3_512Hex('policy-body-v1|' + v.body);
    if (recompute !== v.bodyHashHex) return false;
    prevId = v.id;
  }
  return true;
}
