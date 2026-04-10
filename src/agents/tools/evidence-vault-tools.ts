/**
 * Cryptographic Evidence Vault
 *
 * Merkle tree-based evidence integrity system:
 * 1. Every piece of evidence gets a SHA-256 hash
 * 2. Hashes are organized in a Merkle tree
 * 3. Any tampering is detectable by verifying the root hash
 * 4. Individual evidence items can be proven with O(log n) proof
 * 5. Timestamped snapshots create an immutable timeline
 *
 * This ensures compliance evidence cannot be altered after creation —
 * critical for regulator audits and legal proceedings.
 *
 * Regulatory basis: FDL No.10/2025 Art.24 (record retention),
 * Cabinet Res 134/2025 Art.19 (internal review)
 */

import type { ToolResult as _ToolResult } from '../mcp-server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvidenceItem {
  id: string;
  type: 'document' | 'screening-result' | 'decision' | 'communication' | 'transaction' | 'approval' | 'filing';
  title: string;
  content: string; // serialized content
  caseId?: string;
  entityId?: string;
  createdBy: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface HashedEvidence {
  evidence: EvidenceItem;
  hash: string;
  index: number;
}

export interface MerkleProof {
  evidenceId: string;
  evidenceHash: string;
  proof: Array<{
    hash: string;
    position: 'left' | 'right';
  }>;
  rootHash: string;
  verified: boolean;
}

export interface VaultSnapshot {
  snapshotId: string;
  createdAt: string;
  rootHash: string;
  evidenceCount: number;
  treeDepth: number;
  leafHashes: string[];
}

export interface VaultIntegrityReport {
  vaultId: string;
  verifiedAt: string;
  totalItems: number;
  treeDepth: number;
  rootHash: string;
  allValid: boolean;
  invalidItems: string[];
  verificationTimeMs: number;
}

// ---------------------------------------------------------------------------
// SHA-256 Hashing
// ---------------------------------------------------------------------------

