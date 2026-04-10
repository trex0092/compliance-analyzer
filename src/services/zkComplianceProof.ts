/**
 * Zero-Knowledge Compliance Proofs (COMMITMENT-BASED MOCK).
 *
 * NOT a cryptographic ZK-SNARK. This is a deterministic commitment +
 * Merkle-tree scheme that lets us prove certain compliance FACTS to a
 * verifier WITHOUT disclosing the underlying evidence.
 *
 * Use case: "Prove to the regulator that every customer was screened
 * within the last 30 days, WITHOUT revealing customer names or screening
 * details." We do this by:
 *
 *   1. Hashing each { customerId, screenedAtIso, verdict } record with a
 *      blinding factor (commitment).
 *   2. Building a Merkle tree over the commitments. The root is
 *      published to the verifier.
 *   3. When the regulator asks to audit record X, we reveal
 *      (customerId, screenedAt, verdict, blindingFactor, path) and the
 *      verifier recomputes the root.
 *
 * Properties:
 *   - BINDING: once the root is published, we cannot swap records
 *     without changing the root (collision resistance of SHA-256).
 *   - HIDING: a verifier who only has the root learns nothing about
 *     individual records (blinding factors are uniformly random).
 *   - SELECTIVE DISCLOSURE: we can reveal a single record + proof path
 *     without revealing the rest of the tree.
 *
 * This is NOT a full ZK system:
 *   - It cannot prove statements like "all records are within the last
 *     30 days" without revealing the records.
 *   - For real ZK circuits use Noir / Circom / Halo2 — out of scope for
 *     in-browser compliance UI.
 *
 * Regulatory basis:
 *   - EOCN guidance on regulator audit trails (2025)
 *   - FDL Art.24 (record retention)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ComplianceRecord {
  recordId: string;
  data: Record<string, unknown>;
}

export interface Commitment {
  recordId: string;
  commitmentHash: string;
  blindingFactor: string;
}

export interface MerkleNode {
  hash: string;
  left?: MerkleNode;
  right?: MerkleNode;
}

export interface MerkleProof {
  recordId: string;
  commitmentHash: string;
  /** Siblings from leaf to root; each entry indicates the side of the sibling. */
  path: Array<{ siblingHash: string; position: 'left' | 'right' }>;
  rootHash: string;
}

export interface ComplianceProofBundle {
  rootHash: string;
  commitments: Commitment[];
  /** Count of records in the committed set. */
  recordCount: number;
  /** ISO timestamp when the bundle was sealed. */
  sealedAt: string;
}

// ---------------------------------------------------------------------------
// Hash (SHA-256 via Web Crypto / Node Crypto)
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  // Browser + modern Node have SubtleCrypto on globalThis.crypto.
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

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

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

export async function commitRecord(
  record: ComplianceRecord,
  blindingFactor?: string
): Promise<Commitment> {
  const blind = blindingFactor ?? randomHex(16);
  const payload = `${record.recordId}|${canonicalJson(record.data)}|${blind}`;
  const hash = await sha256Hex(payload);
  return {
    recordId: record.recordId,
    commitmentHash: hash,
    blindingFactor: blind,
  };
}

// ---------------------------------------------------------------------------
// Merkle tree
// ---------------------------------------------------------------------------

async function hashPair(a: string, b: string): Promise<string> {
  return sha256Hex(a < b ? `${a}|${b}` : `${b}|${a}`);
}

async function buildMerkleTree(leaves: string[]): Promise<MerkleNode> {
  if (leaves.length === 0) {
    return { hash: await sha256Hex('') };
  }
  let level: MerkleNode[] = leaves.map((h) => ({ hash: h }));
  while (level.length > 1) {
    const next: MerkleNode[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i]; // duplicate last if odd
      const parent: MerkleNode = {
        hash: await hashPair(left.hash, right.hash),
        left,
        right,
      };
      next.push(parent);
    }
    level = next;
  }
  return level[0];
}

export async function sealComplianceBundle(
  records: readonly ComplianceRecord[]
): Promise<ComplianceProofBundle> {
  const commitments: Commitment[] = [];
  for (const rec of records) {
    commitments.push(await commitRecord(rec));
  }
  const root = await buildMerkleTree(commitments.map((c) => c.commitmentHash));
  return {
    rootHash: root.hash,
    commitments,
    recordCount: commitments.length,
    sealedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Proof generation + verification
// ---------------------------------------------------------------------------

export async function generateProof(
  bundle: ComplianceProofBundle,
  recordId: string
): Promise<MerkleProof | null> {
  const idx = bundle.commitments.findIndex((c) => c.recordId === recordId);
  if (idx < 0) return null;

  // Rebuild tree layer-by-layer, collecting sibling hashes along the way.
  let level = bundle.commitments.map((c) => c.commitmentHash);
  let pos = idx;
  const path: MerkleProof['path'] = [];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i];
      if (i === pos || i + 1 === pos) {
        if (pos === i) path.push({ siblingHash: right, position: 'right' });
        else path.push({ siblingHash: left, position: 'left' });
      }
      next.push(await hashPair(left, right));
    }
    pos = Math.floor(pos / 2);
    level = next;
  }

  return {
    recordId,
    commitmentHash: bundle.commitments[idx].commitmentHash,
    path,
    rootHash: bundle.rootHash,
  };
}

export async function verifyProof(proof: MerkleProof): Promise<boolean> {
  let current = proof.commitmentHash;
  for (const step of proof.path) {
    current = await hashPair(current, step.siblingHash);
  }
  return current === proof.rootHash;
}

/**
 * Verify that a revealed record matches its commitment — the leaf step.
 * The regulator calls this after we reveal a record + blinding factor.
 */
export async function verifyRevealedRecord(
  record: ComplianceRecord,
  commitment: Commitment
): Promise<boolean> {
  if (record.recordId !== commitment.recordId) return false;
  const payload = `${record.recordId}|${canonicalJson(record.data)}|${commitment.blindingFactor}`;
  const hash = await sha256Hex(payload);
  return hash === commitment.commitmentHash;
}
