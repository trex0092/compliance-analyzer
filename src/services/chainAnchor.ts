/**
 * Reasoning Chain Anchor — Merkle-root tamper-evidence beyond our infra.
 *
 * Periodically, we aggregate all sealed reasoning chains from a time
 * window, compute a Merkle root of their canonical hashes, and produce
 * an anchor artefact that contains:
 *
 *   - The Merkle root (64 hex chars, SHA-256)
 *   - The list of chain ids included
 *   - The start + end ISO timestamps
 *   - The policy version at anchor time
 *   - A signing hash the MLRO can paste into a signed git commit,
 *     a public Twitter/Signal post, a blockchain transaction, or
 *     any other write-once public channel
 *
 * Later, if any individual reasoning chain is produced as evidence, we
 * can emit a Merkle proof against the anchor root, and the verifier
 * can independently confirm that chain was part of the committed set.
 *
 * This gives regulators tamper-evidence that survives a full compromise
 * of our own infrastructure.
 *
 * NOT a blockchain. NOT an L1 smart contract. Just a deterministic
 * Merkle commitment + proof primitive. The choice of anchoring venue
 * (git, OTS, Bitcoin…) is left to the deployer.
 *
 * Regulatory basis:
 *   - FDL Art.24 (record retention + tamper-evidence)
 *   - EOCN Inspection Manual v4 §9 (immutable audit trail)
 *   - FATF Methodology 2022 §4 (supervisory access to records)
 */

import type { ReasoningChain } from './reasoningChain';

// ---------------------------------------------------------------------------
// Canonical hashing
// ---------------------------------------------------------------------------

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  );
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashChain(chain: ReasoningChain): Promise<string> {
  return sha256Hex(canonicalJson(chain));
}

// ---------------------------------------------------------------------------
// Merkle tree
// ---------------------------------------------------------------------------

async function hashPair(a: string, b: string): Promise<string> {
  return sha256Hex(a < b ? `${a}|${b}` : `${b}|${a}`);
}

export interface MerkleProof {
  leafHash: string;
  chainId: string;
  /** Sibling hashes from leaf to root. */
  siblings: string[];
  rootHash: string;
}

export interface ChainAnchor {
  rootHash: string;
  chainCount: number;
  chainIds: string[];
  policyVersion: string;
  windowStartIso: string;
  windowEndIso: string;
  anchoredAtIso: string;
  /** Concatenated signing-ready payload for public anchoring. */
  signingPayload: string;
}

async function buildTree(leaves: string[]): Promise<{ root: string; tree: string[][] }> {
  if (leaves.length === 0) {
    return { root: await sha256Hex(''), tree: [[]] };
  }
  const tree: string[][] = [[...leaves]];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = current[i + 1] ?? current[i];
      next.push(await hashPair(left, right));
    }
    tree.push(next);
    current = next;
  }
  return { root: current[0], tree };
}

// ---------------------------------------------------------------------------
// Anchor production
// ---------------------------------------------------------------------------

export interface AnchorInput {
  chains: readonly ReasoningChain[];
  policyVersion: string;
  windowStartIso: string;
  windowEndIso: string;
  anchoredAtIso?: string;
}

export async function createAnchor(input: AnchorInput): Promise<{
  anchor: ChainAnchor;
  leafHashes: string[];
}> {
  const leafHashes: string[] = [];
  for (const chain of input.chains) {
    leafHashes.push(await hashChain(chain));
  }
  const { root } = await buildTree(leafHashes);
  const anchoredAtIso = input.anchoredAtIso ?? new Date().toISOString();
  const chainIds = input.chains.map((c) => c.id);
  const signingPayload = [
    `HAWKEYE-ANCHOR-v1`,
    `root:${root}`,
    `count:${input.chains.length}`,
    `policy:${input.policyVersion}`,
    `window:${input.windowStartIso}..${input.windowEndIso}`,
    `anchored:${anchoredAtIso}`,
  ].join('\n');
  return {
    anchor: {
      rootHash: root,
      chainCount: input.chains.length,
      chainIds,
      policyVersion: input.policyVersion,
      windowStartIso: input.windowStartIso,
      windowEndIso: input.windowEndIso,
      anchoredAtIso,
      signingPayload,
    },
    leafHashes,
  };
}

// ---------------------------------------------------------------------------
// Proof generation + verification
// ---------------------------------------------------------------------------

export async function generateMerkleProof(
  input: AnchorInput,
  chainId: string
): Promise<MerkleProof | null> {
  const leafHashes: string[] = [];
  for (const chain of input.chains) leafHashes.push(await hashChain(chain));
  const idx = input.chains.findIndex((c) => c.id === chainId);
  if (idx < 0) return null;
  const { root, tree } = await buildTree(leafHashes);
  const siblings: string[] = [];
  let pos = idx;
  for (let level = 0; level < tree.length - 1; level++) {
    const current = tree[level];
    const sibling = pos % 2 === 0 ? (current[pos + 1] ?? current[pos]) : current[pos - 1];
    siblings.push(sibling);
    pos = Math.floor(pos / 2);
  }
  return {
    leafHash: leafHashes[idx],
    chainId,
    siblings,
    rootHash: root,
  };
}

export async function verifyMerkleProof(proof: MerkleProof): Promise<boolean> {
  let current = proof.leafHash;
  for (const sibling of proof.siblings) {
    current = await hashPair(current, sibling);
  }
  return current === proof.rootHash;
}