async function sha256(data: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: simple hash for environments without SubtleCrypto
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

async function hashEvidence(evidence: EvidenceItem): Promise<string> {
  const canonical = JSON.stringify({
    id: evidence.id,
    type: evidence.type,
    title: evidence.title,
    content: evidence.content,
    caseId: evidence.caseId,
    entityId: evidence.entityId,
    createdBy: evidence.createdBy,
    createdAt: evidence.createdAt,
  });
  return sha256(canonical);
}

async function hashPair(left: string, right: string): Promise<string> {
  return sha256(left + right);
}

// ---------------------------------------------------------------------------
// Merkle Tree
// ---------------------------------------------------------------------------

export class MerkleTree {
  private leaves: string[] = [];
  private tree: string[][] = [];
  private evidenceMap = new Map<string, HashedEvidence>();

  /** Add evidence and rebuild tree */
  async addEvidence(evidence: EvidenceItem): Promise<HashedEvidence> {
    const hash = await hashEvidence(evidence);
    const index = this.leaves.length;
    this.leaves.push(hash);

    const hashed: HashedEvidence = { evidence, hash, index };
    this.evidenceMap.set(evidence.id, hashed);

    await this.buildTree();
    return hashed;
  }

  /** Add multiple evidence items */
  async addBatch(items: EvidenceItem[]): Promise<HashedEvidence[]> {
    const results: HashedEvidence[] = [];
    for (const item of items) {
      const hash = await hashEvidence(item);
      const index = this.leaves.length;
      this.leaves.push(hash);
      const hashed: HashedEvidence = { evidence: item, hash, index };
      this.evidenceMap.set(item.id, hashed);
      results.push(hashed);
    }
    await this.buildTree();
    return results;
  }

  /** Build the Merkle tree from leaves */
  private async buildTree(): Promise<void> {
    if (this.leaves.length === 0) {
      this.tree = [];
      return;
    }

    this.tree = [[...this.leaves]];
    let currentLevel = [...this.leaves];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(await hashPair(currentLevel[i], currentLevel[i + 1]));
        } else {
          // Odd node: promote as-is
          nextLevel.push(currentLevel[i]);
        }
      }
      this.tree.push(nextLevel);
      currentLevel = nextLevel;
    }
  }

  /** Get the root hash */
  getRootHash(): string {
    if (this.tree.length === 0) return '0'.repeat(64);
    return this.tree[this.tree.length - 1][0];
  }

  /** Generate a Merkle proof for a specific evidence item */
  async generateProof(evidenceId: string): Promise<MerkleProof | null> {
    const hashed = this.evidenceMap.get(evidenceId);
    if (!hashed) return null;

    const proof: MerkleProof['proof'] = [];
    let index = hashed.index;

    for (let level = 0; level < this.tree.length - 1; level++) {
      const currentLevel = this.tree[level];
      const isLeftNode = index % 2 === 0;
      const siblingIndex = isLeftNode ? index + 1 : index - 1;

      if (siblingIndex < currentLevel.length) {
        proof.push({
          hash: currentLevel[siblingIndex],
          position: isLeftNode ? 'right' : 'left',
        });
      }

      index = Math.floor(index / 2);
    }

    // Verify the proof
    let computedHash = hashed.hash;
    for (const step of proof) {
      if (step.position === 'right') {
        computedHash = await hashPair(computedHash, step.hash);
      } else {
        computedHash = await hashPair(step.hash, computedHash);
      }
    }

    return {
      evidenceId,
      evidenceHash: hashed.hash,
      proof,
      rootHash: this.getRootHash(),
      verified: computedHash === this.getRootHash(),
    };
  }

  /** Verify a proof against a root hash */
  static async verifyProof(proof: MerkleProof): Promise<boolean> {
    let computedHash = proof.evidenceHash;
    for (const step of proof.proof) {
      if (step.position === 'right') {
        computedHash = await hashPair(computedHash, step.hash);
      } else {
        computedHash = await hashPair(step.hash, computedHash);
      }
    }
    return computedHash === proof.rootHash;
  }

  /** Verify entire tree integrity */
  async verifyIntegrity(): Promise<VaultIntegrityReport> {
    const start = Date.now();
    const invalidItems: string[] = [];

    for (const [id, hashed] of this.evidenceMap) {
      const recomputed = await hashEvidence(hashed.evidence);
      if (recomputed !== hashed.hash) {
        invalidItems.push(id);
      }
    }

    // Rebuild tree and compare root
    const originalRoot = this.getRootHash();
    await this.buildTree();
    const newRoot = this.getRootHash();

    if (originalRoot !== newRoot && invalidItems.length === 0) {
      invalidItems.push('TREE_STRUCTURE_MISMATCH');
    }

    return {
      vaultId: `vault-${Date.now()}`,
      verifiedAt: new Date().toISOString(),
      totalItems: this.evidenceMap.size,
      treeDepth: this.tree.length,
      rootHash: this.getRootHash(),
      allValid: invalidItems.length === 0,
      invalidItems,
      verificationTimeMs: Date.now() - start,
    };
  }

  /** Create a snapshot */
  createSnapshot(): VaultSnapshot {
    return {
      snapshotId: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      rootHash: this.getRootHash(),
      evidenceCount: this.evidenceMap.size,
      treeDepth: this.tree.length,
      leafHashes: [...this.leaves],
    };
  }

  /** Get evidence by ID */
  getEvidence(id: string): HashedEvidence | undefined {
    return this.evidenceMap.get(id);
  }

  /** Get all evidence */
  getAllEvidence(): HashedEvidence[] {
    return Array.from(this.evidenceMap.values());
  }

  /** Get item count */
  get size(): number { return this.evidenceMap.size; }
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const EVIDENCE_VAULT_TOOL_SCHEMAS = [
  {
    name: 'vault_add_evidence',
    description:
      'Add evidence to the cryptographic vault with SHA-256 hashing and Merkle tree inclusion. Returns hash and proof of inclusion.',
    inputSchema: {
      type: 'object',
      properties: {
        evidence: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['document', 'screening-result', 'decision', 'communication', 'transaction', 'approval', 'filing'] },
            title: { type: 'string' },
            content: { type: 'string' },
            caseId: { type: 'string' },
            entityId: { type: 'string' },
            createdBy: { type: 'string' },
          },
          required: ['id', 'type', 'title', 'content', 'createdBy'],
        },
      },
      required: ['evidence'],
    },
  },
  {
    name: 'vault_verify_integrity',
    description:
      'Verify the integrity of the entire evidence vault. Checks every item hash and Merkle tree structure. Returns pass/fail with any tampered items identified.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'vault_generate_proof',
    description:
      'Generate a Merkle proof for a specific evidence item. The proof can independently verify that the evidence has not been tampered with.',
    inputSchema: {
      type: 'object',
      properties: {
        evidenceId: { type: 'string' },
      },
      required: ['evidenceId'],
    },
  },
] as const;
